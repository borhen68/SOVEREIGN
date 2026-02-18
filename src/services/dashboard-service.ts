// @ts-nocheck
import { nowIso } from "../lib/time.js";

function safeString(value, fallback = "") {
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

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function toDateMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortRecent(items, selector) {
  return [...items].sort((a, b) => toDateMs(selector(b)) - toDateMs(selector(a)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((item) => String(item)))];
}

function avg(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, item) => sum + Number(item || 0), 0);
  return Number((total / values.length).toFixed(3));
}

function parseBool(value) {
  const normalized = safeString(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

async function safeCall(run, fallback) {
  try {
    const value = await run();
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function mapRunSummary(run, missionById) {
  const stageLogs = Array.isArray(run.stageLogs) ? run.stageLogs : [];
  const latestStage = stageLogs.length > 0 ? stageLogs[stageLogs.length - 1] : null;
  const executionResults = Array.isArray(run?.result?.executionResults)
    ? run.result.executionResults
    : [];
  const consensusValues = executionResults
    .map((item) => Number(item?.consensus))
    .filter((value) => Number.isFinite(value));
  const consensusAvg = consensusValues.length > 0 ? avg(consensusValues) : null;
  const mission = run.missionId ? missionById.get(run.missionId) ?? null : null;
  return {
    id: run.id,
    status: run.status,
    objective: run.objective,
    summary: run.summary ?? "",
    workspaceId: run.workspaceId,
    missionId: run.missionId,
    mission: mission
      ? {
        id: mission.id,
        title: mission.title,
        status: mission.status,
        deadline: mission.deadline
      }
      : null,
    startedAt: run.startedAt ?? null,
    updatedAt: run.updatedAt ?? null,
    completedAt: run.completedAt ?? null,
    stage: latestStage
      ? {
        name: latestStage.stage,
        message: latestStage.message,
        at: latestStage.at
      }
      : null,
    stageCount: stageLogs.length,
    pendingEscalation: run.pendingEscalation ?? null,
    verificationVerdict: run?.verification?.verdict ?? null,
    evaluation: run?.evaluation
      ? {
        score: Number(run.evaluation.score ?? 0),
        grade: run.evaluation.grade ?? "",
        passed: Boolean(run.evaluation.passed),
        mode: run.evaluation.mode ?? ""
      }
      : null,
    consensusAvg,
    workstreamCount: executionResults.length,
    successCount: Number(run?.result?.successCount ?? 0),
    failureCount: Number(run?.result?.failureCount ?? 0)
  };
}

function buildRiskBands(actions) {
  const bands = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0
  };
  for (const action of actions) {
    const score = Number(action?.riskScore ?? 0);
    if (score >= 0.9) {
      bands.critical += 1;
      continue;
    }
    if (score >= 0.7) {
      bands.high += 1;
      continue;
    }
    if (score >= 0.4) {
      bands.medium += 1;
      continue;
    }
    bands.low += 1;
  }
  return bands;
}

function buildDebateFeed(councils, maxItems) {
  const items = [];
  for (const council of councils) {
    const contributions = Array.isArray(council?.contributions) ? council.contributions : [];
    for (const contribution of contributions) {
      const keyInsights = Array.isArray(contribution?.keyInsights) ? contribution.keyInsights : [];
      const recommendedActions = Array.isArray(contribution?.recommendedActions)
        ? contribution.recommendedActions
        : [];
      const findings = Array.isArray(contribution?.webFindings) ? contribution.webFindings : [];
      items.push({
        id: `${council.id}:${contribution.id}`,
        at: council.updatedAt ?? council.createdAt ?? nowIso(),
        missionId: council.missionId,
        councilId: council.id,
        agentId: contribution.agentId,
        agentName: contribution.agentName,
        trackTitle: contribution.trackTitle,
        confidence: clampNumber(contribution.confidence, 0, 0, 1),
        soulStyle: contribution.soulStyle ?? "",
        skill: contribution?.activatedSkill
          ? {
            id: contribution.activatedSkill.id,
            name: contribution.activatedSkill.name,
            created: Boolean(contribution.activatedSkill.created)
          }
          : null,
        insight: safeString(keyInsights[0]),
        recommendedAction: safeString(recommendedActions[0]),
        evidenceUrl: safeString(findings[0]?.url),
        evidenceTitle: safeString(findings[0]?.title)
      });
    }
  }
  return sortRecent(items, (item) => item.at).slice(0, maxItems);
}

function summarizeCouncilRun(run, council) {
  const consensusScore = Number(council?.consensus?.consensusScore);
  const topAction = Array.isArray(council?.consensus?.topActions)
    ? safeString(council.consensus.topActions[0]?.action)
    : "";
  const dissentingViews = Array.isArray(council?.consensus?.dissentingViews)
    ? council.consensus.dissentingViews.length
    : 0;
  return {
    id: run.id,
    missionId: run.missionId,
    councilId: run.councilId,
    status: run.status,
    startedAt: run.startedAt ?? run.createdAt ?? null,
    endedAt: run.endedAt ?? null,
    debateRounds: Number(council?.debateRounds ?? run?.debateRounds ?? 0),
    teamAssembly: safeString(council?.teamAssembly ?? run?.teamAssembly),
    subAgentCount: Array.isArray(council?.subAgentIds) ? council.subAgentIds.length : 0,
    spawnedSubAgentCount: Array.isArray(council?.spawnedSubAgentIds)
      ? council.spawnedSubAgentIds.length
      : 0,
    consensusScore: Number.isFinite(consensusScore) ? consensusScore : null,
    topAction: topAction || null,
    dissentingViews
  };
}

export class DashboardService {
  constructor(options = {}) {
    this.companyOrchestratorService = options.companyOrchestratorService;
    this.missionService = options.missionService;
    this.councilService = options.councilService;
    this.runtimeTrustService = options.runtimeTrustService;
    this.observabilityService = options.observabilityService;
    this.agentService = options.agentService;
    this.autopilotService = options.autopilotService;
    this.heartbeatService = options.heartbeatService;
    this.channelGatewayService = options.channelGatewayService;
    this.commandQueue = options.commandQueue;
    this.snapshotCacheTtlMs = clampInt(
      options.snapshotCacheTtlMs ?? process.env.DASHBOARD_CACHE_TTL_MS,
      1500,
      0,
      15000
    );
    this.snapshotCache = new Map();
  }

  #cacheKey(input = {}) {
    return JSON.stringify({
      workspaceId: safeString(input.workspaceId, "default"),
      limit: clampInt(input.limit, 12, 3, 50),
      runtimeLimit: clampInt(input.runtimeLimit, 50, 10, 200),
      eventLimit: clampInt(input.eventLimit, 120, 20, 1000),
      metricsLimit: clampInt(input.metricsLimit, 1500, 50, 5000)
    });
  }

  async getSnapshot(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const limit = clampInt(input.limit, 12, 3, 50);
    const runtimeLimit = clampInt(input.runtimeLimit, Math.max(30, limit * 4), 10, 200);
    const eventLimit = clampInt(input.eventLimit, 120, 20, 1000);
    const metricsLimit = clampInt(input.metricsLimit, 1500, 50, 5000);
    const noCache = parseBool(input.noCache);

    const cacheKey = this.#cacheKey({
      workspaceId,
      limit,
      runtimeLimit,
      eventLimit,
      metricsLimit
    });
    if (!noCache && this.snapshotCacheTtlMs > 0) {
      const cached = this.snapshotCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.snapshot;
      }
    }

    const [
      rawRuns,
      allMissions,
      runtimeActions,
      runtimeMetrics,
      observabilityMetrics,
      traces,
      events,
      agents,
      autopilotGoals,
      heartbeatJobs,
      channelSessions
    ] = await Promise.all([
      safeCall(
        () => this.companyOrchestratorService.listRuns({ workspaceId, limit: Math.max(limit * 2, 20) }),
        []
      ),
      safeCall(() => this.missionService.listMissions(), []),
      safeCall(() => this.runtimeTrustService.listRuntimeActions({ workspaceId, limit: runtimeLimit }), []),
      safeCall(() => this.runtimeTrustService.getRuntimeMetrics({ workspaceId, limit: 2000 }), {
        total: 0,
        allowed: 0,
        blocked: 0,
        failed: 0,
        success: 0,
        successRate: 0,
        blockedRate: 0
      }),
      safeCall(() => this.observabilityService.getMetrics({ workspaceId, limit: metricsLimit }), {
        total: 0,
        traces: 0,
        latencyMs: { p95: 0 },
        tokenUsage: { total: 0 },
        costUsd: { total: 0 }
      }),
      safeCall(() => this.observabilityService.listTraces({ workspaceId, source: "company", limit: Math.max(limit * 2, 20) }), []),
      safeCall(() => this.observabilityService.listEvents({ workspaceId, limit: eventLimit }), []),
      safeCall(() => this.agentService.listAgents(workspaceId), []),
      safeCall(() => this.autopilotService.listGoals({ workspaceId, limit: 50 }), []),
      safeCall(() => this.heartbeatService.listJobs(workspaceId), []),
      safeCall(() => this.channelGatewayService.listSessions(workspaceId), [])
    ]);

    const missions = allMissions.filter((mission) => safeString(mission.workspaceId, "default") === workspaceId);
    const missionById = new Map(missions.map((mission) => [mission.id, mission]));
    const runs = sortRecent(rawRuns, (run) => run.updatedAt ?? run.startedAt ?? run.createdAt).slice(0, limit);
    const runSummaries = runs.map((run) => mapRunSummary(run, missionById));

    const missionIds = unique(runs.map((run) => run.missionId).filter(Boolean)).slice(0, Math.max(limit, 10));
    const missionCouncilRuns = await Promise.all(
      missionIds.map(async (missionId) => {
        const list = await safeCall(() => this.councilService.listMissionCouncilRuns(missionId), []);
        return list.map((run) => ({ ...run, missionId }));
      })
    );
    const councilRuns = sortRecent(
      missionCouncilRuns.flat(),
      (run) => run.startedAt ?? run.createdAt ?? run.endedAt
    ).slice(0, Math.max(limit * 3, 24));
    const councilIds = unique(councilRuns.map((run) => run.councilId).filter(Boolean)).slice(
      0,
      Math.max(limit * 2, 16)
    );
    const councils = await Promise.all(
      councilIds.map((councilId) => safeCall(() => this.councilService.getCouncil(councilId), null))
    );
    const councilById = new Map(
      councils
        .filter((council) => council && council.id)
        .map((council) => [council.id, council])
    );
    const councilSummaries = councilRuns
      .map((run) => summarizeCouncilRun(run, councilById.get(run.councilId) ?? null))
      .slice(0, Math.max(limit * 2, 16));
    const debateFeed = buildDebateFeed(
      sortRecent(
        councils.filter(Boolean),
        (council) => council.updatedAt ?? council.createdAt
      ),
      Math.max(limit * 3, 24)
    );

    const recentEvents = sortRecent(events, (event) => event.createdAt).slice(0, Math.max(limit * 4, 30));
    const recentTraces = sortRecent(traces, (trace) => trace.startedAt).slice(0, Math.max(limit * 2, 20));
    const recentRuntimeActions = sortRecent(runtimeActions, (item) => item.createdAt).slice(0, runtimeLimit);
    const pendingRuntimeApprovals = recentRuntimeActions.filter(
      (item) =>
        item.requiresApproval === true &&
        (item.status === "blocked" || item.status === "pending" || item.decision === "blocked")
    );
    const riskScores = recentRuntimeActions
      .map((item) => Number(item.riskScore))
      .filter((score) => Number.isFinite(score));
    const consensusValues = runSummaries
      .map((item) => Number(item.consensusAvg))
      .filter((score) => Number.isFinite(score));

    const runStatuses = {
      active: runSummaries.filter((run) => ["planning", "executing"].includes(run.status)).length,
      waitingHuman: runSummaries.filter((run) => run.status === "waiting_human").length,
      completed: runSummaries.filter((run) => run.status === "completed").length,
      failed: runSummaries.filter((run) => run.status === "failed").length
    };

    const queueStats = this.commandQueue && typeof this.commandQueue.getStats === "function"
      ? this.commandQueue.getStats()
      : null;

    const snapshot = {
      generatedAt: nowIso(),
      workspaceId,
      stats: {
        runsTotal: runSummaries.length,
        runsActive: runStatuses.active,
        runsWaitingHuman: runStatuses.waitingHuman,
        runsCompleted: runStatuses.completed,
        runsFailed: runStatuses.failed,
        pendingApprovals: pendingRuntimeApprovals.length,
        avgRiskScore: riskScores.length > 0 ? avg(riskScores) : 0,
        avgConsensus: consensusValues.length > 0 ? avg(consensusValues) : 0,
        latencyP95Ms: Number(observabilityMetrics?.latencyMs?.p95 ?? 0),
        tokenUsageTotal: Number(observabilityMetrics?.tokenUsage?.total ?? 0),
        costUsdTotal: Number(observabilityMetrics?.costUsd?.total ?? 0)
      },
      orchestrator: {
        latestRuns: runSummaries
      },
      council: {
        latestRuns: councilSummaries,
        debateFeed
      },
      risk: {
        metrics: runtimeMetrics,
        bands: buildRiskBands(recentRuntimeActions),
        pendingApprovals: pendingRuntimeApprovals.map((item) => ({
          id: item.id,
          missionId: item.missionId,
          actionType: item.actionType,
          summary: item.summary,
          riskScore: Number(item.riskScore ?? 0),
          status: item.status,
          decision: item.decision,
          approvalReason: item.approvalReason,
          createdAt: item.createdAt
        })),
        latestActions: recentRuntimeActions.slice(0, Math.max(limit * 2, 20)).map((item) => ({
          id: item.id,
          missionId: item.missionId,
          actionType: item.actionType,
          pluginId: item.pluginId,
          toolName: item.toolName,
          summary: item.summary,
          riskScore: Number(item.riskScore ?? 0),
          requiresApproval: Boolean(item.requiresApproval),
          status: item.status,
          decision: item.decision,
          createdAt: item.createdAt
        }))
      },
      observability: {
        metrics: observabilityMetrics,
        traces: recentTraces.map((trace) => ({
          id: trace.id,
          name: trace.name,
          status: trace.status,
          runId: trace.runId,
          missionId: trace.missionId,
          eventCount: Number(trace.eventCount ?? 0),
          spanCount: Number(trace.spanCount ?? 0),
          errorCount: Number(trace.errorCount ?? 0),
          startedAt: trace.startedAt,
          endedAt: trace.endedAt
        })),
        events: recentEvents.map((event) => ({
          id: event.id,
          source: event.source,
          type: event.type,
          level: event.level,
          message: event.message,
          runId: event.runId,
          missionId: event.missionId,
          traceId: event.traceId,
          createdAt: event.createdAt
        }))
      },
      agents: {
        total: agents.length,
        withWeb: agents.filter((agent) => agent.canUseWeb).length,
        list: agents.slice(0, Math.max(limit * 2, 20)).map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          title: agent.title,
          canUseWeb: Boolean(agent.canUseWeb),
          skillCount: Array.isArray(agent.skills) ? agent.skills.length : 0,
          soulStyle: safeString(agent?.soul?.communicationStyle),
          riskTolerance: safeString(agent?.soul?.riskTolerance)
        }))
      },
      autopilot: {
        activeCount: autopilotGoals.filter((goal) => goal.status === "running").length,
        goals: sortRecent(autopilotGoals, (goal) => goal.updatedAt ?? goal.createdAt)
          .slice(0, Math.max(limit, 8))
          .map((goal) => ({
            id: goal.id,
            name: goal.name,
            status: goal.status,
            cadenceMinutes: goal.cadenceMinutes,
            updatedAt: goal.updatedAt
          }))
      },
      heartbeat: {
        activeCount: heartbeatJobs.filter((job) => job.status === "active").length,
        jobs: sortRecent(heartbeatJobs, (job) => job.updatedAt ?? job.createdAt)
          .slice(0, Math.max(limit, 8))
          .map((job) => ({
            id: job.id,
            name: job.name,
            status: job.status,
            cadenceMinutes: job.cadenceMinutes,
            updatedAt: job.updatedAt
          }))
      },
      channels: {
        sessions: sortRecent(channelSessions, (session) => session.updatedAt ?? session.createdAt)
          .slice(0, Math.max(limit * 2, 20))
          .map((session) => ({
            id: session.id,
            channelId: session.channelId,
            userId: session.userId,
            chatId: session.chatId,
            updatedAt: session.updatedAt
          }))
      },
      queue: queueStats
    };

    if (this.snapshotCacheTtlMs > 0) {
      this.snapshotCache.set(cacheKey, {
        snapshot,
        expiresAt: Date.now() + this.snapshotCacheTtlMs
      });
      if (this.snapshotCache.size > 80) {
        for (const [key, value] of this.snapshotCache) {
          if (!value || value.expiresAt <= Date.now()) {
            this.snapshotCache.delete(key);
          }
        }
      }
    }

    return snapshot;
  }
}
