import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";
import { normalizeModelPolicy } from "../lib/model-policy.js";
import { AgentRole } from "../domain/constants.js";

function normalizeSkills(skills) {
  if (!Array.isArray(skills)) {
    return [];
  }
  return [...new Set(skills.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

function normalizeSoul(input) {
  const soul = input && typeof input === "object" ? input : {};
  return {
    mission: soul.mission ? String(soul.mission) : "",
    values: Array.isArray(soul.values)
      ? soul.values.map((item) => String(item).trim()).filter(Boolean)
      : [],
    communicationStyle: soul.communicationStyle ? String(soul.communicationStyle) : "direct",
    riskTolerance: soul.riskTolerance ? String(soul.riskTolerance) : "balanced"
  };
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
    const agent = {
      id: makeId("agent"),
      workspaceId: input.workspaceId ? String(input.workspaceId) : "default",
      name,
      role,
      title: input.title ? String(input.title) : "",
      skills: normalizeSkills(input.skills),
      soul: normalizeSoul(input.soul),
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
      patch.soul = {
        ...existing.soul,
        ...normalizeSoul(input.soul)
      };
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
