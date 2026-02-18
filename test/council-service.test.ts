// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { DataStore } from "../src/store/data-store.js";
import { PolicyEngine } from "../src/services/policy-engine.js";
import { MissionService } from "../src/services/mission-service.js";
import { AgentService } from "../src/services/agent-service.js";
import { SkillService } from "../src/services/skill-service.js";
import { CouncilService } from "../src/services/council-service.js";
import { WebResearchService } from "../src/services/web-research-service.js";

function createStack() {
  const store = new DataStore({ persistPath: null });
  const missionService = new MissionService(store, new PolicyEngine());
  const agentService = new AgentService(store);
  const skillService = new SkillService(store, agentService);
  const webResearchService = new WebResearchService({
    lookupFn: async (query, limit) => {
      const findings = [];
      for (let i = 0; i < limit; i += 1) {
        findings.push({
          title: `Source ${i + 1} for ${query}`,
          snippet: "Synthetic test finding",
          url: `https://example.com/${i + 1}`,
          source: "test"
        });
      }
      return findings;
    }
  });
  const councilService = new CouncilService(
    store,
    missionService,
    agentService,
    webResearchService,
    skillService
  );

  return {
    store,
    missionService,
    agentService,
    councilService,
    skillService
  };
}

test("council run coordinates sub-agents and produces main-agent briefing", async () => {
  const { missionService, agentService, councilService } = createStack();
  const mission = await missionService.createMission({
    title: "Ship onboarding redesign",
    objective: "Increase activation in 30 days.",
    kpi: "Activation +20%",
    deadline: "2026-03-30"
  });

  const mainAgent = await agentService.createAgent({
    name: "Director",
    role: "main",
    skills: ["strategy", "governance"],
    soul: {
      mission: "Align teams around business outcomes.",
      values: ["clarity", "accountability"],
      communicationStyle: "executive"
    }
  });
  const researchAgent = await agentService.createAgent({
    name: "Scout",
    role: "sub",
    skills: ["research", "analysis"],
    canUseWeb: true,
    soul: { mission: "Find weak assumptions early." }
  });
  const buildAgent = await agentService.createAgent({
    name: "Builder",
    role: "sub",
    skills: ["engineering", "coding", "ops"],
    canUseWeb: false,
    soul: { mission: "Ship clean execution plans." }
  });
  const riskAgent = await agentService.createAgent({
    name: "Guardian",
    role: "sub",
    skills: ["security", "governance"],
    canUseWeb: true,
    soul: { mission: "Prevent high-impact failure modes." }
  });

  const council = await councilService.runCouncil(mission.id, {
    problem: "How do we increase activation fast without breaking reliability?",
    mainAgentId: mainAgent.id,
    subAgentIds: [researchAgent.id, buildAgent.id, riskAgent.id],
    allowWebResearch: true
  });

  assert.equal(council.mainAgentId, mainAgent.id);
  assert.equal(council.subAgentIds.length, 3);
  assert.equal(council.teamAssembly, "manual");
  assert.equal(council.debateRounds, 2);
  assert.ok(council.decomposition.length >= 1);
  assert.equal(council.contributions.length, council.decomposition.length);
  assert.ok(council.discussion.length >= 2);
  assert.ok(council.consensus.consensusScore > 0);
  assert.equal(council.finalBriefing.presenterAgentId, mainAgent.id);
  assert.equal(council.finalBriefing.consensusScore, council.consensus.consensusScore);
  assert.ok(Array.isArray(council.finalBriefing.recommendedPlan));
  assert.ok(council.runId);

  const hasWebEvidence = council.contributions.some((item) => item.webFindings.length > 0);
  assert.equal(hasWebEvidence, true);

  const runs = await councilService.listMissionCouncilRuns(mission.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "completed");
  assert.equal(runs[0].councilId, council.id);
  assert.equal(runs[0].id, council.runId);

  const timeline = await missionService.getTimeline(mission.id);
  const councilEvent = timeline.events.find((event) => event.type === "council.completed");
  assert.ok(councilEvent);
});

