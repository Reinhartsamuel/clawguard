import { createHash } from "node:crypto";
import type { Context } from "hono";
import { providerMap } from "../config/defaults.js";

export interface IngressResult {
  apiKey: string;
  providerBaseUrl: string;
  keyHash: string;
}

export function hashKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

export function parseIngress(c: Context): IngressResult {
  const authHeader = c.req.header("authorization");
  if (!authHeader) {
    throw new ProxyError(401, "Missing Authorization header");
  }

  const apiKey = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (!apiKey) {
    throw new ProxyError(401, "Empty API key");
  }

  const provider = providerMap.find((p) => apiKey.startsWith(p.prefix));
  if (!provider) {
    throw new ProxyError(
      400,
      `Unrecognized API key format. Supported prefixes: ${providerMap.map((p) => p.prefix).join(", ")}`,
    );
  }

  return { apiKey, providerBaseUrl: provider.baseUrl, keyHash: hashKey(apiKey) };
}

export class ProxyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProxyError";
  }
}
