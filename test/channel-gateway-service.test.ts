// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { DataStore } from "../src/store/data-store.js";
import { PolicyEngine } from "../src/services/policy-engine.js";
import { MissionService } from "../src/services/mission-service.js";
import { AgentService } from "../src/services/agent-service.js";
import { ChannelGatewayService } from "../src/services/channel-gateway-service.js";

function createStack(input = {}) {
  const store = new DataStore({ persistPath: null });
  const missionService = new MissionService(store, new PolicyEngine());
  const agentService = new AgentService(store);
  const llmService = input.llmService ?? {
    listProviders() {
      return [];
    },
    async respond() {
      return {
        provider: "openai",
        model: "gpt-4o-mini",
        text: "Mocked response"
      };
    }
  };
  const councilService = input.councilService ?? {
    async runCouncil(missionId, args) {
      return {
        id: "council-test",
        missionId,
        consensus: { consensusScore: 0.88 },
        finalBriefing: {
          recommendedPlan: [`Do: ${args.problem}`]
        }
      };
    }
  };
  const pluginService = input.pluginService ?? {
    listPlugins() {
      return [{ id: "demo", toolCount: 1 }];
    },
    async invokeTool(pluginId, toolName, payload) {
      return {
        result: {
          pluginId,
          toolName,
          payload
        }
      };
    }
  };

  const channelGatewayService = new ChannelGatewayService({
    store,
    missionService,
    agentService,
    llmService,
    councilService,
    pluginService
  });

  return {
    store,
    missionService,
    agentService,
    llmService,
    councilService,
    pluginService,
    channelGatewayService
  };
}

test("channel gateway processes local webhook and stores session messages", async () => {
  const { channelGatewayService } = createStack();
  const result = await channelGatewayService.processWebhook("local", {
    workspaceId: "default",
    chatId: "chat-1",
    userId: "user-1",
    text: "hello"
  });

  assert.equal(result.channelId, "local");
  assert.equal(result.processed, 1);
  assert.equal(result.responses.length, 1);
  assert.ok(result.responses[0].reply.includes("SOVEREIGN is running locally"));

  const sessions = await channelGatewayService.listSessions("default");
  assert.equal(sessions.length, 1);
  const messages = await channelGatewayService.listSessionMessages(sessions[0].id, 10);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].direction, "inbound");
  assert.equal(messages[1].direction, "outbound");
});

test("channel gateway supports mission and plugin commands", async () => {
  const { missionService, channelGatewayService } = createStack();
  await missionService.createMission({
    title: "Close launch tasks",
    objective: "Ship with zero blockers",
    kpi: "100% launch checklist done",
    deadline: "2026-03-01"
  });

  const missionsResult = await channelGatewayService.processWebhook("local", {
    workspaceId: "default",
    chatId: "chat-2",
    userId: "user-2",
    text: "/missions"
  });
  assert.ok(missionsResult.responses[0].reply.includes("Close launch tasks"));

  const pluginsResult = await channelGatewayService.processWebhook("local", {
    workspaceId: "default",
    chatId: "chat-2",
    userId: "user-2",
    text: "/plugins"
  });
  assert.ok(pluginsResult.responses[0].reply.includes("demo"));

  const toolResult = await channelGatewayService.processWebhook("local", {
    workspaceId: "default",
    chatId: "chat-2",
    userId: "user-2",
    text: '/tool demo.echo {"text":"hi"}'
  });
  assert.ok(toolResult.responses[0].reply.includes("demo.echo"));
});

test("channel gateway runs council command when main agent exists", async () => {
  const { missionService, agentService, channelGatewayService } = createStack();
  const mission = await missionService.createMission({
    title: "Council mission",
    objective: "Decide execution approach",
    kpi: "One clear plan",
    deadline: "2026-03-10"
  });
  await agentService.createAgent({
    name: "Main Commander",
    role: "main",
    skills: ["strategy"]
  });

  const response = await channelGatewayService.processWebhook("local", {
    workspaceId: "default",
    chatId: "chat-3",
    userId: "user-3",
    text: `/council ${mission.id} | How do we execute this fast?`
  });

  assert.ok(response.responses[0].reply.includes("Council complete"));
});