test("council run is idempotent for repeated requests with the same key", async () => {
  const { missionService, agentService, councilService } = createStack();
  const mission = await missionService.createMission({
    title: "Idempotent council",
    objective: "Avoid duplicate planning runs.",
    kpi: "0 duplicate councils",
    deadline: "2026-03-22"
  });

  const mainAgent = await agentService.createAgent({
    name: "Lead",
    role: "main",
    skills: ["strategy"],
    soul: { mission: "Ship outcomes." }
  });
  const subA = await agentService.createAgent({
    name: "Scout",
    role: "sub",
    skills: ["research", "analysis"],
    canUseWeb: true
  });
  const subB = await agentService.createAgent({
    name: "Builder",
    role: "sub",
    skills: ["engineering", "coding"]
  });

  const first = await councilService.runCouncil(mission.id, {
    problem: "How do we improve trial conversion without churn?",
    mainAgentId: mainAgent.id,
    subAgentIds: [subA.id, subB.id],
    idempotencyKey: "council-conversion-001",
    allowWebResearch: true
  });
  const replay = await councilService.runCouncil(mission.id, {
    problem: "How do we improve trial conversion without churn?",
    mainAgentId: mainAgent.id,
    subAgentIds: [subA.id, subB.id],
    idempotencyKey: "council-conversion-001",
    allowWebResearch: true
  });

  assert.equal(replay.id, first.id);
  const runs = await councilService.listMissionCouncilRuns(mission.id);
  assert.equal(runs.length, 1);

  await assert.rejects(
    async () => {
      await councilService.runCouncil(mission.id, {
        problem: "Different problem with same key",
        mainAgentId: mainAgent.id,
        subAgentIds: [subA.id, subB.id],
        idempotencyKey: "council-conversion-001",
        allowWebResearch: true
      });
    },
    (error) => {
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
});

test("council run auto-assembles sub-agent team and supports multi-round debate", async () => {
  const { missionService, agentService, councilService } = createStack();
  const mission = await missionService.createMission({
    title: "Stabilize growth engine",
    objective: "Improve conversion while preserving reliability.",
    kpi: "Conversion +15%",
    deadline: "2026-04-15"
  });

  const mainAgent = await agentService.createAgent({
    name: "Chief",
    role: "main",
    skills: ["strategy", "planning"],
    soul: { mission: "Coordinate teams around outcome contracts." }
  });
  await agentService.createAgent({
    name: "Sales Hawk",
    role: "sub",
    skills: ["sales", "growth", "planning"],
    canUseWeb: true,
    soul: { mission: "Increase qualified pipeline velocity." }
  });
  await agentService.createAgent({
    name: "Code Forge",
    role: "sub",
    skills: ["engineering", "coding", "ops"],
    soul: { mission: "Ship robust systems fast." }
  });
  await agentService.createAgent({
    name: "Signal Scout",
    role: "sub",
    skills: ["research", "analysis", "product"],
    canUseWeb: true,
    soul: { mission: "Find evidence before decisions." }
  });
  await agentService.createAgent({
    name: "Policy Guard",
    role: "sub",
    skills: ["security", "governance", "compliance"],
    soul: { mission: "Reduce high-impact risk." }
  });

  const council = await councilService.runCouncil(mission.id, {
    problem: "How do we grow demos without increasing incident risk?",
    mainAgentId: mainAgent.id,
    teamSize: 3,
    debateRounds: 3,
    allowWebResearch: true
  });

  assert.equal(council.teamAssembly, "auto");
  assert.equal(council.subAgentIds.length, 3);
  assert.equal(council.debateRounds, 3);
  const rounds = new Set(council.discussion.map((entry) => entry.round));
  assert.ok(rounds.has(1));
  assert.ok(rounds.has(2));
  assert.ok(rounds.has(3));
  assert.equal(typeof council.consensus.consensusScore, "number");
  assert.ok(Array.isArray(council.consensus.votes));
  assert.equal(council.finalBriefing.presenterAgentId, mainAgent.id);
  assert.ok(Array.isArray(council.finalBriefing.teamSoulMap));
  assert.ok(Array.isArray(council.finalBriefing.activatedSkills));
  assert.ok(council.finalBriefing.activatedSkills.length >= 1);
});

test("council run auto-spawns missing specialists and persists per-skill memory", async () => {
  const { missionService, agentService, councilService, skillService } = createStack();
  const mission = await missionService.createMission({
    title: "Launch reliability sprint",
    objective: "Reduce incidents while maintaining feature velocity.",
    kpi: "Incident rate -30%",
    deadline: "2026-04-20"
  });
  const mainAgent = await agentService.createAgent({
    name: "Commander",
    role: "main",
    skills: ["strategy", "governance"],
    soul: { mission: "Coordinate teams for reliable delivery." }
  });
  const singleSubAgent = await agentService.createAgent({
    name: "Existing Builder",
    role: "sub",
    skills: ["engineering", "coding"],
    soul: { mission: "Ship clean changes quickly." }
  });

  const council = await councilService.runCouncil(mission.id, {
    problem: "How can we ship features without reliability regressions?",
    mainAgentId: mainAgent.id,
    teamSize: 3,
    allowWebResearch: true,
    autoSpawnSubAgents: true,
    autoGenerateSkills: true
  });

  assert.equal(council.subAgentIds.length, 3);
  assert.ok(council.spawnedSubAgentIds.length >= 1);
  assert.ok(council.spawnedSubAgentIds.every((id) => id !== singleSubAgent.id));
  assert.ok(council.contributions.every((item) => item.activatedSkill && item.activatedSkill.id));
  assert.ok(council.contributions.every((item) => item.skillMemory && item.skillMemory.id));

  for (const agentId of council.subAgentIds) {
    const skills = await skillService.listAgentSkills(agentId);
    assert.ok(skills.length >= 1);
    assert.ok(skills.some((skill) => Array.isArray(skill.memory) && skill.memory.length >= 1));
  }

  assert.ok(council.finalBriefing.activatedSkills.length >= 1);
});

test("council run rejects invalid agent assignments", async () => {
  const { missionService, agentService, councilService } = createStack();
  const mission = await missionService.createMission({
    title: "Test mission",
    objective: "Test invalid setup.",
    kpi: "No KPI regressions",
    deadline: "2026-03-01"
  });
  const mainAgent = await agentService.createAgent({
    name: "Main",
    role: "main",
    skills: ["strategy"]
  });

  await assert.rejects(
    async () => {
      await councilService.runCouncil(mission.id, {
        problem: "Invalid config",
        mainAgentId: mainAgent.id,
        subAgentIds: [mainAgent.id]
      });
    },
    (error) => {
      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});
