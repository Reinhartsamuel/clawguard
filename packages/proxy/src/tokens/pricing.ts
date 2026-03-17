import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ModelPricing {
  inputPer1M: number;           // USD per 1M input tokens
  outputPer1M: number;          // USD per 1M output tokens
  cacheReadPer1M: number;       // USD per 1M cache-read tokens (0 if unsupported)
  cacheCreationPer1M: number;   // USD per 1M cache-creation tokens (0 if unsupported)
}

// ── LiteLLM JSON shape (subset we care about) ────────────────────────────────

interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  litellm_provider?: string;
  mode?: string;
}

// ── Hardcoded fallback table (used when LiteLLM fetch fails) ─────────────────
// Per-1M USD. Cache costs default to 0 for providers that don't support it.

const FALLBACK_TABLE = new Map<string, ModelPricing>([
  // OpenAI
  ["gpt-4o",        { inputPer1M: 2.5,  outputPer1M: 10,  cacheReadPer1M: 1.25, cacheCreationPer1M: 0 }],
  ["gpt-4o-mini",   { inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0.075, cacheCreationPer1M: 0 }],
  ["gpt-4.1",       { inputPer1M: 2,    outputPer1M: 8,   cacheReadPer1M: 0.5,  cacheCreationPer1M: 0 }],
  ["gpt-4.1-mini",  { inputPer1M: 0.4,  outputPer1M: 1.6, cacheReadPer1M: 0.1,  cacheCreationPer1M: 0 }],
  ["gpt-4.1-nano",  { inputPer1M: 0.1,  outputPer1M: 0.4, cacheReadPer1M: 0.025, cacheCreationPer1M: 0 }],
  ["o3-mini",       { inputPer1M: 1.1,  outputPer1M: 4.4, cacheReadPer1M: 0.55, cacheCreationPer1M: 0 }],
  ["o3",            { inputPer1M: 2,    outputPer1M: 8,   cacheReadPer1M: 0.5,  cacheCreationPer1M: 0 }],
  ["o4-mini",       { inputPer1M: 1.1,  outputPer1M: 4.4, cacheReadPer1M: 0.275, cacheCreationPer1M: 0 }],
  // Anthropic
  ["claude-sonnet-4-20250514",   { inputPer1M: 3,   outputPer1M: 15, cacheReadPer1M: 0.3,  cacheCreationPer1M: 3.75 }],
  ["claude-3-7-sonnet-20250219", { inputPer1M: 3,   outputPer1M: 15, cacheReadPer1M: 0.3,  cacheCreationPer1M: 3.75 }],
  ["claude-3-5-sonnet-20241022", { inputPer1M: 3,   outputPer1M: 15, cacheReadPer1M: 0.3,  cacheCreationPer1M: 3.75 }],
  ["claude-3-5-haiku-20241022",  { inputPer1M: 0.8, outputPer1M: 4,  cacheReadPer1M: 0.08, cacheCreationPer1M: 1 }],
  // Google Gemini
  ["gemini-2.5-pro",   { inputPer1M: 1.25, outputPer1M: 10,  cacheReadPer1M: 0,    cacheCreationPer1M: 0 }],
  ["gemini-2.5-flash", { inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0,    cacheCreationPer1M: 0 }],
  ["gemini-2.0-flash", { inputPer1M: 0.1,  outputPer1M: 0.4, cacheReadPer1M: 0,    cacheCreationPer1M: 0 }],
]);

const CONSERVATIVE_FALLBACK: ModelPricing = {
  inputPer1M: 2.5,
  outputPer1M: 10,
  cacheReadPer1M: 0,
  cacheCreationPer1M: 0,
};

// ── In-memory pricing map (populated at startup, falls back to hardcoded) ─────

let liveTable: Map<string, ModelPricing> | null = null;

// ── Provider filtering ────────────────────────────────────────────────────────
// Only pull direct-API providers. Skip managed (bedrock, vertex, azure, etc.)
// because ClawGuard proxies direct endpoints only.

const DIRECT_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "google",
  "mistral",
  "cohere",
  "groq",
  "together_ai",
  "fireworks_ai",
  "deepseek",
  "xai",
]);

function isDirect(entry: LiteLLMEntry): boolean {
  const p = entry.litellm_provider ?? "";
  // Reject managed/proxy providers
  if (p.includes("bedrock") || p.includes("vertex") || p.includes("azure") ||
      p.includes("sagemaker") || p.includes("cloudflare") || p.includes("watsonx") ||
      p.includes("databricks") || p.includes("ibm")) {
    return false;
  }
  return DIRECT_PROVIDERS.has(p) || p === "";
}

// ── Model name normalizer ─────────────────────────────────────────────────────
// LiteLLM keys look like "anthropic/claude-3-5-sonnet-20241022" or just
// "claude-3-5-sonnet-20241022". ClawGuard sees the bare model name from the
// request body (e.g. "claude-3-5-sonnet-20241022").

