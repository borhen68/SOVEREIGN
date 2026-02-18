// @ts-nocheck
import { makeId } from "../lib/id.js";
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

function normalizePayload(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function toTimestamp(value, fallback = null) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toISOString();
}

function percentile(sortedValues, pct) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return 0;
  }
  const normalized = clampNumber(pct, 0.95, 0, 1);
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * normalized) - 1)
  );
  return Number(sortedValues[index] ?? 0);
}

export class ObservabilityService {
  constructor(options = {}) {
    this.store = options.store;
  }

  record(input = {}) {
    if (!this.store) {
      return null;
    }
    const event = this.store.createObservabilityEvent({
      id: makeId("obs"),
      workspaceId: safeString(input.workspaceId, "default"),
      source: safeString(input.source, "system"),
      type: safeString(input.type, "event"),
      level: safeString(input.level, "info").toLowerCase(),
      message: safeString(input.message),
      payload: normalizePayload(input.payload),
      traceId: safeString(input.traceId) || null,
      spanId: safeString(input.spanId) || null,
      parentSpanId: safeString(input.parentSpanId) || null,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      durationMs: Number.isFinite(Number(input.durationMs))
        ? Math.max(0, Number(input.durationMs))
        : null,
      tokenUsage: Number.isFinite(Number(input.tokenUsage)) ? Math.max(0, Number(input.tokenUsage)) : null,
      costUsd: Number.isFinite(Number(input.costUsd)) ? Math.max(0, Number(input.costUsd)) : null,
      createdAt: toTimestamp(input.createdAt, nowIso()) ?? nowIso()
    });
    return event;
  }

  createTrace(input = {}) {
    const traceId = safeString(input.traceId, makeId("trace"));
    const trace = {
      id: traceId,
      workspaceId: safeString(input.workspaceId, "default"),
      source: safeString(input.source, "system"),
      name: safeString(input.name, "trace"),
      status: "active",
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      metadata: normalizePayload(input.metadata),
      startedAt: nowIso(),
      endedAt: null
    };
    this.record({
      workspaceId: trace.workspaceId,
      source: trace.source,
      type: "trace.start",
      level: "info",
      message: `Trace started: ${trace.name}`,
      payload: {
        name: trace.name,
        status: trace.status,
        metadata: trace.metadata
      },
      traceId: trace.id,
      runId: trace.runId,
      missionId: trace.missionId,
      createdAt: trace.startedAt
    });
    return trace;
  }

  endTrace(input = {}) {
    const traceId = safeString(input.traceId);
    if (!traceId) {
      throw this.#badRequest("traceId is required.");
    }
    const endedAt = nowIso();
    const event = this.record({
      workspaceId: safeString(input.workspaceId, "default"),
      source: safeString(input.source, "system"),
      type: "trace.end",
      level: safeString(input.level, "info"),
      message: safeString(input.message, "Trace ended."),
      payload: {
        status: safeString(input.status, "completed"),
        summary: safeString(input.summary),
        metadata: normalizePayload(input.metadata)
      },
      traceId,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      createdAt: endedAt
    });
    return {
      traceId,
      status: safeString(input.status, "completed"),
      endedAt,
      eventId: event?.id ?? null
    };
  }

  startSpan(input = {}) {
    const traceId = safeString(input.traceId);
    if (!traceId) {
      throw this.#badRequest("traceId is required.");
    }
    const span = {
      id: safeString(input.spanId, makeId("span")),
      traceId,
      parentSpanId: safeString(input.parentSpanId) || null,
      workspaceId: safeString(input.workspaceId, "default"),
      source: safeString(input.source, "system"),
      name: safeString(input.name, "span"),
      metadata: normalizePayload(input.metadata),
      startedAt: nowIso()
    };
    this.record({
      workspaceId: span.workspaceId,
      source: span.source,
      type: "trace.span.start",
      level: "info",
      message: `Span started: ${span.name}`,
      payload: {
        name: span.name,
        metadata: span.metadata
      },
      traceId: span.traceId,
      spanId: span.id,
      parentSpanId: span.parentSpanId,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      createdAt: span.startedAt
    });
    return span;
  }

  endSpan(input = {}) {
    const traceId = safeString(input.traceId);
    const spanId = safeString(input.spanId);
    if (!traceId || !spanId) {
      throw this.#badRequest("traceId and spanId are required.");
    }
    const startedAt = toTimestamp(input.startedAt);
    const endedAt = nowIso();
    const durationMs = Number.isFinite(Number(input.durationMs))
      ? Math.max(0, Number(input.durationMs))
      : startedAt
        ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
        : null;
    this.record({
      workspaceId: safeString(input.workspaceId, "default"),
      source: safeString(input.source, "system"),
      type: "trace.span.end",
      level: safeString(input.level, "info"),
      message: safeString(input.message, "Span ended."),
      payload: {
        name: safeString(input.name),
        status: safeString(input.status, "completed"),
        error: safeString(input.error),
        metadata: normalizePayload(input.metadata)
      },
      traceId,
      spanId,
      parentSpanId: safeString(input.parentSpanId) || null,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      durationMs,
      createdAt: endedAt
    });
    return {
      traceId,
      spanId,
      status: safeString(input.status, "completed"),
      durationMs,
      endedAt
    };
  }

