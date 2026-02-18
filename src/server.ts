// @ts-nocheck
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataStore } from "./store/data-store.js";
import { PrismaDataStore } from "./store/prisma-data-store.js";
import { createStateBackendService } from "./infra/state-backend-service.js";
import { PolicyEngine, isValidActionType } from "./services/policy-engine.js";
import { MissionService } from "./services/mission-service.js";
import { VerificationEngine } from "./services/verification-engine.js";
import { AgentService } from "./services/agent-service.js";
import { LlmService } from "./services/llm-service.js";
import { SkillService } from "./services/skill-service.js";
import { CouncilService } from "./services/council-service.js";
import { WebResearchService } from "./services/web-research-service.js";
import { CommandQueue } from "./services/command-queue.js";
import { PluginService } from "./services/plugin-service.js";
import { ChannelGatewayService } from "./services/channel-gateway-service.js";
import { RuntimeTrustService } from "./services/runtime-trust-service.js";
import { AutopilotService } from "./services/autopilot-service.js";
import { ArchitectureService } from "./services/architecture-service.js";
import { SecurityFabricService } from "./services/security-fabric-service.js";
import { TunnelService } from "./services/tunnel-service.js";
import { MemoryEngineService } from "./services/memory-engine-service.js";
import { GraphRagService } from "./services/graph-rag-service.js";
import { ObservabilityService } from "./services/observability-service.js";
import { EvaluationService } from "./services/evaluation-service.js";
import { CompanyOrchestratorService } from "./services/company-orchestrator-service.js";
import { HeartbeatService } from "./services/heartbeat-service.js";
import { NotificationOutboxService } from "./services/notification-outbox-service.js";
import { SetupWizardService } from "./services/setup-wizard-service.js";
import { DashboardService } from "./services/dashboard-service.js";
import { jsonResponse, readJsonBody } from "./lib/http.js";
import { initializeTracing } from "./lib/tracing-bootstrap.js";
import { renderDashboardPage } from "./lib/dashboard-page.js";
import { loadEnvFile } from "./lib/env-loader.js";
import { buildOpenApiSpec } from "./lib/openapi-spec.js";

loadEnvFile();
initializeTracing().catch(() => { });

function parsePath(pathname) {
  return pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
}

function sendNotFound(res) {
  jsonResponse(res, 404, {
    error: "Not Found"
  });
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(String(text ?? ""));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8"
  });
  res.end(String(html ?? ""));
}

function getErrorStatus(error) {
  const code = Number(error?.statusCode);
  if (Number.isInteger(code) && code >= 400 && code < 600) {
    return code;
  }
  return 500;
}