test("channel gateway exposes adapter capabilities and supports aliases", async () => {
  const { channelGatewayService } = createStack();

  const adapters = channelGatewayService.listAdapters();
  const telegram = adapters.find((adapter) => adapter.id === "telegram");
  assert.ok(telegram);
  assert.equal(Array.isArray(telegram.aliases), true);
  assert.equal(telegram.aliases.includes("tg"), true);
  assert.equal(telegram.capabilities.media, true);

  const result = await channelGatewayService.processWebhook("tg", {
    message: {
      message_id: 11,
      text: "hello from telegram alias",
      chat: { id: 9001, type: "private" },
      from: { id: 42, username: "tester" }
    }
  });

  assert.equal(result.channelId, "telegram");
  assert.equal(result.processed, 1);
});

test("channel gateway prefers workspace main agent model policy for chat", async () => {
  let seenRequest = null;
  const llmService = {
    listModelRefs() {
      return [{ modelRef: "openai/gpt-4o-mini", configured: true }];
    },
    normalizeModelRef(raw) {
      return String(raw ?? "").trim();
    },
    resolveDefaultModelRef() {
      return "openai/gpt-4o-mini";
    },
    async respond(input) {
      seenRequest = input;
      return {
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
        text: "Policy-selected chat reply"
      };
    }
  };
  const { agentService, channelGatewayService } = createStack({ llmService });
  await agentService.createAgent({
    name: "Main Agent",
    role: "main",
    workspaceId: "default",
    model: {
      primary: "anthropic/claude-3-5-sonnet-latest",
      fallbacks: ["openai/gpt-4o-mini"]
    }
  });

  const result = await channelGatewayService.processWebhook("local", {
    workspaceId: "default",
    chatId: "chat-model-policy",
    userId: "user-1",
    text: "Need a strategic answer"
  });

  assert.equal(result.processed, 1);
  assert.equal(result.responses[0].reply, "Policy-selected chat reply");
  assert.equal(seenRequest.modelRef, "anthropic/claude-3-5-sonnet-latest");
  assert.deepEqual(seenRequest.fallbacks, ["openai/gpt-4o-mini"]);
});

test("channel gateway prefers active session agent model policy when provided", async () => {
  let seenRequest = null;
  const llmService = {
    listModelRefs() {
      return [
        { modelRef: "openai/gpt-4o-mini", configured: true },
        { modelRef: "anthropic/claude-3-5-sonnet-latest", configured: true },
        { modelRef: "gemini/gemini-1.5-pro", configured: true }
      ];
    },
    normalizeModelRef(raw) {
      return String(raw ?? "").trim();
    },
    resolveDefaultModelRef() {
      return "openai/gpt-4o-mini";
    },
    async respond(input) {
      seenRequest = input;
      return {
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
        text: "Active-agent-selected chat reply"
      };
    }
  };
  const { agentService, channelGatewayService } = createStack({ llmService });
  await agentService.createAgent({
    name: "Workspace Main",
    role: "main",
    workspaceId: "default",
    model: {
      primary: "openai/gpt-4o-mini",
      fallbacks: ["gemini/gemini-1.5-pro"]
    }
  });
  const specialist = await agentService.createAgent({
    name: "Execution Specialist",
    role: "sub",
    workspaceId: "default",
    model: {
      primary: "anthropic/claude-3-5-sonnet-latest",
      fallbacks: ["openai/gpt-4o-mini"]
    }
  });

  const result = await channelGatewayService.processWebhook("local", {
    workspaceId: "default",
    chatId: "chat-active-agent",
    userId: "user-1",
    text: "Give me a coding plan",
    metadata: {
      activeAgentId: specialist.id
    }
  });

  assert.equal(result.processed, 1);
  assert.equal(result.responses[0].reply, "Active-agent-selected chat reply");
  assert.equal(seenRequest.modelRef, "anthropic/claude-3-5-sonnet-latest");
  assert.deepEqual(seenRequest.fallbacks, ["openai/gpt-4o-mini", "gemini/gemini-1.5-pro"]);
});
