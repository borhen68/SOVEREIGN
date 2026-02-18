// @ts-nocheck
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

export const AutopilotStatus = Object.freeze({
  QUEUED: "queued",
  PLANNING: "planning",
  EXECUTING: "executing",
  BLOCKED: "blocked",
  DONE: "done",
  FAILED: "failed",
  PAUSED: "paused",
  CANCELLED: "cancelled"
});

const TERMINAL_STATUS = new Set([
  AutopilotStatus.DONE,
  AutopilotStatus.FAILED,
  AutopilotStatus.CANCELLED
]);

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

function normalizeNotifyTargets(input, workspaceId) {
  if (!Array.isArray(input)) {
    return [];
  }
  const targets = [];
  const dedupe = new Set();
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const channelId = safeString(item.channelId).toLowerCase();
    const chatId = safeString(item.chatId);
    if (!channelId || !chatId) {
      continue;
    }
    const userId = safeString(item.userId, "autopilot");
    const resolvedWorkspaceId = safeString(item.workspaceId, workspaceId);
    const key = `${channelId}:${resolvedWorkspaceId}:${chatId}:${userId}`;
    if (dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    targets.push({
      channelId,
      workspaceId: resolvedWorkspaceId,
      chatId,
      userId
    });
  }
  return targets;
}

function buildMissionDeadline(days = 14) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return now.toISOString();
}

function summarizeCouncilPlan(council, objective) {
  const plan = Array.isArray(council?.finalBriefing?.recommendedPlan)
    ? council.finalBriefing.recommendedPlan
    : [];
  const cleaned = plan
    .map((item) => safeString(item))
    .filter(Boolean)
    .slice(0, 8);
  if (cleaned.length > 0) {
    return cleaned;
  }
  return [safeString(objective, "Deliver delegated objective end-to-end.")];
}

export class AutopilotService {
  constructor(options = {}) {
    this.store = options.store;
    this.missionService = options.missionService;
    this.agentService = options.agentService;
    this.councilService = options.councilService;
    this.channelGatewayService = options.channelGatewayService ?? null;
    this.pollIntervalMs = clampInt(
      options.pollIntervalMs ?? process.env.AUTOPILOT_POLL_MS,
      3000,
      1000,
      60000
    );
    this.maxCyclesDefault = clampInt(options.maxCyclesDefault, 12, 1, 100);
    this.maxFailures = clampInt(options.maxFailures, 4, 1, 20);
    this.retryDelayMs = clampInt(options.retryDelayMs, 15000, 1000, 300000);
    this.stepTimeoutMs = clampInt(
      options.stepTimeoutMs ?? process.env.AUTOPILOT_STEP_TIMEOUT_MS,
      180000,
      5000,
      900000
    );
    this.autoStart = options.autoStart !== false;
    this.observabilityService = options.observabilityService ?? null;
    this.notificationOutboxService = options.notificationOutboxService ?? null;

    this.interval = null;
    this.processing = false;

    if (this.autoStart) {
      this.start();
    }
  }

  start() {
    if (this.interval) {
      return;
    }
    this.interval = setInterval(() => {
      this.runOnce().catch(() => { });
    }, this.pollIntervalMs);
    if (typeof this.interval.unref === "function") {
      this.interval.unref();
    }
  }

  stop() {
    if (!this.interval) {
      return;
    }
    clearInterval(this.interval);
    this.interval = null;
  }

  async listGoals(filters = {}) {
    return this.store.listAutopilotGoals({
      workspaceId: filters.workspaceId ? safeString(filters.workspaceId) : undefined,
      status: filters.status ? safeString(filters.status).toLowerCase() : undefined,
      limit: clampInt(filters.limit, 200, 1, 1000)
    });
  }

  async getGoal(goalId) {
    return this.store.getAutopilotGoalById(safeString(goalId));
  }

  async listGoalLogs(goalId, limit = 200) {
    const id = safeString(goalId);
    if (!id) {
      throw this.#badRequest("goalId is required.");
    }
    const goal = await this.store.getAutopilotGoalById(id);
    if (!goal) {
      throw this.#notFound("Autopilot goal not found.");
    }
    return this.store.listAutopilotLogs(id, clampInt(limit, 200, 1, 2000));
  }

