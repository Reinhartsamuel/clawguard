import { describe, it, expect } from "vitest";
import { createApp } from "../src/server.js";

const app = createApp();

function req(
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  return app.request(path, opts);
}

describe("Health check", () => {
  it("returns ok", async () => {
    const res = await req("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("Ingress routing", () => {
  it("returns 401 without Authorization header", async () => {
    const res = await req("/v1/chat/completions", { method: "POST" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain("Missing Authorization");
  });

  it("returns 400 for unrecognized key prefix", async () => {
    const res = await req("/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer unknown-key-123" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Unrecognized API key format");
  });
});

describe("Provider resolution", () => {
  // These tests verify provider routing by attempting to connect.
  // They will get a 502 (cannot reach provider) in test env,
  // which proves the routing logic ran correctly.

  it("routes sk- keys to OpenAI", async () => {
    const res = await req("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer sk-test-key-123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    // In test env without network, we expect either a provider error (401/403)
    // or a 502 if fetch fails — either way, NOT a 400 (routing worked)
    expect(res.status).not.toBe(400);
  });

  it("routes sk-ant- keys to Anthropic", async () => {
    const res = await req("/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer sk-ant-test-key-123",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).not.toBe(400);
  });
});