function stripProviderPrefix(key: string): string {
  const slash = key.indexOf("/");
  return slash >= 0 ? key.slice(slash + 1) : key;
}

// ── Build in-memory table from raw LiteLLM JSON ───────────────────────────────

function buildTable(raw: Record<string, LiteLLMEntry>): Map<string, ModelPricing> {
  const table = new Map<string, ModelPricing>();
  for (const [key, entry] of Object.entries(raw)) {
    if (!isDirect(entry)) continue;
    if (entry.mode && entry.mode !== "chat" && entry.mode !== "completion") continue;
    if (entry.input_cost_per_token == null || entry.output_cost_per_token == null) continue;

    const pricing: ModelPricing = {
      inputPer1M: entry.input_cost_per_token * 1_000_000,
      outputPer1M: entry.output_cost_per_token * 1_000_000,
      cacheReadPer1M: (entry.cache_read_input_token_cost ?? 0) * 1_000_000,
      cacheCreationPer1M: (entry.cache_creation_input_token_cost ?? 0) * 1_000_000,
    };

    // Store both the full key and the prefix-stripped key
    table.set(key, pricing);
    const bare = stripProviderPrefix(key);
    if (bare !== key) table.set(bare, pricing);
  }
  return table;
}

// ── Disk cache ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface PricingCache {
  fetchedAt: number;
  data: Record<string, LiteLLMEntry>;
}

function getCachePath(): string {
  const dbPath = process.env["CLAWGUARD_DB_PATH"] ?? "data/clawguard.db";
  return `${dirname(dbPath)}/pricing-cache.json`;
}

function readDiskCache(): PricingCache | null {
  try {
    const raw = readFileSync(getCachePath(), "utf8");
    const cache = JSON.parse(raw) as PricingCache;
    if (Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
    return null; // expired
  } catch {
    return null;
  }
}

function writeDiskCache(data: Record<string, LiteLLMEntry>): void {
  try {
    const path = getCachePath();
    mkdirSync(dirname(path), { recursive: true });
    const cache: PricingCache = { fetchedAt: Date.now(), data };
    writeFileSync(path, JSON.stringify(cache), "utf8");
  } catch {
    // Non-fatal — disk cache is best-effort
  }
}

// ── Fetch from LiteLLM ────────────────────────────────────────────────────────

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

async function fetchLiteLLM(): Promise<Record<string, LiteLLMEntry> | null> {
  try {
    const res = await fetch(LITELLM_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.json() as Record<string, LiteLLMEntry>;
  } catch {
    return null;
  }
}

// ── Public: load pricing (call once at startup) ───────────────────────────────

export async function loadLivePricing(log?: { info: (msg: string) => void; warn: (msg: string) => void }): Promise<void> {
  // 1. Try disk cache first (avoids network on restart)
  const cached = readDiskCache();
  if (cached) {
    liveTable = buildTable(cached.data);
    log?.info(`pricing: loaded ${liveTable.size} models from disk cache`);
    return;
  }

  // 2. Fetch fresh from LiteLLM
  const data = await fetchLiteLLM();
  if (data) {
    liveTable = buildTable(data);
    writeDiskCache(data);
    log?.info(`pricing: loaded ${liveTable.size} models from LiteLLM`);
    return;
  }

  // 3. Fall back to hardcoded table — this is fine for operation
  log?.warn("pricing: LiteLLM fetch failed, using hardcoded fallback table");
}

// ── Public: lookup ────────────────────────────────────────────────────────────

export function getModelPricing(model: string): ModelPricing {
  const table = liveTable ?? FALLBACK_TABLE;

  // Exact match
  const exact = table.get(model);
  if (exact) return exact;

  // Prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  for (const [key, pricing] of table) {
    if (model.startsWith(key) || key.startsWith(model)) return pricing;
  }

  // Suffix match for date-versioned names not in the table
  // e.g. "claude-3-5-sonnet-20251201" → match "claude-3-5-sonnet"
  const withoutDate = model.replace(/-\d{8}$/, "");
  if (withoutDate !== model) {
    const dateStripped = table.get(withoutDate);
    if (dateStripped) return dateStripped;
    for (const [key, pricing] of table) {
      if (withoutDate.startsWith(key) || key.startsWith(withoutDate)) return pricing;
    }
  }

  return CONSERVATIVE_FALLBACK;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
): number {
  const p = getModelPricing(model);
  return (
    (inputTokens / 1_000_000) * p.inputPer1M +
    (outputTokens / 1_000_000) * p.outputPer1M +
    (cacheReadTokens / 1_000_000) * p.cacheReadPer1M +
    (cacheCreationTokens / 1_000_000) * p.cacheCreationPer1M
  );
}
