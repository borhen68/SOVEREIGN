// @ts-nocheck
import { makeId } from "../lib/id.js";
import { normalizeModelPolicy } from "../lib/model-policy.js";
import { nowIso } from "../lib/time.js";
import { AgentRole } from "../domain/constants.js";
import { createLocalChatAdapter } from "./channel-adapters/local-chat-adapter.js";
import { createTelegramAdapter } from "./channel-adapters/telegram-adapter.js";
import { createWhatsappAdapter } from "./channel-adapters/whatsapp-adapter.js";

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeStringList(input, options = {}) {
  const splitCommas = options.splitCommas === true;
  if (Array.isArray(input)) {
    return input
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }
  const value = normalizeString(input);
  if (!value) {
    return [];
  }
  if (!splitCommas) {
    return [value];
  }
  return value
    .split(",")
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function normalizeUniqueLowercaseList(input, options = {}) {
  const values = normalizeStringList(input, options);
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeUniqueList(input, options = {}) {
  const values = normalizeStringList(input, options);
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    out.push(value);
  }
  return out;
}

function normalizeAdapterCapabilities(capabilities) {
  const source = capabilities && typeof capabilities === "object" ? capabilities : {};
  const chatTypes = normalizeUniqueLowercaseList(source.chatTypes);
  const normalized = {};
  if (chatTypes.length > 0) {
    normalized.chatTypes = chatTypes;
  }
  for (const key of [
    "polls",
    "reactions",
    "edit",
    "unsend",
    "reply",
    "effects",
    "groupManagement",
    "threads",
    "media",
    "nativeCommands",
    "blockStreaming"
  ]) {
    if (typeof source[key] === "boolean") {
      normalized[key] = source[key];
    }
  }
  return normalized;
}

function normalizeAdapterReloadHints(reload) {
  const source = reload && typeof reload === "object" ? reload : {};
  const configPrefixes = normalizeStringList(source.configPrefixes);
  const noopPrefixes = normalizeStringList(source.noopPrefixes);
  return {
    configPrefixes,
    noopPrefixes
  };
}

function normalizeAdapterConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  const normalized = {
    supportsAccounts: Boolean(source.supportsAccounts),
    requiredEnv: normalizeUniqueList(source.requiredEnv),
    requiredEnvForSend: normalizeUniqueList(source.requiredEnvForSend),
    optionalEnv: normalizeUniqueList(source.optionalEnv)
  };
  return normalized;
}

function sessionKey(input) {
  return `${input.channel}:${input.workspaceId}:${input.chatId}:${input.userId}`;
}

