// @ts-nocheck
import { makeId } from "../lib/id.js";

function nowMs() {
  return Date.now();
}

function clampPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return n;
}

export class CommandQueue {
  constructor(options = {}) {
    this.defaultLaneConcurrency = clampPositiveInt(options.defaultLaneConcurrency, 1);
    this.maxConcurrent = clampPositiveInt(options.maxConcurrent, 4);
    this.laneConcurrency = { ...(options.laneConcurrency ?? {}) };

    this.laneQueues = new Map();
    this.laneRunning = new Map();
    this.laneStats = new Map();
    this.laneOrder = [];
    this.globalRunning = 0;
  }

  enqueue(input, run) {
    const lane = String(input?.lane ?? "").trim();
    if (!lane) {
      return Promise.reject(this.#badRequest("Queue lane is required."));
    }
    if (typeof run !== "function") {
      return Promise.reject(this.#badRequest("Queue run handler must be a function."));
    }

    const enqueuedAt = nowMs();
    const job = {
      id: makeId("job"),
      lane,
      label: input?.label ? String(input.label) : "job",
      enqueuedAt,
      run,
      resolve: null,
      reject: null
    };

    const queue = this.laneQueues.get(lane) ?? [];
    queue.push(job);
    this.laneQueues.set(lane, queue);
    this.#touchLaneOrder(lane);
    this.#incLaneStat(lane, "queued");

    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });

    this.#drain();
    return promise;
  }

  getStats() {
    const lanes = [];
    let queued = 0;
    for (const lane of this.#allLaneKeys()) {
      const queueSize = this.#queueSize(lane);
      const running = this.laneRunning.get(lane) ?? 0;
      const stats = this.laneStats.get(lane) ?? {
        processed: 0,
        failed: 0,
        totalQueuedMs: 0
      };
      queued += queueSize;
      lanes.push({
        lane,
        queued: queueSize,
        running,
        processed: stats.processed,
        failed: stats.failed,
        avgQueuedMs:
          stats.processed > 0 ? Number((stats.totalQueuedMs / stats.processed).toFixed(2)) : 0
      });
    }

    return {
      queued,
      running: this.globalRunning,
      maxConcurrent: this.maxConcurrent,
      defaultLaneConcurrency: this.defaultLaneConcurrency,
      lanes
    };
  }

  #drain() {
    while (this.globalRunning < this.maxConcurrent) {
      const lane = this.#nextRunnableLane();
      if (!lane) {
        return;
      }

      const queue = this.laneQueues.get(lane);
      if (!queue || queue.length === 0) {
        this.#cleanupLane(lane);
        continue;
      }

      const job = queue.shift();
      if (queue.length === 0) {
        this.#cleanupLane(lane);
      }
      this.#incLaneRunning(lane);
      this.globalRunning += 1;

      const startedAt = nowMs();
      Promise.resolve()
        .then(() => job.run())
        .then((value) => {
          this.#onJobDone(lane, startedAt, job, null);
          job.resolve({
            value,
            meta: {
              jobId: job.id,
              lane,
              label: job.label,
              enqueuedAt: new Date(job.enqueuedAt).toISOString(),
              startedAt: new Date(startedAt).toISOString(),
              finishedAt: new Date().toISOString(),
              queuedForMs: Math.max(0, startedAt - job.enqueuedAt)
            }
          });
        })
        .catch((error) => {
          this.#onJobDone(lane, startedAt, job, error);
          job.reject(error);
        });
    }
  }

  #onJobDone(lane, startedAt, job, error) {
    this.#decLaneRunning(lane);
    this.globalRunning = Math.max(0, this.globalRunning - 1);
    const queuedMs = Math.max(0, startedAt - job.enqueuedAt);
    this.#incLaneStat(lane, "processed");
    this.#incLaneStat(lane, "totalQueuedMs", queuedMs);
    if (error) {
      this.#incLaneStat(lane, "failed");
    }
    this.#drain();
  }

  #nextRunnableLane() {
    if (this.laneOrder.length === 0) {
      return null;
    }

    for (let i = 0; i < this.laneOrder.length; i += 1) {
      const lane = this.laneOrder[i];
      const queueSize = this.#queueSize(lane);
      if (queueSize === 0) {
        this.#cleanupLane(lane);
        i -= 1;
        continue;
      }
      const running = this.laneRunning.get(lane) ?? 0;
      const laneLimit = this.#laneLimit(lane);
      if (running < laneLimit) {
        this.laneOrder.splice(i, 1);
        this.laneOrder.push(lane);
        return lane;
      }
    }

    return null;
  }

  #laneLimit(lane) {
    const configured = this.laneConcurrency[lane];
    return clampPositiveInt(configured, this.defaultLaneConcurrency);
  }

  #touchLaneOrder(lane) {
    if (!this.laneOrder.includes(lane)) {
      this.laneOrder.push(lane);
    }
  }

  #queueSize(lane) {
    return this.laneQueues.get(lane)?.length ?? 0;
  }

  #incLaneRunning(lane) {
    this.laneRunning.set(lane, (this.laneRunning.get(lane) ?? 0) + 1);
  }

  #decLaneRunning(lane) {
    const next = (this.laneRunning.get(lane) ?? 0) - 1;
    if (next <= 0) {
      this.laneRunning.delete(lane);
      return;
    }
    this.laneRunning.set(lane, next);
  }

  #incLaneStat(lane, field, delta = 1) {
    const prev = this.laneStats.get(lane) ?? {
      queued: 0,
      processed: 0,
      failed: 0,
      totalQueuedMs: 0
    };
    this.laneStats.set(lane, {
      ...prev,
      [field]: (prev[field] ?? 0) + delta
    });
  }

  #cleanupLane(lane) {
    this.laneQueues.delete(lane);
    this.laneOrder = this.laneOrder.filter((item) => item !== lane);
  }

  #allLaneKeys() {
    const keys = new Set([
      ...this.laneStats.keys(),
      ...this.laneQueues.keys(),
      ...this.laneRunning.keys()
    ]);
    return [...keys].sort((a, b) => a.localeCompare(b));
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }
}
