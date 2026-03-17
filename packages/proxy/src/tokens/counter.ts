import { calculateCost } from "./pricing.js";

export interface UsageResult {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  estimatedCost: number;
  isEstimated: boolean;
}

const CHARS_PER_TOKEN = 4;

export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

export function buildUsageResult(
  model: string,
  inputTokens: number,
  outputTokens: number,
  isEstimated: boolean,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
): UsageResult {
  return {
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: calculateCost(model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens),
    isEstimated,
  };
}

/**
 * Extract usage from a non-streaming JSON response body.
 * OpenAI responses include: { usage: { prompt_tokens, completion_tokens, total_tokens }, model }
 */
export function parseUsageFromResponse(body: string): UsageResult | null {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const model = typeof json["model"] === "string" ? json["model"] : "unknown";
    const usage = json["usage"] as Record<string, unknown> | undefined;

    if (usage && typeof usage["prompt_tokens"] === "number") {
      // OpenAI: cache tokens live under usage.prompt_tokens_details
      const details = usage["prompt_tokens_details"] as Record<string, unknown> | undefined;
      const cacheReadTokens = typeof details?.["cached_tokens"] === "number" ? details["cached_tokens"] as number : 0;
      // Anthropic: cache tokens at top-level of usage
      const cacheCreationTokens = typeof usage["cache_creation_input_tokens"] === "number" ? usage["cache_creation_input_tokens"] as number : 0;
      const anthropicCacheRead = typeof usage["cache_read_input_tokens"] === "number" ? usage["cache_read_input_tokens"] as number : 0;
      return buildUsageResult(
        model,
        usage["prompt_tokens"] as number,
        (usage["completion_tokens"] as number) ?? 0,
        false,
        cacheReadTokens + anthropicCacheRead,
        cacheCreationTokens,
      );
    }

    // No usage field — estimate from response content
    const choices = json["choices"] as Array<Record<string, unknown>> | undefined;
    if (choices?.[0]) {
      const message = choices[0]["message"] as Record<string, unknown> | undefined;
      const content = typeof message?.["content"] === "string" ? message["content"] : "";
      return buildUsageResult(
        model,
        0, // can't estimate input tokens without the request
        estimateTokensFromChars(content.length),
        true,
      );
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a single SSE data line for usage info.
 * OpenAI streaming final chunk: data: {"usage":{"prompt_tokens":9,"completion_tokens":12,...}}
 * Returns null if this chunk doesn't contain usage.
 */
export function parseUsageFromSSEChunk(line: string): UsageResult | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") return null;

  try {
    const json = JSON.parse(payload) as Record<string, unknown>;
    const usage = json["usage"] as Record<string, unknown> | undefined;
    if (!usage || typeof usage["prompt_tokens"] !== "number") return null;

    const model = typeof json["model"] === "string" ? json["model"] : "unknown";
    const details = usage["prompt_tokens_details"] as Record<string, unknown> | undefined;
    const cacheReadTokens = typeof details?.["cached_tokens"] === "number" ? details["cached_tokens"] as number : 0;
    const cacheCreationTokens = typeof usage["cache_creation_input_tokens"] === "number" ? usage["cache_creation_input_tokens"] as number : 0;
    const anthropicCacheRead = typeof usage["cache_read_input_tokens"] === "number" ? usage["cache_read_input_tokens"] as number : 0;
    return buildUsageResult(
      model,
      usage["prompt_tokens"] as number,
      (usage["completion_tokens"] as number) ?? 0,
      false,
      cacheReadTokens + anthropicCacheRead,
      cacheCreationTokens,
    );
  } catch {
    return null;
  }
}

/**
 * Extract content delta text from a streaming SSE chunk.
 * Used to accumulate character count for fallback token estimation.
 */
export function extractDeltaContent(line: string): string {
  if (!line.startsWith("data: ")) return "";
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") return "";

  try {
    const json = JSON.parse(payload) as Record<string, unknown>;
    const choices = json["choices"] as Array<Record<string, unknown>> | undefined;
    if (!choices?.[0]) return "";
    const delta = choices[0]["delta"] as Record<string, unknown> | undefined;
    return typeof delta?.["content"] === "string" ? delta["content"] : "";
  } catch {
    return "";
  }
}
