// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { LlmService } from "../src/services/llm-service.js";

function mockResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("LLM provider catalog exposes broad provider list", () => {
  const service = new LlmService({});
  const providers = service.listProviders();
  assert.ok(providers.length >= 22);
  assert.equal(providers.some((entry) => entry.provider === "openrouter"), true);
  assert.equal(providers.some((entry) => entry.provider === "ollama"), true);
  assert.equal(providers.some((entry) => entry.provider === "custom"), true);
});

test("LLM service can call openai-compatible provider", async () => {
  let seenUrl = "";
  const service = new LlmService({
    groqApiKey: "groq-test",
    groqBaseUrl: "https://api.groq.com/openai/v1",
    fetchFn: async (url) => {
      seenUrl = url;
      return mockResponse({
        choices: [{ message: { content: "Groq reply" } }],
        usage: { total_tokens: 10 }
      });
    }
  });

  const result = await service.respond({
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    prompt: "say hi"
  });
  assert.equal(result.provider, "groq");
  assert.equal(result.text, "Groq reply");
  assert.ok(seenUrl.includes("api.groq.com/openai/v1/chat/completions"));
});
