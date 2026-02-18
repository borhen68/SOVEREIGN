// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { DataStore } from "../src/store/data-store.js";
import { AgentService } from "../src/services/agent-service.js";
import { SkillService } from "../src/services/skill-service.js";
import { ArchitectureService } from "../src/services/architecture-service.js";

function createStack() {
  const store = new DataStore({ persistPath: null });
  const agentService = new AgentService(store);
  const llmService = {
    listProviders() {
      return [
        {
          provider: "openai",
          configured: true,
          defaultModel: "gpt-4o-mini"
        },
        {
          provider: "anthropic",
          configured: true,
          defaultModel: "claude-opus-4-6"
        },
        {
          provider: "gemini",
          configured: true,
          defaultModel: "gemini-2.5-pro"
        }
      ];
    },
    listModelRefs(options = {}) {
      const all = [
        { modelRef: "openai/gpt-4o-mini" },
        { modelRef: "anthropic/claude-opus-4-6" },
        { modelRef: "gemini/gemini-2.5-pro" }
      ];
      if (options.configuredOnly === true) {
        return all;
      }
      return all;
    }
  };
  const skillService = new SkillService(store, agentService, llmService);
  const architectureService = new ArchitectureService({
    agentService,
    skillService,
    llmService
  });
  return {
    store,
    agentService,
    skillService,
    architectureService
  };
}

test("architecture service builds company plan with spawned specialists and generated skills", async () => {
  const { architectureService } = createStack();

  const plan = await architectureService.buildCompanyPlan({
    workspaceId: "default",
    objective:
      "Grow sales demos, ship coding improvements, and improve reliability with safer operations.",
    teamSize: 4,
    debateRounds: 2,
    autoSpawnSubAgents: true,
    autoGenerateSkills: true
  });

  assert.ok(plan.planId);
  assert.equal(plan.mainAgent.name, "SOVEREIGN Main");
  assert.ok(Array.isArray(plan.workstreams));
  assert.ok(plan.workstreams.length >= 2);
  assert.ok(plan.metrics.spawnedAgents >= 1);
  assert.ok(plan.metrics.generatedSkills >= 1);

  for (const workstream of plan.workstreams) {
    assert.ok(workstream.assignedAgentId);
    assert.ok(workstream.skillId);
    assert.ok(workstream.modelPlan);
  }
});

test("architecture service evolves agent soul from outcomes", async () => {
  const { agentService, architectureService } = createStack();
  const agent = await agentService.createAgent({
    name: "Ops Specialist",
    role: "sub",
    skills: ["operations", "reliability"],
    soul: {
      mission: "Keep systems stable.",
      values: ["discipline"],
      communicationStyle: "direct",
      riskTolerance: "balanced"
    }
  });

  const evolution = await architectureService.evolveAgentSoul({
    agentId: agent.id,
    performanceScore: 0.4,
    outcome: "There was an incident. We need stronger testing and verification."
  });

  assert.equal(evolution.agentAfter.id, agent.id);
  assert.equal(evolution.agentAfter.soul.riskTolerance, "conservative");
  assert.ok(evolution.agentAfter.soul.values.includes("verification-first"));
  assert.ok(evolution.agentAfter.soul.values.includes("resilience"));
});
