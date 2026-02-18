// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { DataStore } from "../src/store/data-store.js";
import { AgentService } from "../src/services/agent-service.js";

test("AgentService stores model primary and deduped fallbacks", async () => {
  const store = new DataStore({ persistPath: null });
  const agentService = new AgentService(store);

  const agent = await agentService.createAgent({
    name: "Main Strategist",
    role: "main",
    model: {
      primary: "openai/gpt-4o-mini",
      fallbacks: [
        "anthropic/claude-3-5-sonnet-latest",
        "openai/gpt-4o-mini",
        "gemini/gemini-1.5-pro",
        "anthropic/claude-3-5-sonnet-latest"
      ]
    }
  });

  assert.equal(agent.model.primary, "openai/gpt-4o-mini");
  assert.deepEqual(agent.model.fallbacks, [
    "anthropic/claude-3-5-sonnet-latest",
    "gemini/gemini-1.5-pro"
  ]);
});

test("AgentService update supports model shorthand provider+model", async () => {
  const store = new DataStore({ persistPath: null });
  const agentService = new AgentService(store);
  const agent = await agentService.createAgent({
    name: "Closer",
    role: "sub"
  });

  const updated = await agentService.updateAgent(agent.id, {
    model: {
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      fallbacks: "openai/gpt-4o-mini,gemini/gemini-1.5-pro"
    }
  });

  assert.equal(updated.model.primary, "anthropic/claude-3-5-sonnet-latest");
  assert.deepEqual(updated.model.fallbacks, ["openai/gpt-4o-mini", "gemini/gemini-1.5-pro"]);
});
