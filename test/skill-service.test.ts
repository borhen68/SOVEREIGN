// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { DataStore } from "../src/store/data-store.js";
import { AgentService } from "../src/services/agent-service.js";
import { SkillService } from "../src/services/skill-service.js";

function createStack() {
  const store = new DataStore({ persistPath: null });
  const agentService = new AgentService(store);
  const skillService = new SkillService(store, agentService);
  return { store, agentService, skillService };
}

test("agent auto-generates task-specific skill and reuses it on replay", async () => {
  const { agentService, skillService } = createStack();
  const agent = await agentService.createAgent({
    name: "Closer",
    role: "sub",
    skills: ["planning"],
    soul: {
      mission: "Turn pipeline into closed revenue."
    }
  });

  const first = await skillService.generateSkill(agent.id, {
    task: "Plan outreach cadence for enterprise leads and increase demo bookings."
  });
  assert.equal(first.created, true);
  assert.equal(first.skill.agentId, agent.id);
  assert.ok(first.skill.tags.includes("sales"));

  const replay = await skillService.generateSkill(agent.id, {
    task: "Plan outreach cadence for enterprise leads and increase demo bookings."
  });
  assert.equal(replay.created, false);
  assert.equal(replay.skill.id, first.skill.id);

  const allSkills = await skillService.listAgentSkills(agent.id);
  assert.equal(allSkills.length, 1);

  const enrichedAgent = await agentService.getAgent(agent.id);
  assert.ok(enrichedAgent.skills.includes("sales"));
});

test("skill memory persists per skill and remains queryable", async () => {
  const { agentService, skillService } = createStack();
  const agent = await agentService.createAgent({
    name: "Builder",
    role: "sub",
    skills: ["coding", "testing"]
  });

  const generated = await skillService.generateSkill(agent.id, {
    task: "Fix checkout bug and add regression tests."
  });
  const skill = generated.skill;

  const firstMemory = await skillService.addSkillMemory(agent.id, skill.id, {
    note: "Root cause was stale cart cache.",
    outcome: "Error rate dropped after cache invalidation.",
    source: "task.run",
    score: 0.84
  });
  assert.equal(firstMemory.skill.memory.length, 1);

  const secondMemory = await skillService.addSkillMemory(agent.id, skill.id, {
    note: "Regression tests now cover duplicate payment scenario.",
    source: "task.run"
  });
  assert.equal(secondMemory.skill.memory.length, 2);

  const memory = await skillService.listSkillMemory(agent.id, skill.id);
  assert.equal(memory.length, 2);
  assert.equal(memory[0].source, "task.run");
});

test("seed memory is attached when generating a new skill", async () => {
  const { agentService, skillService } = createStack();
  const agent = await agentService.createAgent({
    name: "Operator",
    role: "sub",
    skills: ["operations"]
  });

  const generated = await skillService.generateSkill(agent.id, {
    task: "Create incident triage playbook for API latency spikes.",
    seedMemory: {
      note: "First triage draft reduced response time for on-call handoff.",
      outcome: "handoff time improved",
      source: "mission.bootstrap"
    }
  });

  assert.equal(generated.created, true);
  assert.equal(generated.skill.memory.length, 1);
  assert.equal(generated.skill.memory[0].source, "mission.bootstrap");
});

test("LLM-backed skill generation customizes the generated skill", async () => {
  const store = new DataStore({ persistPath: null });
  const agentService = new AgentService(store);
  const fakeLlmService = {
    respond: async () => ({
      provider: "openai",
      model: "gpt-4o-mini",
      text: JSON.stringify({
        name: "Checkout Recovery Skill",
        summary: "Handles checkout retry edge cases with validation and rollback.",
        tags: ["coding", "testing", "operations"],
        triggerPatterns: ["when-task-includes:checkout", "when-task-includes:retry"],
        executionSteps: [
          "Reproduce failure with deterministic tests.",
          "Patch retry idempotency and validate no double charge.",
          "Deploy guarded rollout and monitor error budget."
        ],
        confidence: 0.91
      })
    })
  };
  const skillService = new SkillService(store, agentService, fakeLlmService);
  const agent = await agentService.createAgent({
    name: "Engineer",
    role: "sub",
    skills: ["coding"]
  });

  const generated = await skillService.generateSkillWithLlm(agent.id, {
    task: "Fix checkout retry bug in payment service",
    llm: {
      provider: "openai",
      model: "gpt-4o-mini"
    }
  });

  assert.equal(generated.created, true);
  assert.equal(generated.llm.used, true);
  assert.equal(generated.skill.name, "Checkout Recovery Skill");
  assert.ok(generated.skill.tags.includes("operations"));
  assert.ok(generated.skill.executionSteps.length >= 3);
});