  recordEval(input = {}) {
    return this.record({
      workspaceId: safeString(input.workspaceId, "default"),
      source: safeString(input.source, "eval"),
      type: safeString(input.type, "eval.result"),
      level: safeString(input.level, "info"),
      message: safeString(input.message, "Evaluation recorded."),
      payload: {
        score: clampNumber(input.score, 0, 0, 1),
        grade: safeString(input.grade),
        passed: Boolean(input.passed),
        rationale: safeString(input.rationale),
        recommendations: Array.isArray(input.recommendations) ? input.recommendations : [],
        modelRef: safeString(input.modelRef),
        mode: safeString(input.mode, "heuristic")
      },
      traceId: safeString(input.traceId) || null,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null
    });
  }

  listEvents(filters = {}) {
    if (!this.store) {
      return [];
    }
    const events = this.store.listObservabilityEvents({
      workspaceId: filters.workspaceId ? safeString(filters.workspaceId) : undefined,
      source: filters.source ? safeString(filters.source) : undefined,
      limit: clampInt(filters.limit, 200, 1, 5000)
    });
    return events
      .filter((event) => {
        if (filters.type && event.type !== safeString(filters.type)) {
          return false;
        }
        if (filters.traceId && event.traceId !== safeString(filters.traceId)) {
          return false;
        }
        if (filters.runId && event.runId !== safeString(filters.runId)) {
          return false;
        }
        if (filters.missionId && event.missionId !== safeString(filters.missionId)) {
          return false;
        }
        if (filters.level && event.level !== safeString(filters.level).toLowerCase()) {
          return false;
        }
        return true;
      })
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  listTraces(filters = {}) {
    const events = this.listEvents({
      workspaceId: filters.workspaceId,
      source: filters.source,
      limit: clampInt(filters.limit, 2000, 1, 20000)
    }).filter((event) => event.traceId);
    const traces = new Map();

    for (const event of events) {
      const traceId = event.traceId;
      if (!traces.has(traceId)) {
        traces.set(traceId, {
          id: traceId,
          workspaceId: event.workspaceId,
          source: event.source,
          runId: event.runId ?? null,
          missionId: event.missionId ?? null,
          name: "",
          status: "active",
          startedAt: event.createdAt,
          endedAt: null,
          eventCount: 0,
          spanCount: 0,
          errorCount: 0
        });
      }
      const trace = traces.get(traceId);
      trace.eventCount += 1;
      if (event.level === "error") {
        trace.errorCount += 1;
      }
      if (event.type === "trace.start") {
        trace.name = safeString(event.payload?.name, trace.name || "trace");
        trace.startedAt = event.createdAt;
      }
      if (event.type === "trace.end") {
        trace.status = safeString(event.payload?.status, "completed");
        trace.endedAt = event.createdAt;
      }
      if (event.type === "trace.span.start") {
        trace.spanCount += 1;
      }
      if (event.runId) {
        trace.runId = event.runId;
      }
      if (event.missionId) {
        trace.missionId = event.missionId;
      }
    }

    let list = [...traces.values()].sort(
      (a, b) => Date.parse(String(b.startedAt)) - Date.parse(String(a.startedAt))
    );
    if (filters.runId) {
      list = list.filter((trace) => trace.runId === safeString(filters.runId));
    }
    if (filters.status) {
      list = list.filter((trace) => trace.status === safeString(filters.status));
    }
    return list.slice(0, clampInt(filters.limit, 200, 1, 5000));
  }

  getTrace(traceId, filters = {}) {
    const normalizedTraceId = safeString(traceId);
    if (!normalizedTraceId) {
      throw this.#badRequest("traceId is required.");
    }
    const events = this.listEvents({
      workspaceId: filters.workspaceId,
      traceId: normalizedTraceId,
      limit: clampInt(filters.limit, 5000, 1, 50000)
    });
    if (events.length === 0) {
      return null;
    }

    const spans = new Map();
    for (const event of events) {
      if (!event.spanId) {
        continue;
      }
      if (!spans.has(event.spanId)) {
        spans.set(event.spanId, {
          id: event.spanId,
          traceId: normalizedTraceId,
          parentSpanId: event.parentSpanId ?? null,
          name: safeString(event.payload?.name, "span"),
          status: "active",
          startedAt: null,
          endedAt: null,
          durationMs: null,
          error: ""
        });
      }
      const span = spans.get(event.spanId);
      if (event.type === "trace.span.start") {
        span.startedAt = event.createdAt;
        span.name = safeString(event.payload?.name, span.name);
      }
      if (event.type === "trace.span.end") {
        span.endedAt = event.createdAt;
        span.durationMs = Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : null;
        span.status = safeString(event.payload?.status, "completed");
        span.error = safeString(event.payload?.error);
      }
    }

    const traces = this.listTraces({
      workspaceId: filters.workspaceId,
      limit: 5000
    });
    const trace = traces.find((item) => item.id === normalizedTraceId);
    return {
      trace,
      spans: [...spans.values()].sort(
        (a, b) => Date.parse(String(a.startedAt || a.endedAt || 0)) - Date.parse(String(b.startedAt || b.endedAt || 0))
      ),
      events
    };
  }

  getMetrics(filters = {}) {
    const events = this.listEvents({
      workspaceId: filters.workspaceId,
      runId: filters.runId,
      missionId: filters.missionId,
      limit: clampInt(filters.limit, 2000, 1, 10000)
    });
    const bySource = {};
    const byLevel = {};
    const byType = {};
    const byRun = {};
    const bySourceUsage = {};
    const durations = [];
    let tracedEvents = 0;
    let totalDurationMs = 0;
    let durationCount = 0;
    let totalTokenUsage = 0;
    let tokenUsageEventCount = 0;
    let totalCostUsd = 0;
    let costEventCount = 0;
    for (const event of events) {
      bySource[event.source] = (bySource[event.source] ?? 0) + 1;
      byLevel[event.level] = (byLevel[event.level] ?? 0) + 1;
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      if (event.runId) {
        byRun[event.runId] = (byRun[event.runId] ?? 0) + 1;
      }
      if (event.traceId) {
        tracedEvents += 1;
      }

      if (!bySourceUsage[event.source]) {
        bySourceUsage[event.source] = {
          events: 0,
          durationMs: 0,
          tokenUsage: 0,
          costUsd: 0
        };
      }
      bySourceUsage[event.source].events += 1;

      if (Number.isFinite(Number(event.durationMs))) {
        const duration = Math.max(0, Number(event.durationMs));
        durations.push(duration);
        totalDurationMs += duration;
        durationCount += 1;
        bySourceUsage[event.source].durationMs += duration;
      }
      if (Number.isFinite(Number(event.tokenUsage))) {
        const tokens = Math.max(0, Number(event.tokenUsage));
        totalTokenUsage += tokens;
        tokenUsageEventCount += 1;
        bySourceUsage[event.source].tokenUsage += tokens;
      }
      if (Number.isFinite(Number(event.costUsd))) {
        const cost = Math.max(0, Number(event.costUsd));
        totalCostUsd += cost;
        costEventCount += 1;
        bySourceUsage[event.source].costUsd += cost;
      }
    }
    const sortedDurations = durations.sort((a, b) => a - b);
    return {
      total: events.length,
      tracedEvents,
      traces: this.listTraces({
        workspaceId: filters.workspaceId,
        limit: 1000
      }).length,
      bySource,
      byLevel,
      byType,
      byRun,
      bySourceUsage,
      latencyMs: {
        count: durationCount,
        avg: Number((totalDurationMs / Math.max(1, durationCount)).toFixed(3)),
        p50: percentile(sortedDurations, 0.5),
        p95: percentile(sortedDurations, 0.95),
        max: sortedDurations.length > 0 ? Number(sortedDurations[sortedDurations.length - 1]) : 0
      },
      tokenUsage: {
        total: Math.round(totalTokenUsage),
        events: tokenUsageEventCount,
        avgPerEvent: Number((totalTokenUsage / Math.max(1, tokenUsageEventCount)).toFixed(3))
      },
      costUsd: {
        total: Number(totalCostUsd.toFixed(6)),
        events: costEventCount,
        avgPerEvent: Number((totalCostUsd / Math.max(1, costEventCount)).toFixed(6))
      }
    };
  }

  getUsage(filters = {}) {
    const events = this.listEvents({
      workspaceId: filters.workspaceId,
      runId: filters.runId,
      missionId: filters.missionId,
      source: filters.source,
      limit: clampInt(filters.limit, 5000, 1, 100000)
    });
    let costUsd = 0;
    let tokenUsage = 0;
    let costEventCount = 0;
    let tokenEventCount = 0;
    for (const event of events) {
      if (Number.isFinite(Number(event.costUsd))) {
        costUsd += Math.max(0, Number(event.costUsd));
        costEventCount += 1;
      }
      if (Number.isFinite(Number(event.tokenUsage))) {
        tokenUsage += Math.max(0, Number(event.tokenUsage));
        tokenEventCount += 1;
      }
    }
    return {
      costUsd: Number(costUsd.toFixed(6)),
      tokenUsage: Math.round(tokenUsage),
      costEventCount,
      tokenEventCount,
      eventCount: events.length
    };
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }
}
