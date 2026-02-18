// @ts-nocheck

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface SovereignClientOptions {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

export class SovereignApiError extends Error {
  status: number;
  payload: any;
  constructor(message: string, status: number, payload: any) {
    super(message);
    this.name = "SovereignApiError";
    this.status = Number(status || 500);
    this.payload = payload;
  }
}

function normalizeBaseUrl(value: string | undefined) {
  const fallback = "http://localhost:3001";
  const normalized = String(value ?? fallback).trim();
  return normalized.replace(/\/+$/, "");
}

function isEmptyValue(value: any) {
  return value === undefined || value === null || value === "";
}

export class SovereignClient {
  baseUrl: string;
  apiKey: string | null;
  headers: Record<string, string>;
  fetchFn: typeof fetch;

  constructor(options: SovereignClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey ? String(options.apiKey) : null;
    this.headers = {
      ...(options.headers ?? {})
    };
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async request<T = any>(method: HttpMethod, path: string, input: any = {}) {
    const query = input?.query && typeof input.query === "object" ? input.query : null;
    const body = input?.body !== undefined ? input.body : undefined;
    const url = new URL(`${this.baseUrl}${path}`);

    if (query) {
      for (const [key, rawValue] of Object.entries(query)) {
        if (isEmptyValue(rawValue)) {
          continue;
        }
        if (Array.isArray(rawValue)) {
          for (const value of rawValue) {
            if (!isEmptyValue(value)) {
              url.searchParams.append(key, String(value));
            }
          }
          continue;
        }
        url.searchParams.set(key, String(rawValue));
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.headers
    };
    if (this.apiKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const init: RequestInit = {
      method,
      headers
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchFn(url.toString(), init);
    const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
    let payload: any = null;
    if (contentType.includes("application/json")) {
      payload = await response.json();
    } else {
      const text = await response.text();
      payload = text ? { text } : {};
    }

    if (!response.ok) {
      const message = payload?.error || payload?.message || `HTTP ${response.status}`;
      throw new SovereignApiError(message, response.status, payload);
    }
    return payload as T;
  }

  async getHealth() {
    return this.request("GET", "/health");
  }

  async getOpenApi() {
    return this.request("GET", "/api/openapi");
  }

  async getPersistenceStatus() {
    return this.request("GET", "/api/system/persistence");
  }

  async listLlmProviders() {
    return this.request("GET", "/api/llm/providers");
  }

  async listLlmModels() {
    return this.request("GET", "/api/llm/models");
  }

  async llmRespond(body: any) {
    return this.request("POST", "/api/llm/respond", { body });
  }

  async listAgents(query: any = {}) {
    return this.request("GET", "/api/agents", { query });
  }

  async createAgent(body: any) {
    return this.request("POST", "/api/agents", { body });
  }

  async getAgent(agentId: string) {
    return this.request("GET", `/api/agents/${encodeURIComponent(agentId)}`);
  }

  async updateAgent(agentId: string, body: any) {
    return this.request("PATCH", `/api/agents/${encodeURIComponent(agentId)}`, { body });
  }

  async listMissions(query: any = {}) {
    return this.request("GET", "/api/missions", { query });
  }

  async createMission(body: any) {
    return this.request("POST", "/api/missions", { body });
  }

  async getMission(missionId: string) {
    return this.request("GET", `/api/missions/${encodeURIComponent(missionId)}`);
  }

  async startMission(missionId: string) {
    return this.request("POST", `/api/missions/${encodeURIComponent(missionId)}/start`);
  }

  async createMissionTask(missionId: string, body: any) {
    return this.request("POST", `/api/missions/${encodeURIComponent(missionId)}/tasks`, { body });
  }

  async updateMissionTask(missionId: string, taskId: string, body: any) {
    return this.request(
      "PATCH",
      `/api/missions/${encodeURIComponent(missionId)}/tasks/${encodeURIComponent(taskId)}`,
      { body }
    );
  }

  async runCouncil(missionId: string, body: any) {
    return this.request("POST", `/api/missions/${encodeURIComponent(missionId)}/council/run`, { body });
  }

  async getArchitectureBlueprint(query: any = {}) {
    return this.request("GET", "/api/architecture/blueprint", { query });
  }

  async buildCompanyPlan(body: any) {
    return this.request("POST", "/api/architecture/company-plan", { body });
  }

  async evolveAgentSoul(body: any) {
    return this.request("POST", "/api/architecture/soul/evolve", { body });
  }

  async listSoulHistory(agentId: string, query: any = {}) {
    return this.request("GET", `/api/architecture/soul/${encodeURIComponent(agentId)}/history`, { query });
  }

  async rollbackSoul(agentId: string, body: any = {}) {
    return this.request("POST", `/api/architecture/soul/${encodeURIComponent(agentId)}/rollback`, { body });
  }

  async listCompanyRuns(query: any = {}) {
    return this.request("GET", "/api/company/runs", { query });
  }

  async getCompanyRun(runId: string) {
    return this.request("GET", `/api/company/runs/${encodeURIComponent(runId)}`);
  }

  async executeCompanyObjective(body: any) {
    return this.request("POST", "/api/company/execute", { body });
  }

  async resumeCompanyRun(runId: string, body: any) {
    return this.request("POST", `/api/company/runs/${encodeURIComponent(runId)}/resume`, { body });
  }

  async listAutopilotGoals(query: any = {}) {
    return this.request("GET", "/api/autopilot/goals", { query });
  }

  async createAutopilotGoal(body: any) {
    return this.request("POST", "/api/autopilot/goals", { body });
  }

  async getAutopilotGoal(goalId: string) {
    return this.request("GET", `/api/autopilot/goals/${encodeURIComponent(goalId)}`);
  }

  async runAutopilotGoal(goalId: string) {
    return this.request("POST", `/api/autopilot/goals/${encodeURIComponent(goalId)}/run`);
  }

  async pauseAutopilotGoal(goalId: string) {
    return this.request("POST", `/api/autopilot/goals/${encodeURIComponent(goalId)}/pause`);
  }

  async resumeAutopilotGoal(goalId: string) {
    return this.request("POST", `/api/autopilot/goals/${encodeURIComponent(goalId)}/resume`);
  }

  async cancelAutopilotGoal(goalId: string) {
    return this.request("POST", `/api/autopilot/goals/${encodeURIComponent(goalId)}/cancel`);
  }

  async listHeartbeatJobs(query: any = {}) {
    return this.request("GET", "/api/heartbeat/jobs", { query });
  }

  async createHeartbeatJob(body: any) {
    return this.request("POST", "/api/heartbeat/jobs", { body });
  }

  async runHeartbeatJob(jobId: string) {
    return this.request("POST", `/api/heartbeat/jobs/${encodeURIComponent(jobId)}/run`);
  }

  async pauseHeartbeatJob(jobId: string) {
    return this.request("POST", `/api/heartbeat/jobs/${encodeURIComponent(jobId)}/pause`);
  }

  async resumeHeartbeatJob(jobId: string) {
    return this.request("POST", `/api/heartbeat/jobs/${encodeURIComponent(jobId)}/resume`);
  }

  async listHeartbeatRuns(query: any = {}) {
    return this.request("GET", "/api/heartbeat/runs", { query });
  }

  async listOutbox(query: any = {}) {
    return this.request("GET", "/api/heartbeat/outbox", { query });
  }

  async processOutbox(body: any = {}) {
    return this.request("POST", "/api/heartbeat/outbox/process", { body });
  }

  async indexMemory(body: any) {
    return this.request("POST", "/api/memory/index", { body });
  }

  async searchMemory(body: any) {
    return this.request("POST", "/api/memory/search", { body });
  }

  async reindexMemory(body: any = {}) {
    return this.request("POST", "/api/memory/reindex", { body });
  }

  async listObservabilityEvents(query: any = {}) {
    return this.request("GET", "/api/observability/events", { query });
  }

  async getObservabilityMetrics(query: any = {}) {
    return this.request("GET", "/api/observability/metrics", { query });
  }

  async listObservabilityTraces(query: any = {}) {
    return this.request("GET", "/api/observability/traces", { query });
  }
}