test("LLM skill generation uses agent model policy when llm config is empty", async () => {
  const store = new DataStore({ persistPath: null });
  const agentService = new AgentService(store);
  const seen = [];
  const fakeLlmService = {
    respond: async (input) => {
      seen.push(input);
      return {
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
        text: JSON.stringify({
          name: "Policy Driven Skill",
          summary: "Generated with per-agent model policy.",
          tags: ["planning"],
          triggerPatterns: ["domain:planning"],
          executionSteps: ["Define plan and execute in checkpoints."],
          confidence: 0.82
        })
      };
    }
  };
  const skillService = new SkillService(store, agentService, fakeLlmService);
  const agent = await agentService.createAgent({
    name: "Planner",
    role: "sub",
    skills: ["planning"],
    model: {
      primary: "anthropic/claude-3-5-sonnet-latest",
      fallbacks: ["openai/gpt-4o-mini"]
    }
  });

  const generated = await skillService.generateSkillWithLlm(agent.id, {
    task: "Build Q2 launch execution plan",
    llm: {}
  });

  assert.equal(generated.created, true);
  assert.equal(generated.llm.used, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].modelRef, "anthropic/claude-3-5-sonnet-latest");
  assert.deepEqual(seen[0].fallbacks, ["openai/gpt-4o-mini"]);
});

test("LLM skill generation routes complex coding tasks to stronger models", async () => {
  const store = new DataStore({ persistPath: null });
  const agentService = new AgentService(store);
  const seen = [];
  const fakeLlmService = {
    listModelRefs() {
      return [
        { modelRef: "openai/gpt-4o-mini", configured: true },
        { modelRef: "anthropic/claude-opus-4-6", configured: true },
        { modelRef: "gemini/gemini-2.0-flash", configured: true }
      ];
    },
    normalizeModelRef(raw) {
      return String(raw ?? "").trim();
    },
    resolveDefaultModelRef() {
      return "openai/gpt-4o-mini";
    },
    async respond(input) {
      seen.push(input);
      const [provider, ...rest] = String(input.modelRef ?? "openai/gpt-4o-mini").split("/");
      return {
        provider,
        model: rest.join("/"),
        modelRef: input.modelRef,
        text: JSON.stringify({
          name: "Complex Coding Skill",
          summary: "Uses strong model for deep coding tasks.",
          tags: ["coding", "testing"],
          triggerPatterns: ["domain:coding"],
          executionSteps: ["Design architecture", "Implement and test"],
          confidence: 0.9
        })
      };
    }
  };

  const skillService = new SkillService(store, agentService, fakeLlmService);
  const agent = await agentService.createAgent({
    name: "Architect",
    role: "sub",
    skills: ["coding"]
  });

  const generated = await skillService.generateSkillWithLlm(agent.id, {
    task:
      "Design distributed multi-agent coding architecture, refactor core execution loop, optimize performance, and harden reliability.",
    llm: {}
  });

  assert.equal(generated.created, true);
  assert.equal(generated.llm.used, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].modelRef, "anthropic/claude-opus-4-6");
  assert.equal(seen[0].fallbacks.includes("openai/gpt-4o-mini"), true);
  assert.equal(generated.llm.routing.tier, "high");
});

test("LLM skill generation routes simple tasks to smaller models", async () => {
  const store = new DataStore({ persistPath: null });
  const agentService = new AgentService(store);
  const seen = [];
  const fakeLlmService = {
    listModelRefs() {
      return [
        { modelRef: "anthropic/claude-opus-4-6", configured: true },
        { modelRef: "openai/gpt-4o-mini", configured: true },
        { modelRef: "gemini/gemini-2.0-flash", configured: true }
      ];
    },
    normalizeModelRef(raw) {
      return String(raw ?? "").trim();
    },
    resolveDefaultModelRef() {
      return "anthropic/claude-opus-4-6";
    },
    async respond(input) {
      seen.push(input);
      const [provider, ...rest] = String(input.modelRef ?? "openai/gpt-4o-mini").split("/");
      return {
        provider,
        model: rest.join("/"),
        modelRef: input.modelRef,
        text: JSON.stringify({
          name: "Simple Task Skill",
          summary: "Uses smaller model for lightweight tasks.",
          tags: ["planning"],
          triggerPatterns: ["domain:planning"],
          executionSteps: ["Draft quick response"],
          confidence: 0.76
        })
      };
    }
  };

  const skillService = new SkillService(store, agentService, fakeLlmService);
  const agent = await agentService.createAgent({
    name: "Lightweight Planner",
    role: "sub",
    skills: ["planning"],
    model: {
      primary: "anthropic/claude-opus-4-6",
      fallbacks: ["gemini/gemini-2.0-flash"]
    }
  });

  const generated = await skillService.generateSkillWithLlm(agent.id, {
    task: "Summarize yesterday standup in 3 short bullet points.",
    llm: {}
  });

  assert.equal(generated.created, true);
  assert.equal(generated.llm.used, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].modelRef, "openai/gpt-4o-mini");
  assert.equal(seen[0].fallbacks.includes("anthropic/claude-opus-4-6"), true);
  assert.equal(generated.llm.routing.tier, "small");
});