  async createGoal(input = {}) {
    const objective = safeString(input.objective ?? input.goal);
    if (!objective) {
      throw this.#badRequest("objective is required.");
    }

    const workspaceId = safeString(input.workspaceId, "default");
    const createdAt = nowIso();
    const goal = await this.store.createAutopilotGoal({
      id: makeId("autogoal"),
      workspaceId,
      title: safeString(input.title, objective.slice(0, 80)),
      objective,
      constraints: safeString(input.constraints),
      status: AutopilotStatus.QUEUED,
      policyPreset: safeString(input.policyPreset, "balanced"),
      missionId: input.missionId ? safeString(input.missionId) : null,
      mainAgentId: input.mainAgentId ? safeString(input.mainAgentId) : null,
      cycle: 0,
      maxCycles: clampInt(input.maxCycles, this.maxCyclesDefault, 1, 100),
      budgetCap: Number.isFinite(Number(input.budgetCap)) ? Number(input.budgetCap) : null,
      failureCount: 0,
      allowWebResearch: input.allowWebResearch !== false,
      teamSize: clampInt(input.teamSize, 3, 1, 8),
      debateRounds: clampInt(input.debateRounds, 2, 1, 4),
      notifyTargets: normalizeNotifyTargets(input.notifyTargets, workspaceId),
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      completedAt: null,
      lastError: null,
      blockedReason: null,
      resumeStatus: AutopilotStatus.PLANNING,
      nextRunAt: createdAt,
      summary: null
    });

    await this.#log(goal.id, "goal.created", "Autopilot goal created.", {
      objective: goal.objective,
      workspaceId: goal.workspaceId
    });
    return goal;
  }

  async pauseGoal(goalId) {
    return this.#setStatus(goalId, AutopilotStatus.PAUSED, {
      blockedReason: "Paused by user."
    });
  }

  async resumeGoal(goalId) {
    const goal = await this.#requireGoal(goalId);
    if (TERMINAL_STATUS.has(goal.status)) {
      throw this.#badRequest("Cannot resume a terminal autopilot goal.");
    }
    const status =
      goal.resumeStatus && goal.resumeStatus !== AutopilotStatus.BLOCKED
        ? goal.resumeStatus
        : goal.missionId
          ? AutopilotStatus.EXECUTING
          : AutopilotStatus.PLANNING;
    return this.#setStatus(goal.id, status, {
      blockedReason: null,
      nextRunAt: nowIso()
    });
  }

  async cancelGoal(goalId) {
    return this.#setStatus(goalId, AutopilotStatus.CANCELLED, {
      completedAt: nowIso(),
      blockedReason: "Cancelled by user."
    });
  }

  async runOnce() {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      const now = Date.now();
      const allGoals = await this.store.listAutopilotGoals({ limit: 1000 });
      const candidates = allGoals
        .filter((goal) => {
          if (TERMINAL_STATUS.has(goal.status)) {
            return false;
          }
          if (goal.status === AutopilotStatus.PAUSED) {
            return false;
          }
          const nextRunAt = goal.nextRunAt ? Date.parse(goal.nextRunAt) : 0;
          return !Number.isFinite(nextRunAt) || nextRunAt <= now;
        })
        .sort((a, b) => Date.parse(a.updatedAt || 0) - Date.parse(b.updatedAt || 0));

      for (const goal of candidates) {
        await this.#processGoal(goal.id);
      }
    } finally {
      this.processing = false;
    }
  }

  async #processGoal(goalId) {
    const goal = await this.#requireGoal(goalId);
    if (TERMINAL_STATUS.has(goal.status) || goal.status === AutopilotStatus.PAUSED) {
      return;
    }

    try {
      let current = goal;
      if (current.status === AutopilotStatus.BLOCKED) {
        current = await this.#setStatus(current.id, current.resumeStatus || AutopilotStatus.EXECUTING, {
          blockedReason: null
        });
      }

      const mission = await this.#ensureMission(current);
      const budgetBlocked = await this.#enforceMissionBudget(current, mission, {
        stage: "before_planning",
        reasonPrefix: "Budget cap exceeded before planning."
      });
      if (budgetBlocked) {
        return;
      }
      const mainAgent = await this.#ensureMainAgent(current);
      if (!current.startedAt) {
        current = await this.store.updateAutopilotGoal(current.id, {
          startedAt: nowIso(),
          updatedAt: nowIso()
        });
      }

      if (current.status === AutopilotStatus.QUEUED || current.status === AutopilotStatus.PLANNING) {
        const planning = await this.#setStatus(current.id, AutopilotStatus.PLANNING, {
          resumeStatus: AutopilotStatus.PLANNING
        });
        const council = await this.#runCouncilWithTimeout(mission.id, {
          problem: planning.objective,
          mainAgentId: mainAgent.id,
          allowWebResearch: planning.allowWebResearch,
          autoSpawnSubAgents: true,
          autoGenerateSkills: true,
          teamSize: planning.teamSize,
          debateRounds: planning.debateRounds
        });
        const planSteps = summarizeCouncilPlan(council, planning.objective);
        const createdTasks = await this.#ensurePlanTasks(mission.id, planSteps);
        await this.#safeStartMission(mission.id);
        const executing = await this.#setStatus(planning.id, AutopilotStatus.EXECUTING, {
          cycle: planning.cycle + 1,
          failureCount: 0,
          blockedReason: null,
          lastError: null,
          resumeStatus: AutopilotStatus.EXECUTING,
          summary: `Planned ${createdTasks} task(s).`
        });
        await this.#log(planning.id, "planning.complete", "Initial plan generated.", {
          missionId: mission.id,
          mainAgentId: mainAgent.id,
          tasksCreated: createdTasks
        });
        return;
      }

      if (current.status !== AutopilotStatus.EXECUTING) {
        return;
      }

      if (current.cycle >= current.maxCycles) {
        const blocked = await this.#setStatus(current.id, AutopilotStatus.BLOCKED, {
          blockedReason: `Reached maxCycles (${current.maxCycles}).`,
          resumeStatus: AutopilotStatus.EXECUTING
        });
        await this.#log(blocked.id, "execution.blocked", blocked.blockedReason, {});
        await this.#notify(blocked, `Autopilot blocked: ${blocked.blockedReason}`);
        return;
      }

      const missionTasks = await this.store.listMissionTasks(mission.id);
      const pending = missionTasks.find((task) => task.status === "pending" || task.status === "in_progress");
      if (!pending) {
        const finished = await this.#setStatus(current.id, AutopilotStatus.DONE, {
          completedAt: nowIso(),
          summary: "All planned tasks were completed autonomously.",
          blockedReason: null,
          lastError: null
        });
        await this.#log(finished.id, "goal.done", "Autopilot goal completed.", {
          missionId: mission.id
        });
        await this.#notify(
          finished,
          `Done: ${finished.title}\nMission ${mission.id} completed autonomously.`
        );
        return;
      }

      await this.missionService.updateTaskStatus(mission.id, pending.id, "in_progress");
      const executionBudgetBlocked = await this.#enforceMissionBudget(current, mission, {
        stage: "before_task_execution",
        reasonPrefix: "Budget cap exceeded before task execution."
      });
      if (executionBudgetBlocked) {
        await this.missionService.updateTaskStatus(mission.id, pending.id, "failed");
        return;
      }
      await this.#runCouncilWithTimeout(mission.id, {
        problem: `Execute this task: ${pending.title}`,
        mainAgentId: mainAgent.id,
        allowWebResearch: false,
        autoSpawnSubAgents: true,
        autoGenerateSkills: true,
        teamSize: current.teamSize,
        debateRounds: 1
      });
      await this.missionService.updateTaskStatus(mission.id, pending.id, "done");

      const updated = await this.store.updateAutopilotGoal(current.id, {
        cycle: current.cycle + 1,
        failureCount: 0,
        updatedAt: nowIso(),
        summary: `Completed task: ${pending.title}`
      });
      await this.#log(updated.id, "task.done", `Task completed: ${pending.title}`, {
        taskId: pending.id,
        missionId: mission.id
      });
    } catch (error) {
      const latest = await this.#requireGoal(goalId);
      const failureCount = Number(latest.failureCount ?? 0) + 1;
      const message = error instanceof Error ? error.message : String(error);
      const retryAt = new Date(Date.now() + this.retryDelayMs * failureCount).toISOString();
      const status =
        failureCount >= this.maxFailures ? AutopilotStatus.FAILED : AutopilotStatus.BLOCKED;
      const patched = await this.#setStatus(latest.id, status, {
        failureCount,
        lastError: message,
        blockedReason: message,
        resumeStatus:
          latest.status === AutopilotStatus.PLANNING || latest.status === AutopilotStatus.QUEUED
            ? AutopilotStatus.PLANNING
            : AutopilotStatus.EXECUTING,
        nextRunAt: status === AutopilotStatus.BLOCKED ? retryAt : nowIso(),
        completedAt: status === AutopilotStatus.FAILED ? nowIso() : null
      });
      await this.#log(patched.id, "execution.error", message, {
        failureCount,
        retryAt: patched.nextRunAt
      });
      if (status === AutopilotStatus.FAILED) {
        await this.#notify(patched, `Autopilot failed: ${patched.title}\n${message}`);
      }
    }
  }

  async #ensureMission(goal) {
    if (goal.missionId) {
      const existing = await this.missionService.getMission(goal.missionId);
      if (existing) {
        return existing;
      }
    }
    const mission = await this.missionService.createMission({
      workspaceId: goal.workspaceId,
      title: safeString(goal.title, goal.objective.slice(0, 80)),
      objective: goal.objective,
      kpi: "Goal completed without human intervention.",
      deadline: buildMissionDeadline(14),
      budgetCap: Number.isFinite(Number(goal.budgetCap)) ? Number(goal.budgetCap) : null,
      policyPreset: goal.policyPreset || "balanced"
    });
    await this.store.updateAutopilotGoal(goal.id, {
      missionId: mission.id,
      updatedAt: nowIso()
    });
    await this.#log(goal.id, "mission.created", "Mission created for autopilot goal.", {
      missionId: mission.id
    });
    return mission;
  }

  async #safeStartMission(missionId) {
    try {
      await this.missionService.startMission(missionId);
    } catch {
      // Mission may already be executing/completed.
    }
  }

  async #ensureMainAgent(goal) {
    if (goal.mainAgentId) {
      const existing = await this.agentService.getAgent(goal.mainAgentId);
      if (existing) {
        return existing;
      }
    }
    const workspaceAgents = await this.agentService.listAgents(goal.workspaceId);
    const existingMain = workspaceAgents.find((agent) => agent.role === "main");
    if (existingMain) {
      await this.store.updateAutopilotGoal(goal.id, {
        mainAgentId: existingMain.id,
        updatedAt: nowIso()
      });
      return existingMain;
    }
    const created = await this.agentService.createAgent({
      workspaceId: goal.workspaceId,
      name: "SOVEREIGN Commander",
      role: "main",
      title: "Autonomous Delegation Lead",
      skills: ["planning", "operations", "strategy"],
      canUseWeb: true,
      soul: {
        mission: "Deliver delegated outcomes end-to-end with minimal human intervention.",
        values: ["clarity", "ownership", "speed"],
        communicationStyle: "direct",
        riskTolerance: "balanced"
      }
    });
    await this.store.updateAutopilotGoal(goal.id, {
      mainAgentId: created.id,
      updatedAt: nowIso()
    });
    await this.#log(goal.id, "agent.created", "Main autopilot agent created.", {
      mainAgentId: created.id
    });
    return created;
  }

  async #ensurePlanTasks(missionId, planSteps) {
    const existing = await this.store.listMissionTasks(missionId);
    const existingTitles = new Set(existing.map((task) => safeString(task.title).toLowerCase()));
    let created = 0;
    for (const step of planSteps) {
      const title = safeString(step);
      if (!title) {
        continue;
      }
      const key = title.toLowerCase();
      if (existingTitles.has(key)) {
        continue;
      }
      existingTitles.add(key);
      await this.missionService.createTask(missionId, {
        title,
        owner: "autopilot",
        dueDate: buildMissionDeadline(7)
      });
      created += 1;
    }
    return created;
  }

  async #notify(goal, text) {
    if (!this.channelGatewayService || typeof this.channelGatewayService.sendProactiveMessage !== "function") {
      return;
    }
    for (const target of goal.notifyTargets ?? []) {
      try {
        await this.channelGatewayService.sendProactiveMessage({
          channelId: target.channelId,
          workspaceId: target.workspaceId,
          chatId: target.chatId,
          userId: target.userId,
          text
        });
      } catch (error) {
        await this.#log(goal.id, "notify.error", error instanceof Error ? error.message : String(error), {
          channelId: target.channelId,
          chatId: target.chatId
        });
        if (
          this.notificationOutboxService &&
          typeof this.notificationOutboxService.enqueue === "function"
        ) {
          await this.notificationOutboxService.enqueue({
            workspaceId: target.workspaceId ?? goal.workspaceId,
            channelId: target.channelId,
            chatId: target.chatId,
            userId: target.userId ?? "autopilot",
            text,
            metadata: {
              source: "autopilot.notify",
              goalId: goal.id
            },
            missionId: goal.missionId ?? null
          });
        }
      }
    }
  }

  async #runCouncilWithTimeout(missionId, input) {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const timeoutError = new Error(
          `Autopilot council step timed out after ${this.stepTimeoutMs}ms (mission ${missionId}).`
        );
        timeoutError.statusCode = 504;
        timeoutError.code = "STEP_TIMEOUT";
        reject(timeoutError);
      }, this.stepTimeoutMs);
      Promise.resolve()
        .then(() => this.councilService.runCouncil(missionId, input))
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  async #enforceMissionBudget(goal, mission, input = {}) {
    const budgetCap = Number(mission?.budgetCap);
    if (!Number.isFinite(budgetCap) || budgetCap <= 0) {
      return false;
    }
    const usage = await this.#computeMissionUsage({
      workspaceId: goal.workspaceId,
      missionId: mission.id
    });
    if (usage.costUsd < budgetCap) {
      return false;
    }
    const reason = `${safeString(input.reasonPrefix, "Budget cap exceeded.")} Spent ${usage.costUsd} / cap ${budgetCap} USD.`;
    const paused = await this.#setStatus(goal.id, AutopilotStatus.PAUSED, {
      blockedReason: reason,
      summary: reason
    });
    await this.#log(paused.id, "budget.cap.exceeded", reason, {
      stage: safeString(input.stage, "unknown"),
      missionId: mission.id,
      capUsd: Number(budgetCap.toFixed(6)),
      spentUsd: usage.costUsd,
      tokenUsage: usage.tokenUsage
    });
    await this.#notify(paused, `Autopilot paused: ${reason}`);
    return true;
  }

  async #computeMissionUsage(input = {}) {
    if (!this.observabilityService) {
      return {
        costUsd: 0,
        tokenUsage: 0
      };
    }
    if (typeof this.observabilityService.getUsage === "function") {
      const usage = await this.observabilityService.getUsage({
        workspaceId: safeString(input.workspaceId, "default"),
        missionId: safeString(input.missionId),
        source: "llm"
      });
      return {
        costUsd: Number(Number(usage?.costUsd ?? 0).toFixed(6)),
        tokenUsage: Math.max(0, Math.round(Number(usage?.tokenUsage ?? 0)))
      };
    }
    if (typeof this.observabilityService.listEvents !== "function") {
      return {
        costUsd: 0,
        tokenUsage: 0
      };
    }
    const events = await Promise.resolve(
      this.observabilityService.listEvents({
        workspaceId: safeString(input.workspaceId, "default"),
        missionId: safeString(input.missionId),
        source: "llm",
        limit: 50000
      })
    );
    let costUsd = 0;
    let tokenUsage = 0;
    for (const event of events ?? []) {
      if (Number.isFinite(Number(event?.costUsd))) {
        costUsd += Math.max(0, Number(event.costUsd));
      }
      if (Number.isFinite(Number(event?.tokenUsage))) {
        tokenUsage += Math.max(0, Number(event.tokenUsage));
      }
    }
    return {
      costUsd: Number(costUsd.toFixed(6)),
      tokenUsage: Math.round(tokenUsage)
    };
  }

  async #setStatus(goalId, status, patch = {}) {
    const goal = await this.#requireGoal(goalId);
    if (TERMINAL_STATUS.has(goal.status) && status !== goal.status) {
      return goal;
    }
    return await this.store.updateAutopilotGoal(goal.id, {
      status,
      updatedAt: nowIso(),
      ...patch
    });
  }

  async #log(goalId, type, message, payload = {}) {
    await this.store.createAutopilotLog({
      id: makeId("autolog"),
      goalId,
      type: safeString(type, "event"),
      message: safeString(message),
      payload,
      createdAt: nowIso()
    });
  }

  async #requireGoal(goalId) {
    const id = safeString(goalId);
    if (!id) {
      throw this.#badRequest("goalId is required.");
    }
    const goal = await this.store.getAutopilotGoalById(id);
    if (!goal) {
      throw this.#notFound("Autopilot goal not found.");
    }
    return goal;
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }

  #notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
  }
}
