// @ts-nocheck
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

const HEARTBEAT_STATUS = Object.freeze({
  ACTIVE: "active",
  PAUSED: "paused"
});

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

function computeNextRun(intervalMinutes, now = Date.now()) {
  return new Date(now + intervalMinutes * 60 * 1000).toISOString();
}

export class HeartbeatService {
  constructor(options = {}) {
    this.store = options.store;
    this.companyOrchestratorService = options.companyOrchestratorService ?? null;
    this.channelGatewayService = options.channelGatewayService ?? null;
    this.observabilityService = options.observabilityService ?? null;
    this.tickMs = clampInt(options.tickMs ?? process.env.HEARTBEAT_TICK_MS, 15000, 1000, 120000);
    this.autoStart = options.autoStart !== false;
    this.interval = null;
    this.running = false;

    if (this.autoStart) {
      this.start();
    }
  }

  start() {
    if (this.interval) {
      return;
    }
    this.interval = setInterval(() => {
      this.runDueJobs().catch(() => { });
    }, this.tickMs);
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

  async listJobs(workspaceId = null) {
    return this.store.listHeartbeatJobs(workspaceId ? safeString(workspaceId) : null);
  }

  async getJob(jobId) {
    return this.store.getHeartbeatJobById(safeString(jobId));
  }

  async createJob(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const prompt = safeString(input.prompt);
    if (!prompt) {
      throw this.#badRequest("prompt is required.");
    }
    const intervalMinutes = clampInt(input.intervalMinutes, 60, 1, 24 * 60);
    const createdAt = nowIso();
    const job = await this.store.createHeartbeatJob({
      id: makeId("hjob"),
      workspaceId,
      name: safeString(input.name, prompt.slice(0, 60)),
      prompt,
      type: safeString(input.type, "company-objective"),
      intervalMinutes,
      notifyTargets: Array.isArray(input.notifyTargets) ? input.notifyTargets : [],
      status: HEARTBEAT_STATUS.ACTIVE,
      createdAt,
      updatedAt: createdAt,
      lastRunAt: null,
      nextRunAt: computeNextRun(intervalMinutes)
    });
    this.#observe("heartbeat.job.created", "Heartbeat job created.", { jobId: job.id, workspaceId });
    return job;
  }

  async pauseJob(jobId) {
    const job = await this.#requireJob(jobId);
    const updated = await this.store.updateHeartbeatJob(job.id, {
      status: HEARTBEAT_STATUS.PAUSED,
      updatedAt: nowIso()
    });
    this.#observe("heartbeat.job.paused", "Heartbeat job paused.", { jobId: job.id });
    return updated;
  }

  async resumeJob(jobId) {
    const job = await this.#requireJob(jobId);
    const updated = await this.store.updateHeartbeatJob(job.id, {
      status: HEARTBEAT_STATUS.ACTIVE,
      updatedAt: nowIso(),
      nextRunAt: computeNextRun(job.intervalMinutes || 60, Date.now())
    });
    this.#observe("heartbeat.job.resumed", "Heartbeat job resumed.", { jobId: job.id });
    return updated;
  }

  async listRuns(filters = {}) {
    return this.store.listHeartbeatRuns({
      workspaceId: filters.workspaceId ? safeString(filters.workspaceId) : undefined,
      jobId: filters.jobId ? safeString(filters.jobId) : undefined,
      limit: clampInt(filters.limit, 200, 1, 2000)
    });
  }

  async runJobNow(jobId) {
    const job = await this.#requireJob(jobId);
    return this.#executeJob(job);
  }

  async runDueJobs() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const now = Date.now();
      const allJobs = await this.store.listHeartbeatJobs();
      const jobs = allJobs
        .filter((job) => job.status === HEARTBEAT_STATUS.ACTIVE)
        .filter((job) => {
          const nextRunAt = Date.parse(job.nextRunAt ?? 0);
          return !Number.isFinite(nextRunAt) || nextRunAt <= now;
        })
        .sort((a, b) => Date.parse(a.nextRunAt || 0) - Date.parse(b.nextRunAt || 0));

      for (const job of jobs) {
        await this.#executeJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  async #executeJob(job) {
    const startedAt = nowIso();
    const runId = makeId("hrun");

    try {
      let result = null;
      if (job.type === "company-objective" && this.companyOrchestratorService) {
        result = await this.companyOrchestratorService.executeObjective({
          workspaceId: job.workspaceId,
          objective: job.prompt,
          notifyTargets: job.notifyTargets,
          source: "heartbeat"
        });
      } else if (job.type === "message" && this.channelGatewayService) {
        const target = Array.isArray(job.notifyTargets) ? job.notifyTargets[0] : null;
        if (!target?.channelId || !target?.chatId) {
          throw this.#badRequest("message heartbeat jobs require at least one notify target.");
        }
        result = await this.channelGatewayService.sendProactiveMessage({
          channelId: target.channelId,
          workspaceId: target.workspaceId ?? job.workspaceId,
          chatId: target.chatId,
          userId: target.userId ?? "heartbeat",
          text: job.prompt,
          metadata: {
            source: "heartbeat.message",
            jobId: job.id
          }
        });
      } else {
        result = {
          skipped: true,
          reason: "no-executor"
        };
      }

      const completedAt = nowIso();
      const completedRun = await this.store.createHeartbeatRun({
        id: runId,
        workspaceId: job.workspaceId,
        jobId: job.id,
        status: "completed",
        createdAt: startedAt,
        completedAt,
        error: null,
        result
      });
      await this.store.updateHeartbeatJob(job.id, {
        lastRunAt: completedAt,
        nextRunAt: computeNextRun(job.intervalMinutes || 60),
        updatedAt: completedAt
      });
      this.#observe("heartbeat.run.completed", "Heartbeat run completed.", {
        jobId: job.id,
        runId
      });
      return completedRun;
    } catch (error) {
      const completedAt = nowIso();
      const failed = await this.store.createHeartbeatRun({
        id: runId,
        workspaceId: job.workspaceId,
        jobId: job.id,
        status: "failed",
        createdAt: startedAt,
        completedAt,
        error: error instanceof Error ? error.message : String(error),
        result: null
      });
      await this.store.updateHeartbeatJob(job.id, {
        lastRunAt: completedAt,
        nextRunAt: computeNextRun(job.intervalMinutes || 60),
        updatedAt: completedAt
      });
      this.#observe("heartbeat.run.failed", "Heartbeat run failed.", {
        jobId: job.id,
        runId,
        error: failed.error
      });
      return failed;
    }
  }

  async #requireJob(jobId) {
    const job = await this.getJob(jobId);
    if (!job) {
      throw this.#notFound("Heartbeat job not found.");
    }
    return job;
  }

  #observe(type, message, payload) {
    if (!this.observabilityService) {
      return;
    }
    this.observabilityService.record({
      source: "heartbeat",
      type,
      message,
      payload
    });
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
