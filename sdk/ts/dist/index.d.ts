export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export interface SovereignClientOptions {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    fetchFn?: typeof fetch;
}
export declare class SovereignApiError extends Error {
    status: number;
    payload: any;
    constructor(message: string, status: number, payload: any);
}
export declare class SovereignClient {
    baseUrl: string;
    apiKey: string | null;
    headers: Record<string, string>;
    fetchFn: typeof fetch;
    constructor(options?: SovereignClientOptions);
    request<T = any>(method: HttpMethod, path: string, input?: any): Promise<T>;
    getHealth(): Promise<any>;
    getOpenApi(): Promise<any>;
    getPersistenceStatus(): Promise<any>;
    listLlmProviders(): Promise<any>;
    listLlmModels(): Promise<any>;
    llmRespond(body: any): Promise<any>;
    listAgents(query?: any): Promise<any>;
    createAgent(body: any): Promise<any>;
    getAgent(agentId: string): Promise<any>;
    updateAgent(agentId: string, body: any): Promise<any>;
    listMissions(query?: any): Promise<any>;
    createMission(body: any): Promise<any>;
    getMission(missionId: string): Promise<any>;
    startMission(missionId: string): Promise<any>;
    createMissionTask(missionId: string, body: any): Promise<any>;
    updateMissionTask(missionId: string, taskId: string, body: any): Promise<any>;
    runCouncil(missionId: string, body: any): Promise<any>;
    getArchitectureBlueprint(query?: any): Promise<any>;
    buildCompanyPlan(body: any): Promise<any>;
    evolveAgentSoul(body: any): Promise<any>;
    listSoulHistory(agentId: string, query?: any): Promise<any>;
    rollbackSoul(agentId: string, body?: any): Promise<any>;
    listCompanyRuns(query?: any): Promise<any>;
    getCompanyRun(runId: string): Promise<any>;
    executeCompanyObjective(body: any): Promise<any>;
    resumeCompanyRun(runId: string, body: any): Promise<any>;
    listAutopilotGoals(query?: any): Promise<any>;
    createAutopilotGoal(body: any): Promise<any>;
    getAutopilotGoal(goalId: string): Promise<any>;
    runAutopilotGoal(goalId: string): Promise<any>;
    pauseAutopilotGoal(goalId: string): Promise<any>;
    resumeAutopilotGoal(goalId: string): Promise<any>;
    cancelAutopilotGoal(goalId: string): Promise<any>;
    listHeartbeatJobs(query?: any): Promise<any>;
    createHeartbeatJob(body: any): Promise<any>;
    runHeartbeatJob(jobId: string): Promise<any>;
    pauseHeartbeatJob(jobId: string): Promise<any>;
    resumeHeartbeatJob(jobId: string): Promise<any>;
    listHeartbeatRuns(query?: any): Promise<any>;
    listOutbox(query?: any): Promise<any>;
    processOutbox(body?: any): Promise<any>;
    indexMemory(body: any): Promise<any>;
    searchMemory(body: any): Promise<any>;
    reindexMemory(body?: any): Promise<any>;
    listObservabilityEvents(query?: any): Promise<any>;
    getObservabilityMetrics(query?: any): Promise<any>;
    listObservabilityTraces(query?: any): Promise<any>;
}
