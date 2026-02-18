// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { DataStore } from "../src/store/data-store.js";
import { PolicyEngine } from "../src/services/policy-engine.js";
import { MissionService } from "../src/services/mission-service.js";
import { VerificationEngine } from "../src/services/verification-engine.js";
import { ActionState, ApprovalStatus, MissionStatus, TaskStatus } from "../src/domain/constants.js";

function createMissionService() {
  const store = new DataStore({ persistPath: null });
  const policyEngine = new PolicyEngine();
  return new MissionService(store, policyEngine);
}

test("mission lifecycle supports simulation, approvals, and closure metrics", async () => {
  const missionService = createMissionService();
  const mission = await missionService.createMission({
    title: "Reduce bug MTTR",
    objective: "Resolve priority incidents faster.",
    kpi: "Median MTTR under 2h",
    deadline: "2026-03-01",
    policyPreset: "balanced"
  });

  const simulation = await missionService.simulateMission(mission.id);
  assert.equal(simulation.plans.length, 3);

  await missionService.startMission(mission.id);
  const taskA = await missionService.createTask(mission.id, { title: "Triage Sentry alerts" });
  const taskB = await missionService.createTask(mission.id, { title: "Prepare hotfix PR" });

  const safeAction = await missionService.recordAction(mission.id, {
    actionType: "read",
    summary: "Read latest incident logs"
  });
  assert.equal(safeAction.approval, null);
  assert.equal(safeAction.action.state, ActionState.EXECUTED);

  const riskyAction = await missionService.recordAction(mission.id, {
    actionType: "financial",
    summary: "Buy premium monitoring add-on"
  });
  assert.ok(riskyAction.approval);
  assert.equal(riskyAction.approval.status, ApprovalStatus.REQUESTED);
  assert.equal(riskyAction.action.state, ActionState.PENDING_APPROVAL);

  const approved = await missionService.decideApproval(riskyAction.approval.id, {
    decision: "approve",
    actor: "owner"
  });
  assert.equal(approved.status, ApprovalStatus.APPROVED);

  await missionService.updateTaskStatus(mission.id, taskA.id, TaskStatus.DONE);
  await missionService.updateTaskStatus(mission.id, taskB.id, TaskStatus.DONE);

  const afterMission = await missionService.getMission(mission.id);
  assert.equal(afterMission.status, MissionStatus.COMPLETED);

  const metrics = await missionService.getMetrics(mission.id);
  assert.equal(metrics.commitmentClosureRate, 100);
  assert.equal(metrics.approvalsApproved, 1);
  assert.equal(metrics.actionExecutedCount, 2);
});

test("rejected approval blocks action and mission", async () => {
  const missionService = createMissionService();
  const mission = await missionService.createMission({
    title: "Data cleanup",
    objective: "Remove stale exports safely.",
    kpi: "0 stale files left",
    deadline: "2026-03-10"
  });

  const riskyAction = await missionService.recordAction(mission.id, {
    actionType: "destructive",
    summary: "Delete archived raw exports"
  });

  const rejected = await missionService.decideApproval(riskyAction.approval.id, {
    decision: "reject",
    actor: "security"
  });
  assert.equal(rejected.status, ApprovalStatus.REJECTED);

  const missionAfter = await missionService.getMission(mission.id);
  assert.equal(missionAfter.status, MissionStatus.BLOCKED);
});

test("recordAction is idempotent when idempotencyKey is reused", async () => {
  const missionService = createMissionService();
  const mission = await missionService.createMission({
    title: "Idempotency mission",
    objective: "Avoid duplicate side effects.",
    kpi: "0 duplicate actions",
    deadline: "2026-03-12"
  });

  const first = await missionService.recordAction(mission.id, {
    actionType: "external_send",
    summary: "Send follow-up to lead",
    payload: { to: "lead@example.com" },
    idempotencyKey: "action-followup-001"
  });
  assert.equal(first.idempotent, false);

  const replay = await missionService.recordAction(mission.id, {
    actionType: "external_send",
    summary: "Send follow-up to lead",
    payload: { to: "lead@example.com" },
    idempotencyKey: "action-followup-001"
  });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.action.id, first.action.id);

  const timeline = await missionService.getTimeline(mission.id);
  assert.equal(timeline.actions.length, 1);

  await assert.rejects(
    async () => {
      await missionService.recordAction(mission.id, {
        actionType: "external_send",
        summary: "Send different follow-up",
        payload: { to: "other@example.com" },
        idempotencyKey: "action-followup-001"
      });
    },
    (error) => {
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
});

test("verification engine flags contested claims", () => {
  const verificationEngine = new VerificationEngine();
  const result = verificationEngine.verifyClaim({
    claim: "Vendor X has SOC 2 Type II.",
    sources: [
      { type: "social", stance: "support", publishedAt: "2025-05-01" },
      { type: "primary", stance: "contradict", publishedAt: "2026-01-10" }
    ]
  });

  assert.equal(result.contradictionCount, 1);
  assert.ok(["contested", "insufficient"].includes(result.verdict));
});