export function createApi(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const distPluginsDir = path.join(cwd, "dist", "plugins");
  const sourcePluginsDir = path.join(cwd, "plugins");
  const defaultPluginsDir = fs.existsSync(distPluginsDir) ? distPluginsDir : sourcePluginsDir;
  const stateBackend = options.stateBackendMode ?? process.env.STATE_BACKEND;

  let store;
  let stateBackendService = null;

  if (stateBackend === "postgres") {
    // When using Postgres/Prisma, we don't use the file-based DataStore or the redis backend service
    // in the same way. PrismaDataStore handles persistence directly.
    store = new PrismaDataStore();
  } else {
    stateBackendService =
      options.stateBackend ?? createStateBackendService({
        mode: options.stateBackendMode ?? process.env.STATE_BACKEND,
        databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL,
        redisUrl: options.redisUrl ?? process.env.REDIS_URL,
        tableName: options.stateBackendTable ?? process.env.STATE_BACKEND_TABLE,
        stateKey: options.stateBackendKey ?? process.env.STATE_BACKEND_KEY,
        redisKey: options.stateRedisKey ?? process.env.STATE_REDIS_KEY,
        redisTtlSeconds: options.stateRedisTtlSeconds ?? process.env.STATE_REDIS_TTL_SECONDS,
        preferRedisRead: options.statePreferRedisRead ?? process.env.STATE_PREFER_REDIS_READ
      });
    const persistPath =
      options.persistPath === undefined
        ? stateBackendService
          ? path.join(cwd, ".data", "store.json")
          : path.join(cwd, ".data", "store.json")
        : options.persistPath;

    store = new DataStore({
      persistPath,
      externalPersistence: stateBackendService
    });
  }

  const policyEngine = new PolicyEngine();
  const observabilityService = new ObservabilityService({ store });
  const missionService = new MissionService(store, policyEngine);
  const verificationEngine = new VerificationEngine();
  const agentService = new AgentService(store);
  const llmService = new LlmService({
    ...options,
    observabilityService,
    defaultWorkspaceId: options.defaultWorkspaceId ?? process.env.DEFAULT_WORKSPACE_ID ?? "default"
  });
  const skillService = new SkillService(store, agentService, llmService);
  const webResearchService = new WebResearchService(options);
  const councilService = new CouncilService(
    store,
    missionService,
    agentService,
    webResearchService,
    skillService
  );
  const commandQueue = new CommandQueue({
    maxConcurrent: Number(options.maxConcurrent ?? process.env.QUEUE_MAX_CONCURRENT ?? 4),
    defaultLaneConcurrency: Number(
      options.defaultLaneConcurrency ?? process.env.QUEUE_LANE_CONCURRENCY ?? 1
    )
  });
  const runtimeTrustService = new RuntimeTrustService({
    store,
    policyEngine,
    missionService,
    stateBackendService,
    defaultPolicyPreset:
      options.runtimePolicyPreset ?? process.env.RUNTIME_POLICY_PRESET ?? "balanced"
  });
  const pluginService = new PluginService({
    cwd,
    pluginsDir: options.pluginsDir ?? process.env.PLUGINS_DIR ?? defaultPluginsDir,
    services: {
      store,
      missionService,
      verificationEngine,
      policyEngine,
      agentService,
      llmService,
      skillService,
      councilService,
      webResearchService,
      commandQueue,
      runtimeTrustService,
      observabilityService
    }
  });
  const channelGatewayService = new ChannelGatewayService({
    store,
    missionService,
    agentService,
    llmService,
    councilService,
    pluginService,
    defaultProvider: options.chatProvider ?? process.env.CHAT_PROVIDER,
    defaultModelRef: options.chatModelPrimary ?? process.env.CHAT_MODEL_PRIMARY,
    defaultModelFallbacks: options.chatModelFallbacks ?? process.env.CHAT_MODEL_FALLBACKS,
    defaultWorkspaceId: options.defaultWorkspaceId ?? process.env.DEFAULT_WORKSPACE_ID ?? "default",
    telegramBotToken: options.telegramBotToken ?? process.env.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: options.telegramWebhookSecret ?? process.env.TELEGRAM_WEBHOOK_SECRET,
    whatsappAccessToken: options.whatsappAccessToken ?? process.env.WHATSAPP_ACCESS_TOKEN,
    whatsappVerifyToken: options.whatsappVerifyToken ?? process.env.WHATSAPP_VERIFY_TOKEN,
    whatsappPhoneNumberId: options.whatsappPhoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID
  });
  if (typeof runtimeTrustService.setChannelGatewayService === "function") {
    runtimeTrustService.setChannelGatewayService(channelGatewayService);
  }
  const notificationOutboxService = new NotificationOutboxService({
    store,
    channelGatewayService,
    observabilityService,
    maxAttempts:
      options.notificationOutboxMaxAttempts ?? process.env.NOTIFICATION_OUTBOX_MAX_ATTEMPTS,
    batchSize: options.notificationOutboxBatchSize ?? process.env.NOTIFICATION_OUTBOX_BATCH_SIZE,
    retryBaseMs:
      options.notificationOutboxRetryBaseMs ?? process.env.NOTIFICATION_OUTBOX_RETRY_BASE_MS,
    retryMaxMs: options.notificationOutboxRetryMaxMs ?? process.env.NOTIFICATION_OUTBOX_RETRY_MAX_MS
  });
  const autopilotService = new AutopilotService({
    store,
    missionService,
    agentService,
    councilService,
    channelGatewayService,
    observabilityService,
    notificationOutboxService,
    pollIntervalMs: options.autopilotPollMs ?? process.env.AUTOPILOT_POLL_MS,
    stepTimeoutMs: options.autopilotStepTimeoutMs ?? process.env.AUTOPILOT_STEP_TIMEOUT_MS,
    maxCyclesDefault: options.autopilotMaxCycles ?? process.env.AUTOPILOT_MAX_CYCLES,
    autoStart: options.autopilotAutoStart ?? process.env.AUTOPILOT_AUTO_START !== "false"
  });
  const architectureService = new ArchitectureService({
    agentService,
    skillService,
    llmService
  });
  const evaluationService = new EvaluationService({
    llmService,
    observabilityService
  });
  const securityFabricService = new SecurityFabricService({
    store,
    cwd,
    workspaceRoot: cwd,
    keyPath: options.securityKeyPath ?? process.env.SECURITY_KEY_PATH,
    secretsPath: options.securitySecretsPath ?? process.env.SECURITY_SECRETS_PATH,
    rateWindowMs: options.securityRateWindowMs ?? process.env.SECURITY_RATE_WINDOW_MS,
    windowRequestCap: options.securityWindowRequestCap ?? process.env.SECURITY_WINDOW_REQUEST_CAP,
    dayCostCap: options.securityDayCostCap ?? process.env.SECURITY_DAY_COST_CAP
  });
  const tunnelService = new TunnelService({ store });
  const graphRagService = new GraphRagService({
    enabled: options.memgraphEnabled ?? process.env.MEMGRAPH_ENABLED !== "false",
    uri: options.memgraphUri ?? process.env.MEMGRAPH_URI,
    user: options.memgraphUser ?? process.env.MEMGRAPH_USER,
    password: options.memgraphPassword ?? process.env.MEMGRAPH_PASSWORD,
    database: options.memgraphDatabase ?? process.env.MEMGRAPH_DATABASE,
    hopLimit: options.memgraphHopLimit ?? process.env.MEMGRAPH_HOP_LIMIT
  });
  const memoryEngineService = new MemoryEngineService({
    store,
    graphRagService,
    vectorDim: options.memoryVectorDim ?? process.env.MEMORY_VECTOR_DIM,
    chunkChars: options.memoryChunkChars ?? process.env.MEMORY_CHUNK_CHARS,
    hybridAlpha: options.memoryHybridAlpha ?? process.env.MEMORY_HYBRID_ALPHA,
    graphRagBoost: options.memoryGraphRagBoost ?? process.env.MEMORY_GRAPH_RAG_BOOST
  });
  const companyOrchestratorService = new CompanyOrchestratorService({
    store,
    architectureService,
    missionService,
    councilService,
    verificationEngine,
    commandQueue,
    channelGatewayService,
    securityFabricService,
    observabilityService,
    evaluationService,
    notificationOutboxService,
    councilStepTimeoutMs:
      options.companyCouncilStepTimeoutMs ?? process.env.COMPANY_COUNCIL_STEP_TIMEOUT_MS
  });
  const heartbeatService = new HeartbeatService({
    store,
    companyOrchestratorService,
    channelGatewayService,
    observabilityService,
    notificationOutboxService,
    outboxBatchLimit:
      options.notificationOutboxBatchSize ?? process.env.NOTIFICATION_OUTBOX_BATCH_SIZE,
    tickMs: options.heartbeatTickMs ?? process.env.HEARTBEAT_TICK_MS,
    autoStart: options.heartbeatAutoStart ?? process.env.HEARTBEAT_AUTO_START !== "false"
  });
  const setupWizardService = new SetupWizardService({
    store,
    cwd,
    agentService,
    tunnelService,
    observabilityService
  });
  const dashboardService = new DashboardService({
    companyOrchestratorService,
    missionService,
    councilService,
    runtimeTrustService,
    observabilityService,
    agentService,
    autopilotService,
    heartbeatService,
    channelGatewayService,
    commandQueue
  });

  const handler = async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const parts = parsePath(url.pathname);

    try {
      if (store.waitUntilReady) {
        await store.waitUntilReady();
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "health") {
        return jsonResponse(res, 200, {
          status: "ok",
          service: "sovereign-mvp-api"
        });
      }

      if (
        method === "GET" &&
        parts.length === 2 &&
        parts[0] === "api" &&
        (parts[1] === "openapi" || parts[1] === "openapi.json")
      ) {
        return jsonResponse(res, 200, buildOpenApiSpec(`${url.protocol}//${url.host}`));
      }

      if (method === "GET" && parts.length === 1 && parts[0] === "dashboard") {
        return sendHtml(
          res,
          200,
          renderDashboardPage({
            defaultWorkspaceId: options.defaultWorkspaceId ?? process.env.DEFAULT_WORKSPACE_ID ?? "default"
          })
        );
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "dashboard") {
        if (parts[2] === "snapshot") {
          const snapshot = await dashboardService.getSnapshot({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 12),
            runtimeLimit: Number(url.searchParams.get("runtimeLimit") ?? undefined),
            eventLimit: Number(url.searchParams.get("eventLimit") ?? undefined),
            metricsLimit: Number(url.searchParams.get("metricsLimit") ?? undefined),
            noCache:
              ["1", "true", "yes"].includes(
                String(url.searchParams.get("noCache") ?? "")
                  .trim()
                  .toLowerCase()
              )
          });
          return jsonResponse(res, 200, { snapshot });
        }
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "system") {
        if (parts[2] === "persistence") {
          const backendStatus = stateBackendService
            ? await stateBackendService.getStatus()
            : {
              enabled: false,
              mode: "file"
            };
          return jsonResponse(res, 200, {
            store: typeof store.getPersistenceStatus === "function" ? store.getPersistenceStatus() : { type: "prisma" },
            backend: backendStatus
          });
        }
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "missions") {
        const missions = await missionService.listMissions();
        return jsonResponse(res, 200, { missions });
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "queue") {
        if (parts[2] === "stats") {
          return jsonResponse(res, 200, commandQueue.getStats());
        }
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "llm") {
        if (parts[2] === "providers") {
          return jsonResponse(res, 200, {
            providers: await llmService.listProviders()
          });
        }
        if (parts[2] === "models") {
          return jsonResponse(res, 200, {
            models:
              typeof llmService.listModelRefs === "function"
                ? await llmService.listModelRefs({ configuredOnly: false })
                : []
          });
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "runtime") {
        if (method === "GET" && parts[2] === "actions" && parts.length === 3) {
          const limit = Number(url.searchParams.get("limit") ?? 100);
          const actions = await runtimeTrustService.listRuntimeActions({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            missionId: url.searchParams.get("missionId") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            decision: url.searchParams.get("decision") ?? undefined,
            actionType: url.searchParams.get("actionType") ?? undefined,
            limit
          });
          return jsonResponse(res, 200, { actions });
        }
        if (method === "GET" && parts[2] === "actions" && parts.length === 4) {
          const action = await runtimeTrustService.getRuntimeAction(parts[3]);
          if (!action) {
            return jsonResponse(res, 404, { error: "Runtime action not found." });
          }
          return jsonResponse(res, 200, { action });
        }
        if (method === "GET" && parts[2] === "metrics" && parts.length === 3) {
          const metrics = await runtimeTrustService.getRuntimeMetrics({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            missionId: url.searchParams.get("missionId") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 1000)
          });
          return jsonResponse(res, 200, { metrics });
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "autopilot") {
        if (parts[2] === "goals") {
          if (method === "GET" && parts.length === 3) {
            const goals = await autopilotService.listGoals({
              workspaceId: url.searchParams.get("workspaceId") ?? undefined,
              status: url.searchParams.get("status") ?? undefined,
              limit: Number(url.searchParams.get("limit") ?? 200)
            });
            return jsonResponse(res, 200, { goals });
          }
          if (method === "POST" && parts.length === 3) {
            const body = await readJsonBody(req);
            const goal = await autopilotService.createGoal(body);
            return jsonResponse(res, 201, { goal });
          }
          if (parts.length === 4) {
            const goalId = parts[3];
            if (method === "GET") {
              const goal = await autopilotService.getGoal(goalId);
              if (!goal) {
                return jsonResponse(res, 404, { error: "Autopilot goal not found." });
              }
              return jsonResponse(res, 200, { goal });
            }
          }
          if (parts.length === 5) {
            const goalId = parts[3];
            const action = parts[4];
            if (method === "GET" && action === "logs") {
              const logs = await autopilotService.listGoalLogs(
                goalId,
                Number(url.searchParams.get("limit") ?? 200)
              );
              return jsonResponse(res, 200, { logs });
            }
            if (method === "POST" && action === "pause") {
              const goal = await autopilotService.pauseGoal(goalId);
              return jsonResponse(res, 200, { goal });
            }
            if (method === "POST" && action === "resume") {
              const goal = await autopilotService.resumeGoal(goalId);
              return jsonResponse(res, 200, { goal });
            }
            if (method === "POST" && action === "cancel") {
              const goal = await autopilotService.cancelGoal(goalId);
              return jsonResponse(res, 200, { goal });
            }
            if (method === "POST" && action === "run") {
              await autopilotService.runOnce();
              const goal = await autopilotService.getGoal(goalId);
              if (!goal) {
                return jsonResponse(res, 404, { error: "Autopilot goal not found." });
              }
              return jsonResponse(res, 200, { goal });
            }
          }
        }
      }

      if (method === "POST" && parts.length === 3 && parts[0] === "api" && parts[1] === "llm") {
        if (parts[2] === "respond") {
          const body = await readJsonBody(req);
          const completion = await llmService.respond(body);
          return jsonResponse(res, 200, { completion });
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "architecture") {
        if (method === "GET" && parts.length === 3 && parts[2] === "blueprint") {
          const blueprint = await architectureService.getBlueprint({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined
          });
          return jsonResponse(res, 200, { blueprint });
        }
        if (method === "POST" && parts.length === 3 && parts[2] === "company-plan") {
          const body = await readJsonBody(req);
          const plan = await architectureService.buildCompanyPlan(body);
          return jsonResponse(res, 201, { plan });
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "soul" && parts[3] === "evolve") {
          const body = await readJsonBody(req);
          const evolution = await architectureService.evolveAgentSoul(body);
          return jsonResponse(res, 200, { evolution });
        }
        if (method === "GET" && parts.length === 5 && parts[2] === "soul" && parts[4] === "history") {
          const history = await architectureService.listSoulHistory({
            agentId: parts[3],
            limit: Number(url.searchParams.get("limit") ?? 50)
          });
          return jsonResponse(res, 200, history);
        }
        if (method === "POST" && parts.length === 5 && parts[2] === "soul" && parts[4] === "rollback") {
          const body = await readJsonBody(req);
          const rollback = await architectureService.rollbackAgentSoul({
            agentId: parts[3],
            ...body
          });
          return jsonResponse(res, 200, rollback);
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "security") {
        if (method === "GET" && parts.length === 3 && parts[2] === "pairings") {
          const pairings = await securityFabricService.listPairings({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            channelId: url.searchParams.get("channelId") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 100)
          });
          return jsonResponse(res, 200, { pairings });
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "pairings" && parts[3] === "create") {
          const body = await readJsonBody(req);
          const pairing = await securityFabricService.createGatewayPairing(body);
          return jsonResponse(res, 201, pairing);
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "pairings" && parts[3] === "verify") {
          const body = await readJsonBody(req);
          const result = await securityFabricService.verifyGatewayPairing(body);
          return jsonResponse(res, 200, result);
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "auth" && parts[3] === "issue") {
          const body = await readJsonBody(req);
          const issued = await securityFabricService.issueAuthToken(body);
          return jsonResponse(res, 201, issued);
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "auth" && parts[3] === "verify") {
          const body = await readJsonBody(req);
          const verified = await securityFabricService.verifyAuthToken(body);
          return jsonResponse(res, 200, verified);
        }
        if (method === "GET" && parts.length === 4 && parts[2] === "rate" && parts[3] === "events") {
          const events = await securityFabricService.listRateEvents({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            channelId: url.searchParams.get("channelId") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 200)
          });
          return jsonResponse(res, 200, { events });
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "rate" && parts[3] === "check") {
          const body = await readJsonBody(req);
          const result = await securityFabricService.checkRateLimit(body);
          return jsonResponse(res, 200, result);
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "sandbox" && parts[3] === "check") {
          const body = await readJsonBody(req);
          const result = await securityFabricService.checkFilesystemPath(body);
          return jsonResponse(res, 200, result);
        }
        if (method === "GET" && parts.length === 3 && parts[2] === "secrets") {
          const workspaceId = url.searchParams.get("workspaceId") ?? "default";
          const keys = await securityFabricService.listSecretKeys(workspaceId);
          return jsonResponse(res, 200, { workspaceId, keys });
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "secrets" && parts[3] === "set") {
          const body = await readJsonBody(req);
          const result = await securityFabricService.setSecret(body);
          return jsonResponse(res, 201, result);
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "secrets" && parts[3] === "get") {
          const body = await readJsonBody(req);
          const result = await securityFabricService.getSecret(body);
          return jsonResponse(res, 200, result);
        }
      }

      if (parts.length >= 2 && parts[0] === "api" && parts[1] === "tunnels") {
        if (method === "GET" && parts.length === 2) {
          const workspaceId = url.searchParams.get("workspaceId");
          const tunnels = await tunnelService.listTunnels(workspaceId ?? null);
          return jsonResponse(res, 200, { tunnels });
        }
        if (method === "POST" && parts.length === 2) {
          const body = await readJsonBody(req);
          const tunnel = await tunnelService.createTunnel(body);
          return jsonResponse(res, 201, { tunnel });
        }
        if (method === "GET" && parts.length === 3 && parts[2] === "active") {
          const active = await tunnelService.getActiveTunnel(url.searchParams.get("workspaceId") ?? "default");
          return jsonResponse(res, 200, { tunnel: active });
        }
        if (parts.length === 3 && parts[2] !== "active") {
          const tunnelId = parts[2];
          if (method === "GET") {
            const tunnel = await tunnelService.getTunnel(tunnelId);
            if (!tunnel) {
              return jsonResponse(res, 404, { error: "Tunnel not found." });
            }
            return jsonResponse(res, 200, { tunnel });
          }
          if (method === "PATCH") {
            const body = await readJsonBody(req);
            const tunnel = await tunnelService.updateTunnel(tunnelId, body);
            return jsonResponse(res, 200, { tunnel });
          }
        }
        if (parts.length === 4) {
          const tunnelId = parts[2];
          const action = parts[3];
          if (method === "POST" && action === "activate") {
            const tunnel = await tunnelService.activateTunnel(tunnelId);
            return jsonResponse(res, 200, { tunnel });
          }
          if (method === "POST" && action === "deactivate") {
            const tunnel = await tunnelService.deactivateTunnel(tunnelId);
            return jsonResponse(res, 200, { tunnel });
          }
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "memory") {
        if (method === "POST" && parts.length === 3 && parts[2] === "index") {
          const body = await readJsonBody(req);
          const result = await memoryEngineService.indexDocument(body);
          return jsonResponse(res, 201, result);
        }
        if (method === "POST" && parts.length === 3 && parts[2] === "search") {
          const body = await readJsonBody(req);
          const result = await memoryEngineService.search(body);
          return jsonResponse(res, 200, result);
        }
        if (method === "POST" && parts.length === 3 && parts[2] === "reindex") {
          const body = await readJsonBody(req);
          const result = await memoryEngineService.reindexWorkspace(body);
          return jsonResponse(res, 200, result);
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "graph" && parts[3] === "query") {
          const body = await readJsonBody(req);
          const result = await memoryEngineService.queryGraph(body);
          return jsonResponse(res, 200, result);
        }
        if (method === "GET" && parts.length === 4 && parts[2] === "graph" && parts[3] === "stats") {
          const result = await memoryEngineService.getGraphStats({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined
          });
          return jsonResponse(res, 200, result);
        }
        if (method === "GET" && parts.length === 3 && parts[2] === "stats") {
          const result = await memoryEngineService.getStats({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined
          });
          return jsonResponse(res, 200, result);
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "company") {
        if (method === "GET" && parts[2] === "runs" && parts.length === 3) {
          const runs = await companyOrchestratorService.listRuns({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 100)
          });
          return jsonResponse(res, 200, { runs });
        }
        if (method === "GET" && parts[2] === "runs" && parts.length === 4) {
          const run = await companyOrchestratorService.getRun(parts[3]);
          if (!run) {
            return jsonResponse(res, 404, { error: "Company run not found." });
          }
          return jsonResponse(res, 200, { run });
        }
        if (method === "POST" && parts[2] === "runs" && parts.length === 5 && parts[4] === "resume") {
          const body = await readJsonBody(req);
          const run = await companyOrchestratorService.resumeRun(parts[3], body);
          return jsonResponse(res, 200, { run });
        }
        if (method === "POST" && parts[2] === "execute" && parts.length === 3) {
          const body = await readJsonBody(req);
          const run = await companyOrchestratorService.executeObjective(body);
          return jsonResponse(res, 201, { run });
        }
      }

      if (parts.length >= 4 && parts[0] === "api" && parts[1] === "evals" && parts[2] === "company") {
        if (method === "POST" && parts.length === 4) {
          const run = await companyOrchestratorService.getRun(parts[3]);
          if (!run) {
            return jsonResponse(res, 404, { error: "Company run not found." });
          }
          const body = await readJsonBody(req);
          const evaluation = await evaluationService.evaluateCompanyRun({
            run,
            ...body
          });

          let updatedRun = run;
          // IMPORTANT: Check if store supports async update (Prisma) or sync (legacy)
          // We can just await it since we are in an async function.
          const updateResult = store.updateCompanyRun(run.id, {
            evaluation,
            updatedAt: new Date().toISOString()
          });

          if (updateResult instanceof Promise) {
            updatedRun = (await updateResult) ?? run;
          } else {
            updatedRun = updateResult ?? run;
          }

          return jsonResponse(res, 200, {
            evaluation,
            run: updatedRun
          });
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "heartbeat") {
        if (method === "GET" && parts.length === 3 && parts[2] === "jobs") {
          const jobs = await heartbeatService.listJobs(url.searchParams.get("workspaceId"));
          return jsonResponse(res, 200, { jobs });
        }
        if (method === "GET" && parts.length === 3 && parts[2] === "outbox") {
          const items = await heartbeatService.listOutboxItems({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            missionId: url.searchParams.get("missionId") ?? undefined,
            runId: url.searchParams.get("runId") ?? undefined,
            dueOnly:
              ["1", "true", "yes"].includes(
                String(url.searchParams.get("dueOnly") ?? "")
                  .trim()
                  .toLowerCase()
              ),
            limit: Number(url.searchParams.get("limit") ?? 200)
          });
          return jsonResponse(res, 200, { items });
        }
        if (method === "POST" && parts.length === 4 && parts[2] === "outbox" && parts[3] === "process") {
          const body = await readJsonBody(req);
          const result = await heartbeatService.runOutboxNow(Number(body.limit ?? 0));
          return jsonResponse(res, 200, { result });
        }
        if (method === "POST" && parts.length === 3 && parts[2] === "jobs") {
          const body = await readJsonBody(req);
          const job = await heartbeatService.createJob(body);
          return jsonResponse(res, 201, { job });
        }
        if (method === "GET" && parts.length === 3 && parts[2] === "runs") {
          const runs = await heartbeatService.listRuns({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            jobId: url.searchParams.get("jobId") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 200)
          });
          return jsonResponse(res, 200, { runs });
        }
        if (parts.length === 4 && parts[2] === "jobs") {
          const job = await heartbeatService.getJob(parts[3]);
          if (!job) {
            return jsonResponse(res, 404, { error: "Heartbeat job not found." });
          }
          return jsonResponse(res, 200, { job });
        }
        if (parts.length === 5 && parts[2] === "jobs") {
          const jobId = parts[3];
          const action = parts[4];
          if (method === "POST" && action === "run") {
            const run = await heartbeatService.runJobNow(jobId);
            return jsonResponse(res, 200, { run });
          }
          if (method === "POST" && action === "pause") {
            const job = await heartbeatService.pauseJob(jobId);
            return jsonResponse(res, 200, { job });
          }
          if (method === "POST" && action === "resume") {
            const job = await heartbeatService.resumeJob(jobId);
            return jsonResponse(res, 200, { job });
          }
        }
      }

      if (parts.length >= 4 && parts[0] === "api" && parts[1] === "setup" && parts[2] === "wizard") {
        if (method === "POST" && parts.length === 4 && parts[3] === "run") {
          const body = await readJsonBody(req);
          const run = await setupWizardService.runQuickSetup(body);
          return jsonResponse(res, 201, { run });
        }
        if (method === "GET" && parts.length === 4 && parts[3] === "runs") {
          const runs = await setupWizardService.listRuns(url.searchParams.get("workspaceId"));
          return jsonResponse(res, 200, { runs });
        }
        if (method === "GET" && parts.length === 4 && parts[3] !== "run" && parts[3] !== "runs") {
          const run = await setupWizardService.getRun(parts[3]);
          if (!run) {
            return jsonResponse(res, 404, { error: "Wizard run not found." });
          }
          return jsonResponse(res, 200, { run });
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "observability") {
        if (method === "GET" && parts.length === 3 && parts[2] === "events") {
          const events = await observabilityService.listEvents({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            source: url.searchParams.get("source") ?? undefined,
            type: url.searchParams.get("type") ?? undefined,
            traceId: url.searchParams.get("traceId") ?? undefined,
            runId: url.searchParams.get("runId") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 200)
          });
          return jsonResponse(res, 200, { events });
        }
        if (method === "GET" && parts.length === 3 && parts[2] === "metrics") {
          const metrics = await observabilityService.getMetrics({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 2000)
          });
          return jsonResponse(res, 200, { metrics });
        }
        if (method === "GET" && parts.length === 3 && parts[2] === "traces") {
          const traces = await observabilityService.listTraces({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            source: url.searchParams.get("source") ?? undefined,
            runId: url.searchParams.get("runId") ?? undefined,
            status: url.searchParams.get("status") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 200)
          });
          return jsonResponse(res, 200, { traces });
        }
        if (method === "GET" && parts.length === 4 && parts[2] === "traces") {
          const trace = await observabilityService.getTrace(parts[3], {
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            limit: Number(url.searchParams.get("limit") ?? 5000)
          });
          if (!trace) {
            return jsonResponse(res, 404, { error: "Trace not found." });
          }
          return jsonResponse(res, 200, trace);
        }
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "agents") {
        const workspaceId = url.searchParams.get("workspaceId");
        const agents = await agentService.listAgents(workspaceId);
        return jsonResponse(res, 200, { agents });
      }

      if (method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "agents") {
        const body = await readJsonBody(req);
        const agent = await agentService.createAgent(body);
        return jsonResponse(res, 201, { agent });
      }

      if (parts.length === 3 && parts[0] === "api" && parts[1] === "agents") {
        const agentId = parts[2];
        if (method === "GET") {
          const agent = await agentService.getAgent(agentId);
          if (!agent) {
            return jsonResponse(res, 404, { error: "Agent not found." });
          }
          return jsonResponse(res, 200, { agent });
        }
        if (method === "PATCH") {
          const body = await readJsonBody(req);
          const agent = await agentService.updateAgent(agentId, body);
          return jsonResponse(res, 200, { agent });
        }
      }

      if (parts.length >= 4 && parts[0] === "api" && parts[1] === "agents" && parts[3] === "skills") {
        const agentId = parts[2];
        if (method === "GET" && parts.length === 4) {
          const skills = await skillService.listAgentSkills(agentId);
          return jsonResponse(res, 200, { skills });
        }
        if (method === "POST" && parts.length === 4) {
          const body = await readJsonBody(req);
          const skill = await skillService.createSkill(agentId, body);
          return jsonResponse(res, 201, { skill });
        }
        if (method === "POST" && parts.length === 5 && parts[4] === "generate") {
          const body = await readJsonBody(req);
          const shouldUseLlm =
            body?.llm && typeof body.llm === "object" && !Array.isArray(body.llm);
          // Note: skillService.generateSkill should also be awaited if it uses store/chains
          const generated =
            shouldUseLlm
              ? await skillService.generateSkillWithLlm(agentId, body)
              : await skillService.generateSkill(agentId, body);
          return jsonResponse(res, generated.created ? 201 : 200, generated);
        }
        if (parts.length === 5) {
          const skillId = parts[4];
          if (method === "GET") {
            const skill = await skillService.getAgentSkill(agentId, skillId);
            return jsonResponse(res, 200, { skill });
          }
          if (method === "PATCH") {
            const body = await readJsonBody(req);
            const skill = await skillService.updateSkill(agentId, skillId, body);
            return jsonResponse(res, 200, { skill });
          }
        }
        if (parts.length === 6 && parts[5] === "memory") {
          const skillId = parts[4];
          if (method === "GET") {
            const memory = await skillService.listSkillMemory(agentId, skillId);
            return jsonResponse(res, 200, { memory });
          }
          if (method === "POST") {
            const body = await readJsonBody(req);
            const result = await skillService.addSkillMemory(agentId, skillId, body);
            return jsonResponse(res, 201, result);
          }
        }
      }

      if (method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "missions") {
        const body = await readJsonBody(req);
        const mission = await missionService.createMission(body);
        return jsonResponse(res, 201, { mission });
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "missions") {
        const missionId = parts[2];

        if (method === "GET" && parts.length === 3) {
          const mission = await missionService.getMission(missionId);
          if (!mission) {
            return jsonResponse(res, 404, { error: "Mission not found." });
          }
          return jsonResponse(res, 200, { mission });
        }

        if (method === "POST" && parts.length === 4 && parts[3] === "simulate") {
          const simulation = await missionService.simulateMission(missionId);
          return jsonResponse(res, 200, simulation);
        }

        if (method === "POST" && parts.length === 4 && parts[3] === "start") {
          const mission = await missionService.startMission(missionId);
          return jsonResponse(res, 200, { mission });
        }

        if (method === "POST" && parts.length === 4 && parts[3] === "tasks") {
          const body = await readJsonBody(req);
          const task = await missionService.createTask(missionId, body);
          return jsonResponse(res, 201, { task });
        }

        if (method === "PATCH" && parts.length === 5 && parts[3] === "tasks") {
          const taskId = parts[4];
          const body = await readJsonBody(req);
          const task = await missionService.updateTaskStatus(missionId, taskId, body.status);
          return jsonResponse(res, 200, { task });
        }

        if (method === "POST" && parts.length === 4 && parts[3] === "actions") {
          const body = await readJsonBody(req);
          if (!isValidActionType(body.actionType)) {
            return jsonResponse(res, 400, {
              error:
                "Invalid actionType. Use one of: read, write, external_send, financial, destructive."
            });
          }
          const result = await missionService.recordAction(missionId, body);
          return jsonResponse(res, 201, result);
        }

        if (method === "GET" && parts.length === 4 && parts[3] === "timeline") {
          const timeline = await missionService.getTimeline(missionId);
          return jsonResponse(res, 200, timeline);
        }

        if (method === "GET" && parts.length === 4 && parts[3] === "metrics") {
          const metrics = await missionService.getMetrics(missionId);
          return jsonResponse(res, 200, metrics);
        }

        if (method === "GET" && parts.length === 4 && parts[3] === "council") {
          const councils = await councilService.listMissionCouncils(missionId);
          return jsonResponse(res, 200, { councils });
        }

        if (method === "GET" && parts.length === 5 && parts[3] === "council" && parts[4] === "runs") {
          const runs = await councilService.listMissionCouncilRuns(missionId);
          return jsonResponse(res, 200, { runs });
        }

        if (method === "POST" && parts.length === 5 && parts[3] === "council" && parts[4] === "run") {
          const body = await readJsonBody(req);
          const queued = await commandQueue.enqueue(
            {
              lane: `mission:${missionId}`,
              label: "council.run"
            },
            async () => councilService.runCouncil(missionId, body)
          );
          return jsonResponse(res, 201, {
            council: queued.value,
            queue: queued.meta
          });
        }
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "councils") {
        const council = await councilService.getCouncil(parts[2]);
        if (!council) {
          return jsonResponse(res, 404, { error: "Council session not found." });
        }
        return jsonResponse(res, 200, { council });
      }

      if (method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "council-runs") {
        const run = await councilService.getCouncilRun(parts[2]);
        if (!run) {
          return jsonResponse(res, 404, { error: "Council run not found." });
        }
        return jsonResponse(res, 200, { run });
      }

      if (
        method === "POST" &&
        parts.length === 4 &&
        parts[0] === "api" &&
        parts[1] === "approvals" &&
        parts[3] === "decision"
      ) {
        const approvalId = parts[2];
        const body = await readJsonBody(req);
        const approval = await missionService.decideApproval(approvalId, body);
        return jsonResponse(res, 200, { approval });
      }

      if (method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "verify") {
        const body = await readJsonBody(req);
        const verification = await verificationEngine.verifyClaim(body);
        return jsonResponse(res, 200, verification);
      }

      if (method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "plugins") {
        await pluginService.waitUntilReady();
        return jsonResponse(res, 200, {
          plugins: pluginService.listPlugins(),
          status: pluginService.getStatus(),
          loadErrors: pluginService.listLoadErrors()
        });
      }

      if (method === "POST" && parts.length === 3 && parts[0] === "api" && parts[1] === "plugins") {
        if (parts[2] === "reload") {
          const status = await pluginService.reload();
          return jsonResponse(res, 200, {
            status,
            plugins: pluginService.listPlugins(),
            loadErrors: pluginService.listLoadErrors()
          });
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "channels") {
        if (method === "GET" && parts[2] === "adapters" && parts.length === 3) {
          return jsonResponse(res, 200, {
            adapters: channelGatewayService.listAdapters()
          });
        }
        if (method === "GET" && parts[2] === "sessions" && parts.length === 3) {
          const workspaceId = url.searchParams.get("workspaceId");
          const sessions = await channelGatewayService.listSessions(workspaceId);
          return jsonResponse(res, 200, { sessions });
        }
        if (method === "GET" && parts[2] === "sessions" && parts.length === 5 && parts[4] === "messages") {
          const sessionId = parts[3];
          const limit = Number(url.searchParams.get("limit") ?? 50);
          const messages = await channelGatewayService.listSessionMessages(sessionId, limit);
          return jsonResponse(res, 200, { messages });
        }

        const channelId = parts[2];
        if (method === "GET" && parts.length === 4 && parts[3] === "webhook") {
          const verification = await channelGatewayService.verifyWebhook(
            channelId,
            url.searchParams,
            req.headers ?? {}
          );
          if (!verification) {
            return jsonResponse(res, 404, { error: "Webhook verification is not supported for this channel." });
          }
          const statusCode = Number(verification.statusCode ?? 200);
          if (verification.contentType?.startsWith("text/plain")) {
            return sendText(res, statusCode, verification.body ?? "");
          }
          return jsonResponse(res, statusCode, verification.body ?? { ok: true });
        }
        if (method === "POST" && parts.length === 4 && parts[3] === "webhook") {
          const body = await readJsonBody(req);
          const result = await channelGatewayService.processWebhook(channelId, body, {
            workspaceId: url.searchParams.get("workspaceId") ?? undefined
          });
          return jsonResponse(res, 200, result);
        }
      }

      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "plugins") {
        const pluginId = parts[2];
        if (method === "GET" && parts.length === 3) {
          await pluginService.waitUntilReady();
          const plugin = pluginService.getPlugin(pluginId);
          if (!plugin) {
            return jsonResponse(res, 404, { error: "Plugin not found." });
          }
          return jsonResponse(res, 200, { plugin });
        }
        if (
          method === "POST" &&
          parts.length === 6 &&
          parts[3] === "tools" &&
          parts[5] === "invoke"
        ) {
          const toolName = parts[4];
          const body = await readJsonBody(req);
          const requestContext =
            body?.context && typeof body.context === "object" && !Array.isArray(body.context)
              ? body.context
              : {};
          const invocation = await pluginService.invokeTool(
            pluginId,
            toolName,
            body?.input ?? body ?? {},
            {
              source: requestContext.source ?? "api.plugins.invoke",
              ...requestContext
            }
          );
          return jsonResponse(res, 200, { invocation });
        }
      }

      return sendNotFound(res);
    } catch (error) {
      const status = getErrorStatus(error);
      return jsonResponse(res, status, {
        error: error?.message ?? "Unexpected error"
      });
    }
  };

  return {
    handler,
    missionService,
    verificationEngine,
    policyEngine,
    agentService,
    llmService,
    skillService,
    councilService,
    webResearchService,
    commandQueue,
    runtimeTrustService,
    autopilotService,
    heartbeatService,
    notificationOutboxService,
    pluginService,
    channelGatewayService,
    architectureService,
    stateBackendService,
    securityFabricService,
    tunnelService,
    graphRagService,
    memoryEngineService,
    observabilityService,
    evaluationService,
    companyOrchestratorService,
    setupWizardService,
    dashboardService,
    store
  };
}

export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3001);
  const api = createApi(options);
  const server = http.createServer(api.handler);
  server.on("close", () => {
    if (api.autopilotService && typeof api.autopilotService.stop === "function") {
      api.autopilotService.stop();
    }
    if (api.heartbeatService && typeof api.heartbeatService.stop === "function") {
      api.heartbeatService.stop();
    }
    if (api.graphRagService && typeof api.graphRagService.close === "function") {
      api.graphRagService.close().catch(() => { });
    }
    if (api.store && typeof api.store.shutdown === "function") {
      api.store.shutdown().catch(() => { });
    } else if (api.stateBackendService && typeof api.stateBackendService.close === "function") {
      api.stateBackendService.close().catch(() => { });
    }
  });
  server.listen(port);
  return { server, port, api };
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  const { port } = startServer();
  // eslint-disable-next-line no-console
  console.log(`SOVEREIGN MVP API listening on http://localhost:${port}`);
}
