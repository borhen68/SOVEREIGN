// @ts-nocheck
export class SovereignApiError extends Error {
    status;
    payload;
    constructor(message, status, payload) {
        super(message);
        this.name = "SovereignApiError";
        this.status = Number(status || 500);
        this.payload = payload;
    }
}
function normalizeBaseUrl(value) {
    const fallback = "http://localhost:3001";
    const normalized = String(value ?? fallback).trim();
    return normalized.replace(/\/+$/, "");
}
function isEmptyValue(value) {
    return value === undefined || value === null || value === "";
}
export class SovereignClient {
    baseUrl;
    apiKey;
    headers;
    fetchFn;
    constructor(options = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.apiKey = options.apiKey ? String(options.apiKey) : null;
        this.headers = {
            ...(options.headers ?? {})
        };
        this.fetchFn = options.fetchFn ?? fetch;
    }
    async request(method, path, input = {}) {
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
        const headers = {
            Accept: "application/json",
            ...this.headers
        };
        if (this.apiKey && !headers.Authorization) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }
        const init = {
            method,
            headers
        };
        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(body);
        }
        const response = await this.fetchFn(url.toString(), init);
        const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
        let payload = null;
        if (contentType.includes("application/json")) {
            payload = await response.json();
        }
        else {
            const text = await response.text();
            payload = text ? { text } : {};
        }
        if (!response.ok) {
            const message = payload?.error || payload?.message || `HTTP ${response.status}`;
            throw new SovereignApiError(message, response.status, payload);
        }
        return payload;
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
    async llmRespond(body) {
        return this.request("POST", "/api/llm/respond", { body });
    }
    async listAgents(query = {}) {
        return this.request("GET", "/api/agents", { query });
    }
    async createAgent(body) {
        return this.request("POST", "/api/agents", { body });
    }
    async getAgent(agentId) {
        return this.request("GET", `/api/agents/${encodeURIComponent(agentId)}`);
    }
    async updateAgent(agentId, body) {
        return this.request("PATCH", `/api/agents/${encodeURIComponent(agentId)}`, { body });
    }
    async listMissions(query = {}) {
        return this.request("GET", "/api/missions", { query });
    }
    async createMission(body) {
        return this.request("POST", "/api/missions", { body });
    }
    async getMission(missionId) {
        return this.request("GET", `/api/missions/${encodeURIComponent(missionId)}`);
    }
    async startMission(missionId) {
        return this.request("POST", `/api/missions/${encodeURIComponent(missionId)}/start`);
    }
    async createMissionTask(missionId, body) {
        return this.request("POST", `/api/missions/${encodeURIComponent(missionId)}/tasks`, { body });
    }
    async updateMissionTask(missionId, taskId, body) {
        return this.request("PATCH", `/api/missions/${encodeURIComponent(missionId)}/tasks/${encodeURIComponent(taskId)}`, { body });
    }
    async runCouncil(missionId, body) {
        return this.request("POST", `/api/missions/${encodeURIComponent(missionId)}/council/run`, { body });
    }
    async getArchitectureBlueprint(query = {}) {
        return this.request("GET", "/api/architecture/blueprint", { query });
    }
    async buildCompanyPlan(body) {
        return this.request("POST", "/api/architecture/company-plan", { body });
    }
    async evolveAgentSoul(body) {
        return this.request("POST", "/api/architecture/soul/evolve", { body });
    }
    async listSoulHistory(agentId, query = {}) {
        return this.request("GET", `/api/architecture/soul/${encodeURIComponent(agentId)}/history`, { query });
    }
    async rollbackSoul(agentId, body = {}) {
        return this.request("POST", `/api/architecture/soul/${encodeURIComponent(agentId)}/rollback`, { body });
    }
    async listCompanyRuns(query = {}) {
        return this.request("GET", "/api/company/runs", { query });
    }
    async getCompanyRun(runId) {
        return this.request("GET", `/api/company/runs/${encodeURIComponent(runId)}`);
    }
    async executeCompanyObjective(body) {
        return this.request("POST", "/api/company/execute", { body });
    }
    async resumeCompanyRun(runId, body) {
        return this.request("POST", `/api/company/runs/${encodeURIComponent(runId)}/resume`, { body });
    }
    async listAutopilotGoals(query = {}) {
        return this.request("GET", "/api/autopilot/goals", { query });
    }
    async createAutopilotGoal(body) {
        return this.request("POST", "/api/autopilot/goals", { body });
    }
    async getAutopilotGoal(goalId) {
        return this.request("GET", `/api/autopilot/goals/${encodeURIComponent(goalId)}`);
    }
    async runAutopilotGoal(goalId) {
        return this.request("POST", `/api/autopilot/goals/${encodeURIComponent(goalId)}/run`);
    }
    async pauseAutopilotGoal(goalId) {
        return this.request("POST", `/api/autopilot/goals/${encodeURIComponent(goalId)}/pause`);
    }
    async resumeAutopilotGoal(goalId) {
        return this.request("POST", `/api/autopilot/goals/${encodeURIComponent(goalId)}/resume`);
    }
    async cancelAutopilotGoal(goalId) {
        return this.request("POST", `/api/autopilot/goals/${encodeURIComponent(goalId)}/cancel`);
    }
    async listHeartbeatJobs(query = {}) {
        return this.request("GET", "/api/heartbeat/jobs", { query });
    }
    async createHeartbeatJob(body) {
        return this.request("POST", "/api/heartbeat/jobs", { body });
    }
    async runHeartbeatJob(jobId) {
        return this.request("POST", `/api/heartbeat/jobs/${encodeURIComponent(jobId)}/run`);
    }
    async pauseHeartbeatJob(jobId) {
        return this.request("POST", `/api/heartbeat/jobs/${encodeURIComponent(jobId)}/pause`);
    }
    async resumeHeartbeatJob(jobId) {
        return this.request("POST", `/api/heartbeat/jobs/${encodeURIComponent(jobId)}/resume`);
    }
    async listHeartbeatRuns(query = {}) {
        return this.request("GET", "/api/heartbeat/runs", { query });
    }
    async listOutbox(query = {}) {
        return this.request("GET", "/api/heartbeat/outbox", { query });
    }
    async processOutbox(body = {}) {
        return this.request("POST", "/api/heartbeat/outbox/process", { body });
    }
    async indexMemory(body) {
        return this.request("POST", "/api/memory/index", { body });
    }
    async searchMemory(body) {
        return this.request("POST", "/api/memory/search", { body });
    }
    async reindexMemory(body = {}) {
        return this.request("POST", "/api/memory/reindex", { body });
    }
    async listObservabilityEvents(query = {}) {
        return this.request("GET", "/api/observability/events", { query });
    }
    async getObservabilityMetrics(query = {}) {
        return this.request("GET", "/api/observability/metrics", { query });
    }
    async listObservabilityTraces(query = {}) {
        return this.request("GET", "/api/observability/traces", { query });
    }
}
//# sourceMappingURL=index.js.map