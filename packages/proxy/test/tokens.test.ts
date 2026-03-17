import { describe, it, expect } from "vitest";
import { calculateCost, getModelPricing } from "../src/tokens/pricing.js";
import {
  parseUsageFromResponse,
  parseUsageFromSSEChunk,
  extractDeltaContent,
  estimateTokensFromChars,
  buildUsageResult,
} from "../src/tokens/counter.js";

describe("Pricing", () => {
  it("returns exact pricing for known models", () => {
    const pricing = getModelPricing("gpt-4o-mini");
    expect(pricing.inputPer1M).toBe(0.15);
    expect(pricing.outputPer1M).toBe(0.6);
  });

  it("matches by prefix for versioned models", () => {
    const pricing = getModelPricing("gpt-4o-2024-08-06");
    expect(pricing.inputPer1M).toBe(2.5);
  });

  it("returns fallback pricing for unknown models", () => {
    const pricing = getModelPricing("some-unknown-model");
    expect(pricing.inputPer1M).toBe(2.5);
    expect(pricing.outputPer1M).toBe(10);
  });

  it("calculates cost correctly", () => {
    // 1000 input tokens + 500 output tokens of gpt-4o-mini
    // (1000/1M) * 0.15 + (500/1M) * 0.6 = 0.00015 + 0.0003 = 0.00045
    const cost = calculateCost("gpt-4o-mini", 1000, 500);
    expect(cost).toBeCloseTo(0.00045, 6);
  });
});

describe("Token estimation", () => {
  it("estimates tokens from character count", () => {
    expect(estimateTokensFromChars(100)).toBe(25);
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(3)).toBe(1); // rounds up
  });
});

describe("parseUsageFromResponse", () => {
  it("parses OpenAI non-streaming response", () => {
    const body = JSON.stringify({
      id: "chatcmpl-123",
      model: "gpt-4o-mini",
      choices: [{ message: { role: "assistant", content: "Hello!" } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });

    const result = parseUsageFromResponse(body);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("gpt-4o-mini");
    expect(result!.inputTokens).toBe(10);
    expect(result!.outputTokens).toBe(5);
    expect(result!.totalTokens).toBe(15);
    expect(result!.isEstimated).toBe(false);
    expect(result!.estimatedCost).toBeGreaterThan(0);
  });

  it("falls back to content estimation when no usage field", () => {
    const body = JSON.stringify({
      model: "gpt-4o-mini",
      choices: [{ message: { role: "assistant", content: "Hello world!" } }],
    });

    const result = parseUsageFromResponse(body);
    expect(result).not.toBeNull();
    expect(result!.isEstimated).toBe(true);
    expect(result!.outputTokens).toBe(3); // 12 chars / 4
  });

  it("returns null for invalid JSON", () => {
    expect(parseUsageFromResponse("not json")).toBeNull();
  });
});

describe("parseUsageFromSSEChunk", () => {
  it("parses usage from final streaming chunk", () => {
    const line =
      'data: {"id":"chatcmpl-123","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":9,"completion_tokens":12,"total_tokens":21}}';

    const result = parseUsageFromSSEChunk(line);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(9);
    expect(result!.outputTokens).toBe(12);
    expect(result!.isEstimated).toBe(false);
  });

  it("returns null for content chunks without usage", () => {
    const line =
      'data: {"id":"chatcmpl-123","model":"gpt-4o-mini","choices":[{"delta":{"content":"Hi"}}]}';
    expect(parseUsageFromSSEChunk(line)).toBeNull();
  });

  it("returns null for [DONE]", () => {
    expect(parseUsageFromSSEChunk("data: [DONE]")).toBeNull();
  });

  it("returns null for non-data lines", () => {
    expect(parseUsageFromSSEChunk("event: ping")).toBeNull();
  });
});

describe("extractDeltaContent", () => {
  it("extracts content from delta chunk", () => {
    const line =
      'data: {"choices":[{"delta":{"content":"Hello"}}]}';
    expect(extractDeltaContent(line)).toBe("Hello");
  });

  it("returns empty string for non-content chunks", () => {
    const line =
      'data: {"choices":[{"delta":{"role":"assistant"}}]}';
    expect(extractDeltaContent(line)).toBe("");
  });

  it("returns empty string for [DONE]", () => {
    expect(extractDeltaContent("data: [DONE]")).toBe("");
  });
});

describe("buildUsageResult", () => {
  it("builds a complete usage result", () => {
    const result = buildUsageResult("gpt-4o-mini", 100, 50, false);
    expect(result.totalTokens).toBe(150);
    expect(result.estimatedCost).toBeGreaterThan(0);
    expect(result.isEstimated).toBe(false);
  });
});
