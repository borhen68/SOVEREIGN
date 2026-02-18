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

test("LlmService calls OpenAI and returns text", async () => {
  let seen = null;
  const service = new LlmService({
    openaiApiKey: "openai-test",
    fetchFn: async (url, init) => {
      seen = { url, init };
      return mockResponse({
        choices: [{ message: { content: "OpenAI reply" } }],
        usage: { total_tokens: 42 }
      });
    }
  });

  const result = await service.respond({
    provider: "openai",
    model: "gpt-4o-mini",
    prompt: "Say hello."
  });

  assert.equal(result.provider, "openai");
  assert.equal(result.text, "OpenAI reply");
  assert.ok(seen.url.includes("api.openai.com"));
});

test("LlmService supports modelRef and provider aliases", async () => {
  let seenUrl = "";
  const service = new LlmService({
    geminiApiKey: "gemini-test",
    fetchFn: async (url) => {
      seenUrl = url;
      return mockResponse({
        candidates: [
          {
            content: {
              parts: [{ text: "Gemini reply" }]
            }
          }
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 12 }
      });
    }
  });

  const result = await service.respond({
    modelRef: "google/gemini-1.5-pro",
    prompt: "Say hello."
  });

  assert.equal(result.provider, "gemini");
  assert.equal(result.modelRef, "gemini/gemini-1.5-pro");
  assert.equal(result.text, "Gemini reply");
  assert.ok(seenUrl.includes("generativelanguage.googleapis.com"));
});

test("LlmService falls back to next modelRef when primary fails", async () => {
  const requests = [];
  const service = new LlmService({
    openaiApiKey: "openai-test",
    anthropicApiKey: "anthropic-test",
    openaiModel: "gpt-4o-mini",
    anthropicModel: "claude-3-5-sonnet-latest",
    fetchFn: async (url) => {
      requests.push(url);
      if (url.includes("api.openai.com")) {
        return mockResponse({ error: "upstream failure" }, 500);
      }
      if (url.includes("api.anthropic.com")) {
        return mockResponse({
          content: [{ type: "text", text: "Anthropic fallback reply" }]
        });
      }
      return mockResponse({ error: "unexpected url" }, 500);
    }
  });

  const result = await service.respond({
    modelRef: "openai/gpt-4o-mini",
    fallbacks: ["anthropic/claude-3-5-sonnet-latest"],
    prompt: "Need a robust answer."
  });

  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-3-5-sonnet-latest");
  assert.equal(result.text, "Anthropic fallback reply");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].provider, "openai");
  assert.equal(result.attempts[0].model, "gpt-4o-mini");
  assert.equal(requests.some((url) => url.includes("api.openai.com")), true);
  assert.equal(requests.some((url) => url.includes("api.anthropic.com")), true);
});

test("LlmService calls Anthropic and returns text blocks", async () => {
  let seen = null;
  const service = new LlmService({
    anthropicApiKey: "anthropic-test",
    fetchFn: async (url, init) => {
      seen = { url, init };
      return mockResponse({
        content: [{ type: "text", text: "Anthropic reply" }],
        usage: { input_tokens: 10, output_tokens: 20 }
      });
    }
  });

  const result = await service.respond({
    provider: "anthropic",
    model: "claude-3-5-sonnet-latest",
    prompt: "Say hello."
  });

  assert.equal(result.provider, "anthropic");
  assert.equal(result.text, "Anthropic reply");
  assert.ok(seen.url.includes("api.anthropic.com"));
});

test("LlmService calls Gemini and returns candidate text", async () => {
  let seen = null;
  const service = new LlmService({
    geminiApiKey: "gemini-test",
    fetchFn: async (url, init) => {
      seen = { url, init };
      return mockResponse({
        candidates: [
          {
            content: {
              parts: [{ text: "Gemini reply" }]
            }
          }
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 12 }
      });
    }
  });

  const result = await service.respond({
    provider: "gemini",
    model: "gemini-1.5-pro",
    prompt: "Say hello."
  });

  assert.equal(result.provider, "gemini");
  assert.equal(result.text, "Gemini reply");
  assert.ok(seen.url.includes("generativelanguage.googleapis.com"));
});

test("LlmService errors when provider key is not configured", async () => {
  const service = new LlmService({
    fetchFn: async () => mockResponse({})
  });

  await assert.rejects(
    async () => {
      await service.respond({
        provider: "openai",
        prompt: "Test"
      });
    },
    (error) => {
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});

test("LlmService lists model refs with configuredOnly filter", () => {
  const service = new LlmService({
    openaiApiKey: "openai-test",
    openaiModel: "gpt-4o-mini",
    anthropicModel: "claude-3-5-sonnet-latest"
  });

  const allModels = service.listModelRefs({ configuredOnly: false });
  const configuredModels = service.listModelRefs({ configuredOnly: true });

  assert.equal(allModels.some((entry) => entry.modelRef === "openai/gpt-4o-mini"), true);
  assert.equal(
    allModels.some((entry) => entry.modelRef === "anthropic/claude-3-5-sonnet-latest"),
    true
  );
  assert.equal(configuredModels.some((entry) => entry.provider === "openai"), true);
  assert.equal(configuredModels.some((entry) => entry.provider === "anthropic"), false);
});
