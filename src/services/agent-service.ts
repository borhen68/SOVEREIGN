import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";
import { normalizeModelPolicy } from "../lib/model-policy.js";
import { AgentRole } from "../domain/constants.js";

const SOUL_HISTORY_LIMIT = 200;

function normalizeSkills(skills) {
  if (!Array.isArray(skills)) {
    return [];
  }
  return [...new Set(skills.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

function normalizeSoul(input) {
  const soul = input && typeof input === "object" ? input : {};
  const evolvedAt = soul.evolvedAt ? String(soul.evolvedAt) : null;
  return {
    mission: soul.mission ? String(soul.mission) : "",
    values: Array.isArray(soul.values)
      ? soul.values.map((item) => String(item).trim()).filter(Boolean)
      : [],
    communicationStyle: soul.communicationStyle ? String(soul.communicationStyle) : "direct",
    riskTolerance: soul.riskTolerance ? String(soul.riskTolerance) : "balanced",
    evolvedAt
  };
}

function normalizeSoulHistory(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry, index) => {
      const version = Number(entry?.version);
      return {
        version: Number.isInteger(version) && version > 0 ? version : index + 1,
        soul: normalizeSoul(entry?.soul),
        createdAt: entry?.createdAt ? String(entry.createdAt) : null,
        source: entry?.source ? String(entry.source) : "unknown",
        reason: entry?.reason ? String(entry.reason) : "mutation",
        outcome: entry?.outcome ? String(entry.outcome) : "",
        performanceScore: Number.isFinite(Number(entry?.performanceScore))
          ? Number(entry.performanceScore)
          : null,
        previousVersion: Number.isInteger(Number(entry?.previousVersion))
          ? Number(entry.previousVersion)
          : null
      };
    })
    .sort((a, b) => a.version - b.version);
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function soulSignature(soul) {
  const normalized = normalizeSoul(soul);
  return JSON.stringify({
    mission: normalized.mission,
    values: normalized.values,
    communicationStyle: normalized.communicationStyle,
    riskTolerance: normalized.riskTolerance,
    evolvedAt: normalized.evolvedAt
  });
}

export class AgentService {
  store: any;

  constructor(store: any) {
    this.store = store;
  }

  async listAgents(workspaceId: string | null = null) {
    return this.store.listAgents(workspaceId);
  }

  async getAgent(agentId: string) {
    return this.store.getAgentById(agentId);
  }

  async createAgent(input: any) {
    const name = String(input.name ?? "").trim();
    if (!name) {
      throw this.#badRequest("Agent name is required.");
    }

    const role = input.role === AgentRole.MAIN ? AgentRole.MAIN : AgentRole.SUB;
    const createdAt = nowIso();
    const soul = normalizeSoul(input.soul);
    const initialSoulVersion = 1;
    const agent = {
      id: makeId("agent"),
      workspaceId: input.workspaceId ? String(input.workspaceId) : "default",
      name,
      role,
      title: input.title ? String(input.title) : "",
      skills: normalizeSkills(input.skills),
      soul,
      soulVersion: initialSoulVersion,
      soulUpdatedAt: createdAt,
      soulHistory: [
        {
          version: initialSoulVersion,
          soul,
          createdAt,
          source: "bootstrap",
          reason: "agent_created",
          outcome: "",
          performanceScore: null,
          previousVersion: null
        }
      ],
      model: normalizeModelPolicy(input.model ?? input.modelPolicy),
      canUseWeb: Boolean(input.canUseWeb),
      createdAt,
      updatedAt: createdAt
    };
    await this.store.createAgent(agent);
    return agent;
  }

  async updateAgent(agentId: string, input: any) {
    const existing = await this.store.getAgentById(agentId);
    if (!existing) {
      throw this.#notFound("Agent not found.");
    }
    const patch: any = {
      updatedAt: nowIso()
    };

    if (input.name !== undefined) {
      const value = String(input.name).trim();
      if (!value) {
        throw this.#badRequest("Agent name cannot be empty.");
      }
      patch.name = value;
    }
    if (input.title !== undefined) {
      patch.title = String(input.title);
    }
    if (input.skills !== undefined) {
      patch.skills = normalizeSkills(input.skills);
    }
    if (input.soul !== undefined) {
      const mergedSoul = normalizeSoul({
        ...(existing.soul && typeof existing.soul === "object" ? existing.soul : {}),
        ...(input.soul && typeof input.soul === "object" ? input.soul : {})
      });
      if (soulSignature(mergedSoul) !== soulSignature(existing.soul)) {
        const mutation = this.#buildSoulMutation(existing, mergedSoul, {
          source: input.soulSource ?? "manual",
          reason: input.soulReason ?? "manual_update",
          outcome: input.soulOutcome ?? "",
          performanceScore: input.soulPerformanceScore
        });
        patch.soul = mutation.soul;
        patch.soulHistory = mutation.soulHistory;
        patch.soulVersion = mutation.soulVersion;
        patch.soulUpdatedAt = mutation.soulUpdatedAt;
      }
    }
    if (input.model !== undefined || input.modelPolicy !== undefined) {
      patch.model = normalizeModelPolicy(input.model ?? input.modelPolicy);
    }
    if (input.canUseWeb !== undefined) {
      patch.canUseWeb = Boolean(input.canUseWeb);
    }
    if (input.role !== undefined) {
      patch.role = input.role === AgentRole.MAIN ? AgentRole.MAIN : AgentRole.SUB;
    }

    return this.store.updateAgent(agentId, patch);
  }

  async listSoulHistory(agentId: string, limit = 50) {
    const agent = await this.store.getAgentById(agentId);
    if (!agent) {
      throw this.#notFound("Agent not found.");
    }
    const history = this.#getSoulHistoryWithBaseline(agent);
    const safeLimit = clampInt(limit, 50, 1, SOUL_HISTORY_LIMIT);
    return history.length > safeLimit ? history.slice(history.length - safeLimit) : history;
  }

  async rollbackSoul(agentId: string, input: any = {}) {
    const agent = await this.store.getAgentById(agentId);
    if (!agent) {
      throw this.#notFound("Agent not found.");
    }
    const history = this.#getSoulHistoryWithBaseline(agent);
    if (history.length < 2) {
      throw this.#badRequest("No previous soul version is available for rollback.");
    }
    const currentVersion = Number(history[history.length - 1]?.version ?? 1);
    const requestedVersion = Number(input.targetVersion);
    const targetVersion =
      Number.isInteger(requestedVersion) && requestedVersion > 0
        ? requestedVersion
        : currentVersion - 1;
    const target = history.find((entry) => entry.version === targetVersion);
    if (!target) {
      throw this.#badRequest(`Soul version ${targetVersion} does not exist.`);
    }
    if (targetVersion === currentVersion) {
      throw this.#badRequest("Cannot rollback to the current soul version.");
    }

    const mutation = this.#buildSoulMutation(agent, normalizeSoul(target.soul), {
      source: "rollback",
      reason: String(input.reason ?? `rollback_to_v${targetVersion}`),
      outcome: String(input.outcome ?? ""),
      performanceScore: input.performanceScore
    });
    const updated = await this.store.updateAgent(agent.id, {
      soul: mutation.soul,
      soulHistory: mutation.soulHistory,
      soulVersion: mutation.soulVersion,
      soulUpdatedAt: mutation.soulUpdatedAt,
      updatedAt: mutation.soulUpdatedAt
    });
    return {
      agentBefore: {
        id: agent.id,
        soul: agent.soul ?? {},
        soulVersion: currentVersion
      },
      agentAfter: {
        id: updated.id,
        soul: updated.soul ?? {},
        soulVersion: Number(updated.soulVersion ?? mutation.soulVersion)
      },
      rollback: {
        fromVersion: currentVersion,
        toVersion: targetVersion,
        newVersion: mutation.soulVersion
      }
    };
  }

  async applySoulMutation(agentId: string, input: any = {}) {
    const agent = await this.store.getAgentById(agentId);
    if (!agent) {
      throw this.#notFound("Agent not found.");
    }
    if (!input.soul || typeof input.soul !== "object") {
      throw this.#badRequest("soul payload is required.");
    }
    const nextSoul = normalizeSoul({
      ...(agent.soul && typeof agent.soul === "object" ? agent.soul : {}),
      ...input.soul
    });
    const mutation = this.#buildSoulMutation(agent, nextSoul, {
      source: input.source ?? "system",
      reason: input.reason ?? "mutation",
      outcome: input.outcome ?? "",
      performanceScore: input.performanceScore
    });
    return this.store.updateAgent(agent.id, {
      soul: mutation.soul,
      soulHistory: mutation.soulHistory,
      soulVersion: mutation.soulVersion,
      soulUpdatedAt: mutation.soulUpdatedAt,
      updatedAt: mutation.soulUpdatedAt
    });
  }

  #getSoulHistoryWithBaseline(agent: any) {
    const history = normalizeSoulHistory(agent?.soulHistory);
    if (history.length > 0) {
      return history;
    }
    const baselineSoul =
      agent?.soul && typeof agent.soul === "object" ? normalizeSoul(agent.soul) : normalizeSoul({});
    return [
      {
        version: Number.isInteger(Number(agent?.soulVersion)) ? Number(agent.soulVersion) : 1,
        soul: baselineSoul,
        createdAt: agent?.soulUpdatedAt ?? agent?.updatedAt ?? nowIso(),
        source: "legacy",
        reason: "baseline_import",
        outcome: "",
        performanceScore: null,
        previousVersion: null
      }
    ];
  }

  #buildSoulMutation(existingAgent: any, nextSoul: any, meta: any = {}) {
    const now = nowIso();
    const history = this.#getSoulHistoryWithBaseline(existingAgent);
    const currentVersion = Number(history[history.length - 1]?.version ?? 0);
    const nextVersion = currentVersion + 1;
    const mutation = {
      version: nextVersion,
      soul: normalizeSoul({
        ...nextSoul,
        evolvedAt: now
      }),
      createdAt: now,
      source: String(meta.source ?? "system"),
      reason: String(meta.reason ?? "mutation"),
      outcome: String(meta.outcome ?? ""),
      performanceScore: Number.isFinite(Number(meta.performanceScore))
        ? Number(meta.performanceScore)
        : null,
      previousVersion: currentVersion || null
    };
    const mergedHistory = [...history, mutation];
    const trimmedHistory =
      mergedHistory.length > SOUL_HISTORY_LIMIT
        ? mergedHistory.slice(mergedHistory.length - SOUL_HISTORY_LIMIT)
        : mergedHistory;
    return {
      soul: mutation.soul,
      soulHistory: trimmedHistory,
      soulVersion: nextVersion,
      soulUpdatedAt: now
    };
  }

  #badRequest(message: string) {
    const error: any = new Error(message);
    error.statusCode = 400;
    return error;
  }

  #notFound(message: string) {
    const error: any = new Error(message);
    error.statusCode = 404;
    return error;
  }
}