function truncate(value, max = 500) {
  const text = String(value ?? "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function parseCommand(text) {
  const raw = normalizeString(text);
  if (!raw.startsWith("/")) {
    return null;
  }
  const [head, ...tail] = raw.split(" ");
  return {
    name: head.toLowerCase(),
    args: tail.join(" ").trim()
  };
}

function parseToolReference(input) {
  const trimmed = normalizeString(input);
  if (!trimmed) {
    return null;
  }
  const [identifier, ...rest] = trimmed.split(" ");
  const [pluginId, toolName] = identifier.split(".");
  if (!pluginId || !toolName) {
    return null;
  }
  const jsonSegment = rest.join(" ").trim();
  let parsedInput = {};
  if (jsonSegment) {
    try {
      parsedInput = JSON.parse(jsonSegment);
    } catch {
      throw badRequest("Tool input must be valid JSON, e.g. /tool plugin.tool {\"x\":1}");
    }
  }
  if (!parsedInput || typeof parsedInput !== "object" || Array.isArray(parsedInput)) {
    throw badRequest("Tool input JSON must be an object.");
  }
  return {
    pluginId,
    toolName,
    input: parsedInput
  };
}

function parseCouncilArgs(input) {
  const trimmed = normalizeString(input);
  if (!trimmed) {
    return null;
  }
  const [missionPart, ...problemParts] = trimmed.split("|");
  const missionId = normalizeString(missionPart);
  const problem = normalizeString(problemParts.join("|"));
  if (!missionId || !problem) {
    return null;
  }
  return {
    missionId,
    problem
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

export class ChannelGatewayService {
  constructor(options = {}) {
    this.store = options.store;
    this.missionService = options.missionService;
    this.agentService = options.agentService;
    this.llmService = options.llmService;
    this.councilService = options.councilService;
    this.pluginService = options.pluginService ?? null;
    this.defaultProvider = normalizeString(options.defaultProvider ?? process.env.CHAT_PROVIDER).toLowerCase();
    this.defaultModelRef = normalizeString(
      options.defaultModelRef ?? process.env.CHAT_MODEL_PRIMARY
    );
    this.defaultModelFallbacks = normalizeStringList(
      options.defaultModelFallbacks ?? process.env.CHAT_MODEL_FALLBACKS,
      { splitCommas: true }
    );
    this.defaultWorkspaceId = normalizeString(options.defaultWorkspaceId, "default");
    this.adapters = new Map();
    this.adapterAliases = new Map();
    this.#registerBuiltins(options);
  }

  registerAdapter(adapter) {
    if (!adapter || typeof adapter !== "object") {
      throw badRequest("Adapter must be an object.");
    }
    const id = normalizeString(adapter.id).toLowerCase();
    if (!id) {
      throw badRequest("Adapter id is required.");
    }
    if (typeof adapter.parseInbound !== "function") {
      throw badRequest(`Adapter '${id}' must implement parseInbound.`);
    }
    const aliases = normalizeUniqueLowercaseList(adapter.aliases).filter((alias) => alias !== id);
    const existingAdapter = this.adapters.get(id);
    if (existingAdapter?.aliases) {
      for (const alias of existingAdapter.aliases) {
        this.adapterAliases.delete(alias);
      }
    }
    for (const alias of aliases) {
      const existingOwner = this.adapterAliases.get(alias);
      if (existingOwner && existingOwner !== id) {
        throw badRequest(`Adapter alias '${alias}' already belongs to '${existingOwner}'.`);
      }
      if (this.adapters.has(alias) && alias !== id) {
        throw badRequest(`Adapter alias '${alias}' conflicts with adapter id '${alias}'.`);
      }
    }

    const normalizedAdapter = {
      ...adapter,
      id,
      aliases,
      name: normalizeString(adapter.name, id),
      description: normalizeString(adapter.description),
      capabilities: normalizeAdapterCapabilities(adapter.capabilities),
      reload: normalizeAdapterReloadHints(adapter.reload),
      config: normalizeAdapterConfig(adapter.config)
    };
    this.adapters.set(id, normalizedAdapter);
    for (const alias of aliases) {
      this.adapterAliases.set(alias, id);
    }
  }

  listAdapters() {
    return [...this.adapters.values()]
      .map((adapter) => ({
        id: adapter.id,
        aliases: adapter.aliases ?? [],
        name: adapter.name,
        description: adapter.description,
        capabilities: adapter.capabilities ?? {},
        reload: adapter.reload ?? { configPrefixes: [], noopPrefixes: [] },
        config: adapter.config ?? {
          supportsAccounts: false,
          requiredEnv: [],
          requiredEnvForSend: [],
          optionalEnv: []
        },
        configured: this.#readAdapterConfigured(adapter),
        supportsSend: typeof adapter.sendMessage === "function",
        supportsWebhookVerification: typeof adapter.verifyWebhook === "function"
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async listSessions(workspaceId = null) {
    const targetWorkspaceId = workspaceId ? normalizeString(workspaceId) : null;
    return this.store.listChannelSessions(targetWorkspaceId);
  }

  async listSessionMessages(sessionId, limit = 50) {
    const id = normalizeString(sessionId);
    if (!id) {
      throw badRequest("sessionId is required.");
    }
    const session = await this.store.getChannelSessionById(id);
    if (!session) {
      throw notFound("Channel session not found.");
    }
    const safeLimit = clampInt(limit, 50, 1, 200);
    return this.store.listChannelSessionMessages(id, safeLimit);
  }

  async sendProactiveMessage(input = {}) {
    const channelId = normalizeString(input.channelId).toLowerCase();
    if (!channelId) {
      throw badRequest("channelId is required.");
    }
    const text = normalizeString(input.text);
    if (!text) {
      throw badRequest("text is required.");
    }
    const adapter = this.#requireAdapter(channelId);
    if (typeof adapter.sendMessage !== "function") {
      throw badRequest(`Channel '${adapter.id}' does not support sendMessage.`);
    }

    const event = this.#normalizeEvent(
      adapter.id,
      {
        workspaceId: input.workspaceId ?? this.defaultWorkspaceId,
        chatId: input.chatId,
        userId: input.userId,
        text: "",
        messageId: null,
        metadata: {
          proactive: true,
          ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {})
        }
      },
      {}
    );
    if (!event.chatId || event.chatId === "unknown-chat") {
      throw badRequest("chatId is required for proactive messages.");
    }

    const session = await this.#ensureSession(event);
    const outboundMessage = await this.#appendMessage({
      sessionId: session.id,
      direction: "outbound",
      authorId: "sovereign",
      authorRole: "assistant",
      text,
      metadata: {
        source: "channel.proactive",
        ...event.metadata
      }
    });

    const delivery = await adapter.sendMessage({
      session,
      event,
      text,
      context: {
        proactive: true
      },
      services: {
        store: this.store,
        missionService: this.missionService,
        agentService: this.agentService,
        llmService: this.llmService,
        councilService: this.councilService,
        pluginService: this.pluginService
      }
    });

    await this.store.updateChannelSession(session.id, {
      lastOutboundAt: outboundMessage.createdAt,
      updatedAt: nowIso()
    });

    return {
      sessionId: session.id,
      outboundMessageId: outboundMessage.id,
      delivery
    };
  }

  async verifyWebhook(channelId, query, headers = {}) {
    const adapter = this.#requireAdapter(channelId);
    if (typeof adapter.verifyWebhook !== "function") {
      return null;
    }
    return adapter.verifyWebhook({
      query,
      headers
    });
  }

  async processWebhook(channelId, payload, context = {}) {
    const adapter = this.#requireAdapter(channelId);
    const events = await adapter.parseInbound({
      payload,
      context
    });
    if (!Array.isArray(events) || events.length === 0) {
      return {
        channelId: adapter.id,
        processed: 0,
        responses: []
      };
    }

    const responses = [];
    for (const event of events) {
      const normalizedEvent = this.#normalizeEvent(adapter.id, event, context);
      if (!normalizedEvent.text) {
        continue;
      }
      const response = await this.#handleInbound(adapter, normalizedEvent, context);
      responses.push(response);
    }

    return {
      channelId: adapter.id,
      processed: responses.length,
      responses
    };
  }

  #normalizeEvent(channelId, event, context) {
    return {
      channelId,
      workspaceId: normalizeString(
        event.workspaceId ?? context.workspaceId ?? this.defaultWorkspaceId,
        this.defaultWorkspaceId
      ),
      chatId: normalizeString(event.chatId ?? event.threadId, "unknown-chat"),
      userId: normalizeString(event.userId, "unknown-user"),
      text: normalizeString(event.text),
      messageId: normalizeString(event.messageId, null),
      metadata:
        event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? event.metadata
          : {}
    };
  }

  async #handleInbound(adapter, event, context) {
    const session = await this.#ensureSession(event);
    const inboundMessage = await this.#appendMessage({
      sessionId: session.id,
      direction: "inbound",
      authorId: event.userId,
      authorRole: "user",
      text: event.text,
      metadata: {
        channelMessageId: event.messageId,
        ...event.metadata
      }
    });

    const reply = await this.#buildReply({
      session,
      event,
      context
    });

    const outboundMessage = await this.#appendMessage({
      sessionId: session.id,
      direction: "outbound",
      authorId: "sovereign",
      authorRole: "assistant",
      text: reply,
      metadata: {
        source: "channel.gateway"
      }
    });

    let delivery = null;
    if (typeof adapter.sendMessage === "function") {
      delivery = await adapter.sendMessage({
        session,
        event,
        text: reply,
        context,
        services: {
          store: this.store,
          missionService: this.missionService,
          agentService: this.agentService,
          llmService: this.llmService,
          councilService: this.councilService,
          pluginService: this.pluginService
        }
      });
    }

    await this.store.updateChannelSession(session.id, {
      lastInboundAt: inboundMessage.createdAt,
      lastOutboundAt: outboundMessage.createdAt,
      updatedAt: nowIso()
    });

    return {
      sessionId: session.id,
      inboundMessageId: inboundMessage.id,
      outboundMessageId: outboundMessage.id,
      reply,
      delivery
    };
  }

  async #ensureSession(event) {
    const key = sessionKey({
      channel: event.channelId,
      workspaceId: event.workspaceId,
      chatId: event.chatId,
      userId: event.userId
    });
    const existing = await this.store.getChannelSessionByKey(key);
    if (existing) {
      return existing;
    }
    const createdAt = nowIso();
    const created = await this.store.createChannelSession({
      id: makeId("session"),
      sessionKey: key,
      channelId: event.channelId,
      workspaceId: event.workspaceId,
      chatId: event.chatId,
      userId: event.userId,
      metadata: event.metadata,
      createdAt,
      updatedAt: createdAt,
      lastInboundAt: null,
      lastOutboundAt: null
    });
    return created;
  }

  async #appendMessage(input) {
    return this.store.createChannelMessage({
      id: makeId("msg"),
      sessionId: input.sessionId,
      direction: input.direction,
      authorId: input.authorId,
      authorRole: input.authorRole,
      text: input.text,
      metadata: input.metadata ?? {},
      createdAt: nowIso()
    });
  }

  async #buildReply(input) {
    const command = parseCommand(input.event.text);
    if (command) {
      return this.#handleCommand({
        command,
        session: input.session,
        workspaceId: input.event.workspaceId
      });
    }
    return this.#chatReply(input.session, input.event.text, input.event.workspaceId);
  }

  async #handleCommand(input) {
    const name = input.command.name;
    if (name === "/help") {
      return [
        "Commands:",
        "/missions",
        "/agents",
        "/plugins",
        '/tool <pluginId.toolName> {"json":"input"}',
        "/council <missionId> | <problem>"
      ].join("\n");
    }
    if (name === "/missions") {
      const missions = (await this.missionService.listMissions()).filter((mission) => {
        return mission.workspaceId === input.workspaceId;
      });
      if (missions.length === 0) {
        return "No missions in this workspace yet.";
      }
      return missions
        .slice(0, 8)
        .map((mission) => `- ${mission.id}: ${mission.title} [${mission.status}]`)
        .join("\n");
    }
    if (name === "/agents") {
      const agents = await this.agentService.listAgents(input.workspaceId);
      if (agents.length === 0) {
        return "No agents found. Create a main agent and sub-agents first.";
      }
      const mainCount = agents.filter((agent) => agent.role === AgentRole.MAIN).length;
      const subCount = agents.filter((agent) => agent.role === AgentRole.SUB).length;
      return `Agents: ${agents.length} total (${mainCount} main, ${subCount} sub).`;
    }
    if (name === "/plugins") {
      if (!this.pluginService) {
        return "Plugin service is not configured.";
      }
      const plugins = this.pluginService.listPlugins();
      if (plugins.length === 0) {
        return "No plugins loaded.";
      }
      return plugins.map((plugin) => `- ${plugin.id} (${plugin.toolCount} tools)`).join("\n");
    }
    if (name === "/tool") {
      if (!this.pluginService) {
        return "Plugin service is not configured.";
      }
      const parsed = parseToolReference(input.command.args);
      if (!parsed) {
        throw badRequest('Usage: /tool <pluginId.toolName> {"key":"value"}');
      }
      const invocation = await this.pluginService.invokeTool(
        parsed.pluginId,
        parsed.toolName,
        parsed.input,
        {
          source: "channel.command.tool",
          workspaceId: input.workspaceId,
          sessionId: input.session.id,
          channelId: input.session.channelId,
          userId: input.session.userId
        }
      );
      return `Tool ${parsed.pluginId}.${parsed.toolName}: ${truncate(
        JSON.stringify(invocation.result)
      )}`;
    }
    if (name === "/council") {
      const parsed = parseCouncilArgs(input.command.args);
      if (!parsed) {
        throw badRequest("Usage: /council <missionId> | <problem>");
      }
      const mainAgent = (await this.agentService
        .listAgents(input.workspaceId))
        .find((agent) => agent.role === AgentRole.MAIN);
      if (!mainAgent) {
        return "No main agent found in this workspace. Create one first.";
      }
      const council = await this.councilService.runCouncil(parsed.missionId, {
        problem: parsed.problem,
        mainAgentId: mainAgent.id,
        allowWebResearch: true,
        autoSpawnSubAgents: true,
        autoGenerateSkills: true
      });
      return [
        `Council complete for mission ${council.missionId}.`,
        `Consensus: ${council.consensus.consensusScore}`,
        `Plan: ${(council.finalBriefing.recommendedPlan ?? []).slice(0, 3).join(" | ")}`
      ].join("\n");
    }
    return 'Unknown command. Type "/help" to see available commands.';
  }

  async #chatReply(session, text, workspaceId) {
    const activeAgent = await this.#resolveSessionAgent(session, workspaceId);
    const modelPlan = await this.#resolveChatModelPlan(workspaceId, activeAgent?.id ?? null);
    if (!modelPlan) {
      return [
        "SOVEREIGN is running locally.",
        'Use "/help" for commands or configure LLM provider keys for full chat.'
      ].join(" ");
    }

    // Build conversation history with trajectory compression for longer context
    const rawHistory = await this.store.listChannelSessionMessages(session.id, 30);
    const history = await this.#buildConversationContext(rawHistory, modelPlan);

    // Build tool manifest for the system prompt
    const toolManifest = this.#buildToolManifest();
    const agentContext = this.#buildAgentContext(activeAgent);
    const systemPrompt = this.#buildReActSystemPrompt(toolManifest, agentContext);

    const MAX_REACT_STEPS = 8;
    const scratchpad = [];
    let finalAnswer = null;

    for (let step = 0; step < MAX_REACT_STEPS; step++) {
      const prompt = this.#buildReActPrompt({
        systemPrompt,
        history,
        userMessage: text,
        scratchpad,
        step,
        isFirstStep: step === 0
      });

      try {
        const completion = await this.llmService.respond({
          modelRef: modelPlan.modelRef,
          fallbacks: modelPlan.fallbacks,
          prompt,
          temperature: 0.15,
          maxTokens: 1500
        });
        const rawOutput = (completion.text ?? "").trim();

        // Parse the ReAct output into structured components
        const parsed = this.#parseReActOutput(rawOutput);

        // Record the thought in the scratchpad
        if (parsed.thought) {
          scratchpad.push({ type: "thought", step: step + 1, content: parsed.thought });
        }

        // If there's a final answer, we're done
        if (parsed.answer) {
          finalAnswer = parsed.answer;
          break;
        }

        // If there's a tool action, execute it
        if (parsed.action && this.pluginService) {
          scratchpad.push({
            type: "action",
            step: step + 1,
            tool: parsed.action,
            input: parsed.actionInput
          });

          const [pluginId, toolName] = parsed.action.split(".");
          if (pluginId && toolName) {
            try {
              const invocation = await this.pluginService.invokeTool(
                pluginId,
                toolName,
                parsed.actionInput ?? {},
                {
                  source: "channel.react",
                  workspaceId,
                  sessionId: session.id,
                  channelId: session.channelId,
                  userId: session.userId
                }
              );
              const resultText = JSON.stringify(invocation.result);
              const observation = truncate(resultText, 3000);
              scratchpad.push({
                type: "observation",
                step: step + 1,
                tool: parsed.action,
                content: observation,
                success: true
              });
            } catch (toolError) {
              const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
              scratchpad.push({
                type: "observation",
                step: step + 1,
                tool: parsed.action,
                content: `ERROR: ${errMsg}`,
                success: false
              });
            }
            continue;
          }
        }

        // If the LLM returned a legacy-format tool call (JSON block), handle it for backwards compat
        const legacyToolCall = this.#extractToolCall(rawOutput);
        if (legacyToolCall && this.pluginService) {
          scratchpad.push({
            type: "action",
            step: step + 1,
            tool: legacyToolCall.action,
            input: legacyToolCall.input
          });

          const [pluginId, toolName] = legacyToolCall.action.split(".");
          if (pluginId && toolName) {
            try {
              const invocation = await this.pluginService.invokeTool(
                pluginId,
                toolName,
                legacyToolCall.input ?? {},
                {
                  source: "channel.react.legacy",
                  workspaceId,
                  sessionId: session.id,
                  channelId: session.channelId,
                  userId: session.userId
                }
              );
              const resultText = JSON.stringify(invocation.result);
              scratchpad.push({
                type: "observation",
                step: step + 1,
                tool: legacyToolCall.action,
                content: truncate(resultText, 3000),
                success: true
              });
            } catch (toolError) {
              const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
              scratchpad.push({
                type: "observation",
                step: step + 1,
                tool: legacyToolCall.action,
                content: `ERROR: ${errMsg}`,
                success: false
              });
            }
            continue;
          }
        }

        // No tool call and no explicit Answer: — treat the raw output as the final answer
        finalAnswer = rawOutput;
        break;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        scratchpad.push({ type: "error", step: step + 1, content: errMsg });
        // If this is the first step, fail immediately
        if (step === 0) {
          return `LLM error: ${errMsg}`;
        }
        // Otherwise, try to synthesize from what we have
        break;
      }
    }

    // If we have a final answer, return it
    if (finalAnswer) {
      return truncate(finalAnswer, 4000);
    }

    // If we exhausted steps without a final answer, synthesize from scratchpad
    const observations = scratchpad
      .filter((s) => s.type === "observation" && s.success)
      .map((s) => s.content);
    if (observations.length > 0) {
      return truncate(
        `I gathered information across ${observations.length} tool call(s) but reached the reasoning limit.\n\nKey findings:\n${observations.join("\n---\n")}`,
        4000
      );
    }

    return "I wasn't able to complete this request. Please try breaking it into smaller steps.";
  }

  #buildReActSystemPrompt(toolManifest, agentContext) {
    return [
      "You are SOVEREIGN, an elite autonomous AI agent. You solve problems step-by-step using structured reasoning.",
      "",
      "## REASONING PROTOCOL (ReAct)",
      "You MUST follow this exact format for EVERY response:",
      "",
      "Thought: [Your internal reasoning about what to do next. Analyze what you know, what you need, and your strategy.]",
      "Action: [pluginId.toolName]",
      "Action Input: [JSON object with parameters]",
      "",
      "OR if you have enough information to answer:",
      "",
      "Thought: [Your reasoning about why you can now answer]",
      "Answer: [Your complete, well-formatted answer to the user]",
      "",
      "## RULES",
      "1. ALWAYS start with a Thought step — never act without thinking first.",
      "2. After each tool result (Observation), think about what you learned and what to do next.",
      "3. If a tool fails, reason about alternatives instead of retrying the same approach.",
      "4. Use the minimum number of tool calls needed. Don't call tools unnecessarily.",
      "5. When you have gathered enough evidence, synthesize it into a clear Answer.",
      "6. Your Answer should be comprehensive and directly address the user's request.",
      "7. CRITICAL CAPABILITY RULE: If the user asks you to perform an action (like converting files, generating PDFs, integrating with APIs) and you DO NOT possess a corresponding tool, YOU MUST NOT use a web browser to try to use online tool websites (they will block you), and YOU MUST NOT hallucinate success. Instead, YOU MUST actively execute the 'meta-engineering.create_plugin' tool to dynamically write the missing TypeScript plugin functionality on the fly! Be a 'wow' meta-engineer.",
      "",
      "## AVAILABLE TOOLS",
      toolManifest,
      "",
      agentContext
    ].filter(Boolean).join("\n");
  }

  #buildReActPrompt(input) {
    const parts = [];
    parts.push(input.systemPrompt);

    if (input.history) {
      parts.push(`\n## CONVERSATION HISTORY\n${input.history}`);
    }

    parts.push(`\n## USER REQUEST\n${input.userMessage}`);

    if (input.scratchpad.length > 0) {
      parts.push("\n## REASONING TRACE (your previous steps)");
      for (const entry of input.scratchpad) {
        if (entry.type === "thought") {
          parts.push(`Thought [Step ${entry.step}]: ${entry.content}`);
        } else if (entry.type === "action") {
          parts.push(`Action [Step ${entry.step}]: ${entry.tool}`);
          parts.push(`Action Input: ${JSON.stringify(entry.input ?? {})}`);
        } else if (entry.type === "observation") {
          parts.push(`Observation [Step ${entry.step}]: ${entry.content}`);
        } else if (entry.type === "error") {
          parts.push(`Error [Step ${entry.step}]: ${entry.content}`);
        }
      }
      parts.push(
        "\nContinue your reasoning. Start with a Thought about what you've learned and what to do next."
      );
    } else {
      parts.push(
        "\nBegin your reasoning. Start with a Thought about the user's request and your approach."
      );
    }

    return parts.join("\n");
  }

  #parseReActOutput(rawOutput) {
    const result = { thought: null, action: null, actionInput: null, answer: null };

    // Extract Thought
    const thoughtMatch = rawOutput.match(/Thought\s*(?:\[.*?\])?\s*:\s*([\s\S]*?)(?=\n(?:Action|Answer)\s*(?:\[.*?\])?\s*:|$)/i);
    if (thoughtMatch) {
      result.thought = thoughtMatch[1].trim();
    }

    // Extract Answer (takes priority over Action)
    const answerMatch = rawOutput.match(/Answer\s*(?:\[.*?\])?\s*:\s*([\s\S]*?)$/i);
    if (answerMatch) {
      result.answer = answerMatch[1].trim();
      return result;
    }

    // Extract Action
    const actionMatch = rawOutput.match(/Action\s*(?:\[.*?\])?\s*:\s*(.+)/i);
    if (actionMatch) {
      result.action = actionMatch[1].trim();
    }

    // Extract Action Input
    const inputMatch = rawOutput.match(/Action\s*Input\s*(?:\[.*?\])?\s*:\s*([\s\S]*?)(?=\n(?:Thought|Action|Answer|Observation)\s*(?:\[.*?\])?\s*:|$)/i);
    if (inputMatch) {
      const rawInput = inputMatch[1].trim();
      try {
        result.actionInput = JSON.parse(rawInput);
      } catch {
        // Try to extract JSON from within the text
        const jsonMatch = rawInput.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            result.actionInput = JSON.parse(jsonMatch[0]);
          } catch {
            result.actionInput = {};
          }
        } else {
          result.actionInput = {};
        }
      }
    }

    return result;
  }

  async #buildConversationContext(messages, modelPlan) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return "";
    }

    // If fewer than 15 messages, return all of them verbatim
    if (messages.length <= 15) {
      return messages
        .map((message) => `${message.authorRole}: ${message.text}`)
        .join("\n");
    }

    // Trajectory Compression: Summarize the middle turns using the LLM
    const recentCount = 6;
    const oldestCount = 2;
    const older = messages.slice(0, oldestCount);
    const middle = messages.slice(oldestCount, messages.length - recentCount);
    const recent = messages.slice(messages.length - recentCount);

    const oldVerbatim = older
      .map((message) => `${message.authorRole}: ${message.text}`)
      .join("\n");

    const recentVerbatim = recent
      .map((message) => `${message.authorRole}: ${message.text}`)
      .join("\n");

    const middleVerbatim = middle
      .map((message) => `${message.authorRole}: ${message.text}`)
      .join("\n");

    let middleSummary = "";
    if (middle.length > 0 && this.llmService && modelPlan) {
      try {
        const prompt = `Summarize the following conversation turns as densely as possible. Retain all key facts, entities, decisions, and outcomes. Omit pleasantries.

${middleVerbatim}`;
        const summaryResponse = await this.llmService.respond({
          modelRef: modelPlan.modelRef,
          fallbacks: modelPlan.fallbacks,
          prompt,
          temperature: 0,
          maxTokens: 500
        });
        middleSummary = (summaryResponse.text || "Summary failed.").trim();
      } catch (e) {
        middleSummary = "[Trajectory Compression Failed: Context omitted to save memory.]";
      }
    } else if (middle.length > 0) {
      middleSummary = "[Trajectory Compression Unavailable: Context summarized manually via text truncation.]";
    }

    return [
      "--- Initial Context ---",
      oldVerbatim,
      "--- Compressed Context (Middle Turns) ---",
      `[CONTEXT SUMMARY]: ${middleSummary}`,
      "--- Recent Actions ---",
      recentVerbatim
    ].filter(Boolean).join("\n");
  }

  #buildToolManifest() {
    if (!this.pluginService) {
      return "(no tools available)";
    }
    const plugins = this.pluginService.listPlugins();
    if (plugins.length === 0) {
      return "(no tools available)";
    }
    const lines = [];
    for (const plugin of plugins) {
      for (const tool of plugin.tools ?? []) {
        const params = tool.inputSchema?.properties
          ? Object.entries(tool.inputSchema.properties)
              .map(([key, val]) => `${key}: ${val.type ?? "any"} — ${val.description ?? ""}`)
              .join(", ")
          : "none";
        lines.push(`- **${plugin.id}.${tool.name}**: ${tool.description ?? "no description"} | Params: ${params}`);
      }
    }
    return lines.join("\n");
  }

  #extractToolCall(text) {
    // Try to extract a JSON tool-call block from the LLM output (legacy format)
    const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const candidate = jsonBlockMatch ? jsonBlockMatch[1].trim() : null;
    if (!candidate) {
      // Also try if the entire text is a JSON object
      const rawTrimmed = text.trim();
      if (rawTrimmed.startsWith("{") && rawTrimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(rawTrimmed);
          if (parsed && typeof parsed === "object" && typeof parsed.action === "string") {
            return parsed;
          }
        } catch { /* not parseable */ }
      }
      return null;
    }
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && typeof parsed.action === "string") {
        return parsed;
      }
    } catch {
      // Not a tool call — just a normal text reply
    }
    return null;
  }

  async #resolveChatModelPlan(workspaceId = null, preferredAgentId = null) {
    if (!this.llmService || typeof this.llmService.respond !== "function") {
      return null;
    }

    const normalizeModelRef = (raw) => {
      const candidate = normalizeString(raw);
      if (!candidate) {
        return null;
      }
      if (typeof this.llmService.normalizeModelRef === "function") {
        return this.llmService.normalizeModelRef(candidate, this.defaultProvider);
      }
      return candidate;
    };

    const configuredModelRefs = this.#listConfiguredModelRefs();
    const modelPolicy =
      (await this.#resolveAgentModelPolicy(preferredAgentId, workspaceId)) ??
      (await this.#resolveWorkspaceAgentModelPolicy(workspaceId));
    let primaryModelRef = normalizeModelRef(modelPolicy?.primary || this.defaultModelRef);
    if (!primaryModelRef && typeof this.llmService.resolveDefaultModelRef === "function") {
      primaryModelRef = this.llmService.resolveDefaultModelRef(this.defaultProvider);
    }
    if (!primaryModelRef && configuredModelRefs.length > 0) {
      primaryModelRef = configuredModelRefs[0];
    }
    if (!primaryModelRef) {
      return null;
    }

    const seen = new Set([primaryModelRef]);
    const fallbacks = [];
    const addFallback = (value) => {
      const normalized = normalizeModelRef(value);
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      fallbacks.push(normalized);
    };

    for (const fallbackRef of modelPolicy?.fallbacks ?? []) {
      addFallback(fallbackRef);
    }
    for (const fallbackRef of this.defaultModelFallbacks) {
      addFallback(fallbackRef);
    }
    for (const modelRef of configuredModelRefs) {
      addFallback(modelRef);
    }

    return {
      modelRef: primaryModelRef,
      fallbacks
    };
  }

  async #resolveSessionAgent(session, workspaceId) {
    if (!this.agentService) {
      return null;
    }
    const metadata =
      session?.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
        ? session.metadata
        : {};
    const activeAgentId = normalizeString(metadata.activeAgentId);
    if (!activeAgentId) {
      return null;
    }
    const agent = await this.#resolveAgentById(activeAgentId);
    if (!agent) {
      return null;
    }
    const workspaceKey = normalizeString(workspaceId || this.defaultWorkspaceId, this.defaultWorkspaceId);
    const agentWorkspaceId = normalizeString(agent.workspaceId, this.defaultWorkspaceId);
    if (agentWorkspaceId !== workspaceKey) {
      return null;
    }
    return agent;
  }

  #buildAgentContext(agent) {
    if (!agent) {
      return "";
    }
    const skills = Array.isArray(agent.skills) ? agent.skills.map((item) => String(item).trim()).filter(Boolean) : [];
    const soulValues = Array.isArray(agent.soul?.values)
      ? agent.soul.values.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const details = [
      `Active agent: ${agent.name} (${agent.role})`,
      agent.title ? `Title: ${agent.title}` : "",
      agent.soul?.mission ? `Mission: ${String(agent.soul.mission)}` : "",
      soulValues.length > 0 ? `Values: ${soulValues.join(", ")}` : "",
      skills.length > 0 ? `Skills: ${skills.join(", ")}` : ""
    ]
      .filter(Boolean)
      .join("\n");
    return details ? `Use this agent context:\n${details}` : "";
  }

  async #resolveWorkspaceAgentModelPolicy(workspaceId) {
    const mainAgent = await this.#resolveWorkspaceMainAgent(workspaceId);
    if (!mainAgent) {
      return null;
    }
    const model = normalizeModelPolicy(mainAgent.model);
    if (!model.primary) {
      return null;
    }
    return model;
  }

  async #resolveAgentModelPolicy(agentId, workspaceId) {
    const id = normalizeString(agentId);
    if (!id) {
      return null;
    }
    const agent = await this.#resolveAgentById(id);
    if (!agent) {
      return null;
    }
    const workspaceKey = normalizeString(workspaceId || this.defaultWorkspaceId, this.defaultWorkspaceId);
    const agentWorkspaceId = normalizeString(agent.workspaceId, this.defaultWorkspaceId);
    if (agentWorkspaceId !== workspaceKey) {
      return null;
    }
    const model = normalizeModelPolicy(agent.model);
    if (!model.primary) {
      return null;
    }
    return model;
  }

  async #resolveAgentById(agentId) {
    if (!this.agentService) {
      return null;
    }
    if (typeof this.agentService.getAgent === "function") {
      const direct = await this.agentService.getAgent(agentId);
      if (direct) {
        return direct;
      }
    }
    if (typeof this.agentService.listAgents === "function") {
      const allAgents = await this.agentService.listAgents();
      if (Array.isArray(allAgents)) {
        return allAgents.find((agent) => agent.id === agentId) ?? null;
      }
    }
    return null;
  }

  async #resolveWorkspaceMainAgent(workspaceId) {
    if (!this.agentService || typeof this.agentService.listAgents !== "function") {
      return null;
    }
    const workspaceKey = normalizeString(workspaceId || this.defaultWorkspaceId, this.defaultWorkspaceId);
    const agents = await this.agentService.listAgents(workspaceKey);
    if (!Array.isArray(agents) || agents.length === 0) {
      return null;
    }
    return agents.find((agent) => agent.role === AgentRole.MAIN) ?? agents[0];
  }

  #listConfiguredModelRefs() {
    if (!this.llmService || typeof this.llmService.listModelRefs !== "function") {
      return [];
    }
    const entries = this.llmService.listModelRefs({ configuredOnly: true });
    const seen = new Set();
    const refs = [];
    for (const entry of entries) {
      const modelRef = normalizeString(entry?.modelRef);
      if (!modelRef || seen.has(modelRef)) {
        continue;
      }
      seen.add(modelRef);
      refs.push(modelRef);
    }
    return refs;
  }

  #readAdapterConfigured(adapter) {
    if (typeof adapter.isConfigured !== "function") {
      return null;
    }
    try {
      return Boolean(adapter.isConfigured());
    } catch {
      return null;
    }
  }

  #requireAdapter(channelId) {
    const id = normalizeString(channelId).toLowerCase();
    const resolvedId = this.adapterAliases.get(id) ?? id;
    const adapter = this.adapters.get(resolvedId);
    if (!adapter) {
      throw notFound(`Unknown channel adapter: ${id}`);
    }
    return adapter;
  }

  #registerBuiltins(options) {
    this.registerAdapter(
      createLocalChatAdapter({
        defaultWorkspaceId: this.defaultWorkspaceId
      })
    );
    this.registerAdapter(
      createTelegramAdapter({
        defaultWorkspaceId: this.defaultWorkspaceId,
        botToken: options.telegramBotToken,
        verifySecret: options.telegramWebhookSecret,
        fetchFn: options.fetchFn
      })
    );
    this.registerAdapter(
      createWhatsappAdapter({
        defaultWorkspaceId: this.defaultWorkspaceId,
        accessToken: options.whatsappAccessToken,
        verifyToken: options.whatsappVerifyToken,
        phoneNumberId: options.whatsappPhoneNumberId,
        fetchFn: options.fetchFn
      })
    );
  }
}
