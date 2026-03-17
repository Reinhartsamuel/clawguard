import type { Context } from "hono";
import { stream } from "hono/streaming";
import type { IngressResult } from "./ingress.js";
import { ProxyError } from "./ingress.js";
import type { UsageResult } from "../tokens/counter.js";
import {
  parseUsageFromResponse,
  parseUsageFromSSEChunk,
  extractDeltaContent,
  estimateTokensFromChars,
  buildUsageResult,
} from "../tokens/counter.js";

export type OnUsage = (usage: UsageResult) => void;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function buildUpstreamHeaders(c: Context, apiKey: string): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(c.req.header())) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (value != null) headers.set(key, value);
  }
  headers.set("authorization", `Bearer ${apiKey}`);
  // Force uncompressed responses so we can passthrough cleanly
  headers.set("accept-encoding", "identity");
  return headers;
}

export async function forwardRequest(
  c: Context,
  ingress: IngressResult,
  requestId: string,
  onUsage?: OnUsage,
  bodyOverride?: string,
): Promise<Response> {
  // Normalize path: ensure /v1 prefix for providers that expect it
  const path = c.req.path.startsWith("/v1/") ? c.req.path : `/v1${c.req.path}`;
  const upstreamUrl = `${ingress.providerBaseUrl}${path}`;
  const method = c.req.method;
  const body = method === "GET" || method === "HEAD"
    ? null
    : (bodyOverride ?? await c.req.raw.text());
  const headers = buildUpstreamHeaders(c, ingress.apiKey);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, { method, headers, body });
  } catch (err) {
    throw new ProxyError(
      502,
      `Failed to reach provider: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }

  const contentType = upstreamRes.headers.get("content-type") ?? "";
  const isStream = contentType.includes("text/event-stream");

  if (isStream && upstreamRes.body) {
    return streamResponse(c, upstreamRes, requestId, onUsage);
  }

  // Non-streaming: pass through status, headers, and body
  const responseHeaders = new Headers();
  for (const [key, value] of upstreamRes.headers) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }
  responseHeaders.set("x-clawguard-request-id", requestId);

  const responseBody = await upstreamRes.text();

  // Extract usage from response
  if (onUsage) {
    const usage = parseUsageFromResponse(responseBody);
    if (usage) onUsage(usage);
  }

  return new Response(responseBody, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}

function streamResponse(
  c: Context,
  upstreamRes: Response,
  requestId: string,
  onUsage?: OnUsage,
): Response {
  c.header("content-type", "text/event-stream");
  c.header("cache-control", "no-cache");
  c.header("connection", "keep-alive");
  c.header("x-clawguard-request-id", requestId);

  // Forward rate-limit headers from upstream
  for (const key of [
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
  ]) {
    const val = upstreamRes.headers.get(key);
    if (val) c.header(key, val);
  }

  return stream(c, async (s) => {
    const reader = upstreamRes.body!.getReader();
    const decoder = new TextDecoder();

    let usageFromProvider: UsageResult | null = null;
    let accumulatedContent = "";
    let model = "unknown";

    try {
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        await s.write(chunk);

        // Parse SSE lines for usage data
        if (onUsage) {
          buffer += chunk;
          const lines = buffer.split("\n");
          // Keep the last incomplete line in the buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Try to extract usage from final chunk
            const usage = parseUsageFromSSEChunk(trimmed);
            if (usage) {
              usageFromProvider = usage;
              continue;
            }

            // Accumulate content for fallback estimation
            const content = extractDeltaContent(trimmed);
            if (content) {
              accumulatedContent += content;
              // Extract model from first chunk
              if (model === "unknown" && trimmed.startsWith("data: ")) {
                try {
                  const json = JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
                  if (typeof json["model"] === "string") {
                    model = json["model"];
                  }
                } catch { /* ignore */ }
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Report usage after stream completes
    if (onUsage) {
      if (usageFromProvider) {
        onUsage(usageFromProvider);
      } else if (accumulatedContent.length > 0) {
        // Fallback: estimate from accumulated content
        onUsage(
          buildUsageResult(
            model,
            0,
            estimateTokensFromChars(accumulatedContent.length),
            true,
          ),
        );
      }
    }
  });
}
