// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { DataStore } from "../src/store/data-store.js";
import { PolicyEngine } from "../src/services/policy-engine.js";
import { MissionService } from "../src/services/mission-service.js";
import { AgentService } from "../src/services/agent-service.js";
import { AutopilotService, AutopilotStatus } from "../src/services/autopilot-service.js";

test("autopilot service plans, executes tasks, and completes delegated goal", async () => {
  const store = new DataStore({ persistPath: null });
  const missionService = new MissionService(store, new PolicyEngine());
  const agentService = new AgentService(store);
  const sent = [];
  let runCount = 0;

  const councilService = {
    async runCouncil(missionId, input) {
      runCount += 1;
      const plan =
        String(input.problem).startsWith("Execute this task:")
          ? [`Finished: ${String(input.problem).replace(/^Execute this task:\\s*/i, "")}`]
          : ["Draft execution plan", "Execute delegated workstream"];
      return {
        id: `council-${runCount}`,
        missionId,
        consensus: { consensusScore: 0.9 },
        finalBriefing: {
          recommendedPlan: plan
        }
      };
    },
    listMissionCouncils() {
      return [];
    },
    listMissionCouncilRuns() {
      return [];
    }
  };

  const channelGatewayService = {
    async sendProactiveMessage(input) {
      sent.push(input);
      return {
        delivery: {
          status: "sent"
        }
      };
    }
  };

  const autopilotService = new AutopilotService({
    store,
    missionService,
    agentService,
    councilService,
    channelGatewayService,
    autoStart: false,
    maxCyclesDefault: 10
  });

  const goal = await autopilotService.createGoal({
    workspaceId: "default",
    title: "Ship delegated objective",
    objective: "Launch an autonomous execution flow",
    notifyTargets: [
      {
        channelId: "local",
        chatId: "chat-ops",
        userId: "founder"
      }
    ]
  });

  for (let i = 0; i < 10; i += 1) {
    await autopilotService.runOnce();
    const current = await autopilotService.getGoal(goal.id);
    if (current?.status === AutopilotStatus.DONE) {
      break;
    }
  }

  const completed = await autopilotService.getGoal(goal.id);
  assert.equal(completed.status, AutopilotStatus.DONE);
  assert.ok(completed.missionId);
  assert.ok(completed.mainAgentId);

  const tasks = store.listMissionTasks(completed.missionId);
  assert.ok(tasks.length >= 1);
  assert.equal(tasks.every((task) => task.status === "done"), true);

  const logs = await autopilotService.listGoalLogs(goal.id, 50);
  assert.equal(logs.some((entry) => entry.type === "goal.done"), true);
  assert.equal(sent.length >= 1, true);
});
