import { prisma } from "../infra/db.js";
import { nowIso } from "../lib/time.js";

// Helper to ensure dates are Date objects
function toDate(d: string | Date | null | undefined): Date | null {
    if (!d) return null;
    return new Date(d);
}

// Helper to ensure dates are ISO strings for the app's internal logic
function toIso(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    return new Date(d).toISOString();
}

function safeJsonParse(value: unknown): any {
    if (typeof value !== "string") {
        return null;
    }
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function parseSessionKey(sessionKey: string | null | undefined) {
    const raw = String(sessionKey ?? "");
    const [channelId = "", workspaceId = "default", chatId = "unknown-chat", userId = "unknown-user"] =
        raw.split(":");
    return {
        channelId,
        workspaceId,
        chatId,
        userId
    };
}

function encodeAuthMeta(meta: Record<string, any>) {
    const payload = Buffer.from(JSON.stringify(meta), "utf8").toString("base64url");
    return `__meta:${payload}`;
}

function decodeAuthMeta(scopes: unknown) {
    const list = Array.isArray(scopes) ? scopes.map((item) => String(item)) : [];
    const marker = list.find((item) => item.startsWith("__meta:"));
    if (!marker) {
        return {
            channelId: null,
            status: "active",
            revokedAt: null,
            scopes: list
        };
    }
    const encoded = marker.slice("__meta:".length);
    try {
        const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        return {
            channelId: decoded?.channelId ? String(decoded.channelId) : null,
            status: decoded?.status ? String(decoded.status) : "active",
            revokedAt: decoded?.revokedAt ? String(decoded.revokedAt) : null,
            scopes: list.filter((item) => item !== marker)
        };
    } catch {
        return {
            channelId: null,
            status: "active",
            revokedAt: null,
            scopes: list.filter((item) => item !== marker)
        };
    }
}

/**
 * PrismaDataStore
 * 
 * Implementation of the DataStore interface using Prisma (PostgreSQL).
 * All methods are async.
 */
export class PrismaDataStore {
    mode = "postgres";

    constructor() {
        // No-op
    }

    async waitUntilReady() {
        return Promise.resolve();
    }

    async shutdown() {
        await prisma.$disconnect();
    }

    getPersistenceStatus() {
        return {
            mode: "postgres",
            ready: true
        };
    }

    // --- Missions ---

    async listMissions() {
        const missions = await prisma.mission.findMany({
            orderBy: { updatedAt: "desc" }
        });
        return missions.map(this.mapMission);
    }

    async getMissionById(missionId: string) {
        const mission = await prisma.mission.findUnique({
            where: { id: missionId }
        });
        return mission ? this.mapMission(mission) : null;
    }

    async createMission(mission: any) {
        await prisma.mission.create({
            data: {
                id: mission.id,
                title: mission.title,
                goal: mission.objective, // Map objective -> goal
                status: mission.status,
                result: mission.result ?? undefined,
                context: {
                    workspaceId: mission.workspaceId,
                    title: mission.title,
                    kpi: mission.kpi,
                    budgetCap: mission.budgetCap,
                    deadline: mission.deadline,
                    policyPreset: mission.policyPreset
                },
                createdAt: toDate(mission.createdAt) || new Date(),
                updatedAt: toDate(mission.updatedAt) || new Date()
            }
        });
        return mission;
    }

    async updateMission(missionId: string, partial: any) {
        const current = await this.getMissionById(missionId);
        if (!current) return null;

        const data: any = { updatedAt: new Date() };
        if (partial.status) data.status = partial.status;
        if (partial.title) data.title = partial.title;
        if (partial.objective) data.goal = partial.objective;
        if (partial.result) data.result = partial.result;

        const contextFields = ["workspaceId", "kpi", "budgetCap", "deadline", "policyPreset"];
        const needsContextUpdate = contextFields.some(f => partial[f] !== undefined);

        if (needsContextUpdate) {
            data.context = {
                workspaceId: partial.workspaceId ?? current.workspaceId,
                kpi: partial.kpi ?? current.kpi,
                budgetCap: partial.budgetCap ?? current.budgetCap,
                deadline: partial.deadline ?? current.deadline,
                policyPreset: partial.policyPreset ?? current.policyPreset
            };
        }

        const updated = await prisma.mission.update({
            where: { id: missionId },
            data
        });
        return this.mapMission(updated);
    }

    // --- Tasks ---

    async listMissionTasks(missionId: string) {
        const tasks = await prisma.task.findMany({
            where: { missionId },
            orderBy: { createdAt: "asc" }
        });
        return tasks.map(this.mapTask);
    }

    async createTask(task: any) {
        await prisma.task.create({
            data: {
                id: task.id,
                missionId: task.missionId,
                description: task.title,
                status: task.status,
                dependencies: task.dependencies ?? [],
                result: {
                    owner: task.owner,
                    dueDate: task.dueDate
                },
                createdAt: toDate(task.createdAt) || new Date(),
                updatedAt: toDate(task.updatedAt) || new Date()
            }
        });
        return task;
    }

    async updateTask(taskId: string, partial: any) {
        const data: any = { updatedAt: new Date() };
        if (partial.status) data.status = partial.status;
        if (partial.title) data.description = partial.title;
        if (partial.dependencies) data.dependencies = partial.dependencies;

        if (partial.owner !== undefined || partial.dueDate !== undefined) {
            const current = await prisma.task.findUnique({ where: { id: taskId } });
            if (current) {
                const currentResult = (current.result as any) || {};
                data.result = {
                    ...currentResult,
                    owner: partial.owner ?? currentResult.owner,
                    dueDate: partial.dueDate ?? currentResult.dueDate
                };
            }
        }

        const updated = await prisma.task.update({
            where: { id: taskId },
            data
        });
        return this.mapTask(updated);
    }

    // --- Actions ---

    async listMissionActions(missionId: string) {
        const actions = await prisma.action.findMany({
            where: { missionId },
            orderBy: { createdAt: "asc" }
        });
        return actions.map(this.mapAction);
    }

    async getActionById(actionId: string) {
        const action = await prisma.action.findUnique({
            where: { id: actionId }
        });
        return action ? this.mapAction(action) : null;
    }

    async getMissionActionByIdempotencyKey(missionId: string, idempotencyKey: string) {
        const actions = await prisma.action.findMany({
            where: {
                missionId,
                toolInput: {
                    path: ['idempotencyKey'],
                    equals: idempotencyKey
                }
            }
        });
        return actions.length > 0 ? this.mapAction(actions[0]) : null;
    }

    async createAction(action: any) {
        await prisma.action.create({
            data: {
                id: action.id,
                missionId: action.missionId,
                type: action.actionType,
                description: action.summary,
                toolName: action.toolName ?? "unknown",
                toolInput: {
                    ...action.payload,
                    idempotencyKey: action.idempotencyKey,
                    idempotencySignature: action.idempotencySignature,
                    state: action.state,
                    riskScore: action.riskScore,
                    approvalLevel: action.approvalLevel,
                    approvalReason: action.approvalReason
                },
                createdAt: toDate(action.createdAt) || new Date()
            }
        });
        return action;
    }

    async updateAction(actionId: string, partial: any) {
        const current = await this.getActionById(actionId);
        if (!current) return null;

        const newData = {
            ...(current as any).metadata,
            ...partial
        };

        await prisma.action.update({
            where: { id: actionId },
            data: { toolInput: newData }
        });

        return { ...current, ...partial };
    }

    // --- Approvals ---

    async createApproval(approval: any) {
        await prisma.approval.create({
            data: {
                id: approval.id,
                missionId: approval.missionId,
                actionId: approval.actionId,
                status: approval.status,
                decisionReason: approval.reason,
                createdAt: toDate(approval.requestedAt) || new Date(),
                updatedAt: toDate(approval.requestedAt) || new Date()
            }
        });
        return approval;
    }

    async getApprovalById(approvalId: string) {
        const approval = await prisma.approval.findUnique({
            where: { id: approvalId }
        });
        return approval ? this.mapApproval(approval) : null;
    }

    async getApprovalByActionId(actionId: string) {
        const approval = await prisma.approval.findUnique({
            where: { actionId }
        });
        return approval ? this.mapApproval(approval) : null;
    }

    async updateApproval(approvalId: string, partial: any) {
        const data: any = { updatedAt: new Date() };
        if (partial.status) data.status = partial.status;
        if (partial.decidedAt) data.decisionTime = toDate(partial.decidedAt);
        if (partial.decisionNote) data.decisionReason = partial.decisionNote;

        const updated = await prisma.approval.update({
            where: { id: approvalId },
            data
        });
        return this.mapApproval(updated);
    }

    async listMissionApprovals(missionId: string) {
        const approvals = await prisma.approval.findMany({
            where: { missionId },
            orderBy: { createdAt: "asc" }
        });
        return approvals.map(this.mapApproval);
    }

    // --- Evidence ---

    async createEvidence(evidence: any) {
        await prisma.evidence.create({
            data: {
                id: evidence.id,
                missionId: evidence.missionId,
                type: evidence.type,
                content: {
                    text: evidence.content,
                    actionId: evidence.actionId
                },
                source: evidence.source ?? "system",
                createdAt: toDate(evidence.createdAt) || new Date()
            }
        });
        return evidence;
    }

    async listMissionEvidence(missionId: string) {
        const items = await prisma.evidence.findMany({
            where: { missionId },
            orderBy: { createdAt: "asc" }
        });
        return items.map(this.mapEvidence);
    }

    // --- Events ---

    async createEvent(event: any) {
        await prisma.event.create({
            data: {
                id: event.id,
                missionId: event.missionId,
                type: event.type,
                source: event.actor,
                payload: event.payload,
                createdAt: toDate(event.createdAt) || new Date()
            }
        });
        return event;
    }

    async listMissionEvents(missionId: string) {
        const events = await prisma.event.findMany({
            where: { missionId },
            orderBy: { createdAt: "asc" }
        });
        return events.map(this.mapEvent);
    }

    // --- Agents ---

    async listAgents(workspaceId: string | null = null) {
        const where: any = {};
        if (workspaceId) where.workspaceId = workspaceId;

        const agents = await prisma.agent.findMany({
            where,
            include: { skills: true },
            orderBy: { createdAt: "desc" }
        });
        return agents.map(this.mapAgent);
    }

    async getAgentById(agentId: string) {
        const agent = await prisma.agent.findUnique({
            where: { id: agentId },
            include: { skills: true }
        });
        return agent ? this.mapAgent(agent) : null;
    }

    async createAgent(agent: any) {
        await prisma.agent.create({
            data: {
                id: agent.id,
                role: agent.role,
                name: agent.name,
                description: agent.description || agent.title,
                workspaceId: agent.workspaceId,
                createdAt: toDate(agent.createdAt) || new Date(),
                updatedAt: toDate(agent.updatedAt) || new Date()
            }
        });
        return agent;
    }

    async updateAgent(agentId: string, partial: any) {
        const data: any = { updatedAt: new Date() };
        if (partial.name) data.name = partial.name;
        if (partial.role) data.role = partial.role;
        if (partial.title) data.description = partial.title;

        const updated = await prisma.agent.update({
            where: { id: agentId },
            data,
            include: { skills: true }
        });
        return this.mapAgent(updated);
    }

    // --- Skills ---

    async listAgentSkills(agentId: string) {
        const skills = await prisma.skill.findMany({
            where: { agentId },
            orderBy: { createdAt: "desc" }
        });
        return skills.map(this.mapSkill);
    }

    async createSkill(skill: any) {
        await prisma.skill.create({
            data: {
                id: skill.id,
                agentId: skill.agentId,
                name: skill.name,
                description: skill.description,
                code: skill.code,
                memory: {
                    tags: skill.tags,
                    confidence: skill.confidence
                },
                createdAt: toDate(skill.createdAt) || new Date(),
                updatedAt: toDate(skill.updatedAt) || new Date()
            }
        });
        return skill;
    }

    // --- Council ---

    async createCouncilSession(session: any) {
        await prisma.councilSession.create({
            data: {
                id: session.id,
                missionId: session.missionId,
                workspaceId: session.workspaceId,
                runId: session.runId,
                status: session.status,
                problem: session.problem,
                mainAgentId: session.mainAgentId,
                subAgentIds: session.subAgentIds,
                spawnedSubAgentIds: session.spawnedSubAgentIds,
                allowWebResearch: session.allowWebResearch,
                teamAssembly: session.teamAssembly,
                debateRounds: session.debateRounds,
                autoSpawnSubAgents: session.autoSpawnSubAgents,
                autoGenerateSkills: session.autoGenerateSkills,
                idempotencyKey: session.idempotencyKey,
                decomposition: session.decomposition || [],
                contributions: session.contributions || [],
                discussion: session.discussion || [],
                consensus: session.consensus || {},
                finalBriefing: session.finalBriefing || {},
                createdAt: toDate(session.createdAt) || new Date(),
                updatedAt: toDate(session.updatedAt) || new Date()
            }
        });
        return session;
    }

    async getCouncilSessionById(councilId: string) {
        const session = await prisma.councilSession.findUnique({
            where: { id: councilId }
        });
        return session ? this.mapCouncilSession(session) : null;
    }

    async listMissionCouncilSessions(missionId: string) {
        const sessions = await prisma.councilSession.findMany({
            where: { missionId },
            orderBy: { createdAt: "desc" }
        });
        return sessions.map(this.mapCouncilSession);
    }

    async createCouncilRun(run: any) {
        await prisma.councilRun.create({
            data: {
                id: run.id,
                missionId: run.missionId,
                workspaceId: run.workspaceId,
                problem: run.problem,
                mainAgentId: run.mainAgentId,
                subAgentIds: run.subAgentIds,
                spawnedSubAgentIds: run.spawnedSubAgentIds,
                teamAssembly: run.teamAssembly,
                debateRounds: run.debateRounds,
                autoSpawnSubAgents: run.autoSpawnSubAgents,
                autoGenerateSkills: run.autoGenerateSkills,
                idempotencyKey: run.idempotencyKey,
                idempotencySignature: run.idempotencySignature,
                status: run.status,
                createdAt: toDate(run.createdAt) || new Date(),
                startedAt: toDate(run.startedAt) || new Date(),
                endedAt: toDate(run.endedAt),
                councilId: run.councilId,
                error: run.error
            }
        });
        return run;
    }

    async updateCouncilRun(runId: string, partial: any) {
        const data: any = {}; // No automatic updatedAt for runs? Schema has implicit? No.
        if (partial.status) data.status = partial.status;
        if (partial.endedAt) data.endedAt = toDate(partial.endedAt);
        if (partial.councilId) data.councilId = partial.councilId;
        if (partial.error) data.error = partial.error;

        const updated = await prisma.councilRun.update({
            where: { id: runId },
            data
        });
        return this.mapCouncilRun(updated);
    }

    async getCouncilRunById(runId: string) {
        const run = await prisma.councilRun.findUnique({ where: { id: runId } });
        return run ? this.mapCouncilRun(run) : null;
    }

    async getMissionCouncilRunByIdempotencyKey(missionId: string, key: string) {
        const run = await prisma.councilRun.findFirst({
            where: {
                missionId,
                idempotencyKey: key
            }
        });
        return run ? this.mapCouncilRun(run) : null;
    }

    async listMissionCouncilRuns(missionId: string) {
        const runs = await prisma.councilRun.findMany({
            where: { missionId },
            orderBy: { createdAt: "desc" }
        });
        return runs.map(this.mapCouncilRun);
    }

    // --- Autopilot ---

    async listAutopilotGoals(filters: any = {}) {
        const goals = await prisma.autopilotGoal.findMany({
            take: 100
        });
        return goals.map(g => ({
            id: g.id,
            objective: g.objective,
            status: g.status,
            createdAt: toIso(g.createdAt)
        }));
    }

    async getAutopilotGoalById(id: string) {
        const g = await prisma.autopilotGoal.findUnique({ where: { id } });
        return g ? {
            id: g.id,
            objective: g.objective,
            status: g.status,
            createdAt: toIso(g.createdAt)
        } : null;
    }

    async createAutopilotGoal(goal: any) {
        await prisma.autopilotGoal.create({
            data: {
                id: goal.id,
                objective: goal.objective,
                status: goal.status,
                workspaceId: goal.workspaceId,
                createdAt: toDate(goal.createdAt) || new Date(),
                updatedAt: toDate(goal.updatedAt) || new Date()
            }
        });
        return goal;
    }

    async updateAutopilotGoal(id: string, partial: any) {
        await prisma.autopilotGoal.update({
            where: { id },
            data: {
                status: partial.status,
                updatedAt: new Date()
            }
        });
        return { id, ...partial };
    }

    async listAutopilotLogs(goalId: string, limit = 200) {
        const logs = await prisma.autopilotLog.findMany({
            where: { goalId },
            orderBy: { createdAt: 'desc' },
            take: limit
        });
        return logs.map(l => ({
            id: l.id,
            goalId: l.goalId,
            message: l.message,
            level: l.level,
            createdAt: toIso(l.createdAt)
        }));
    }

    async createAutopilotLog(log: any) {
        await prisma.autopilotLog.create({
            data: {
                id: log.id,
                goalId: log.goalId,
                message: log.message,
                level: log.level,
                createdAt: toDate(log.createdAt) || new Date()
            }
        });
        return log;
    }

    // --- Channels ---
    async listChannelSessions(workspaceId: string | null = null) {
        const where: any = {};
        if (workspaceId) where.workspaceId = workspaceId;
        const sessions = await prisma.channelSession.findMany({
            where,
            orderBy: { createdAt: "desc" }
        });
        return sessions.map((session) => this.mapChannelSession(session));
    }

    async getChannelSessionById(sessionId: string) {
        const session = await prisma.channelSession.findUnique({
            where: { id: sessionId }
        });
        return session ? this.mapChannelSession(session) : null;
    }

    async getChannelSessionByKey(sessionKey: string) {
        const session = await prisma.channelSession.findUnique({
            where: { sessionKey }
        });
        return session ? this.mapChannelSession(session) : null;
    }

    async createChannelSession(session: any) {
        const created = await prisma.channelSession.create({
            data: {
                id: session.id,
                workspaceId: session.workspaceId,
                channelId: session.channelId,
                sessionKey: session.sessionKey,
                createdAt: toDate(session.createdAt) || new Date(),
                updatedAt: toDate(session.updatedAt) || new Date()
            }
        });
        return {
            ...this.mapChannelSession(created),
            metadata: session.metadata ?? {},
            lastInboundAt: session.lastInboundAt ?? null,
            lastOutboundAt: session.lastOutboundAt ?? null
        };
    }

    async updateChannelSession(sessionId: string, partial: any) {
        const existing = await prisma.channelSession.findUnique({ where: { id: sessionId } });
        if (!existing) {
            return null;
        }
        const data: any = { updatedAt: toDate(partial.updatedAt) || new Date() };
        if (partial.channelId) data.channelId = partial.channelId;
        if (partial.workspaceId) data.workspaceId = partial.workspaceId;
        if (partial.sessionKey) data.sessionKey = partial.sessionKey;
        const updated = await prisma.channelSession.update({
            where: { id: sessionId },
            data
        });
        return {
            ...this.mapChannelSession(updated),
            metadata: partial.metadata ?? {},
            lastInboundAt: partial.lastInboundAt ?? null,
            lastOutboundAt: partial.lastOutboundAt ?? null
        };
    }

    async listChannelSessionMessages(sessionId: string, limit = 100) {
        const safeLimit = Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : 100);
        const messages = await prisma.channelMessage.findMany({
            where: { sessionId },
            orderBy: { createdAt: "desc" },
            take: safeLimit
        });
        return messages.reverse().map((message) => this.mapChannelMessage(message));
    }

    async createChannelMessage(message: any) {
        const metadata = {
            direction: message.direction,
            authorId: message.authorId,
            authorRole: message.authorRole,
            ...(message.metadata && typeof message.metadata === "object" ? message.metadata : {})
        };
        const created = await prisma.channelMessage.create({
            data: {
                id: message.id,
                sessionId: message.sessionId,
                role: message.authorRole ?? (message.direction === "inbound" ? "user" : "assistant"),
                content: message.text,
                metadata,
                createdAt: toDate(message.createdAt) || new Date()
            }
        });
        return this.mapChannelMessage(created);
    }

    // --- Runtime trust ---
    async listRuntimeActions(filters: any = {}) {
        const where: any = {};
        if (filters.workspaceId) where.workspaceId = filters.workspaceId;
        if (filters.missionId) where.missionId = filters.missionId;
        if (filters.decision) where.decision = filters.decision;
        const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 100);
        const actions = await prisma.runtimeAction.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: safeLimit
        });
        const mapped = actions.map((action) => this.mapRuntimeAction(action));
        return mapped.filter((action) => {
            if (filters.status && action.status !== filters.status) return false;
            if (filters.actionType && action.actionType !== filters.actionType) return false;
            return true;
        });
    }

    async getRuntimeActionById(actionId: string) {
        const action = await prisma.runtimeAction.findUnique({ where: { id: actionId } });
        return action ? this.mapRuntimeAction(action) : null;
    }

    async createRuntimeAction(action: any) {
        const created = await prisma.runtimeAction.create({
            data: {
                id: action.id,
                missionId: action.missionId,
                workspaceId: action.workspaceId,
                tool: action.toolName ?? action.pluginId ?? action.tool ?? "unknown",
                input: action,
                riskScore: Number.isFinite(Number(action.riskScore)) ? Number(action.riskScore) : null,
                decision: action.decision ?? "allowed",
                createdAt: toDate(action.createdAt) || new Date()
            }
        });
        return this.mapRuntimeAction(created);
    }

    async updateRuntimeAction(actionId: string, partial: any) {
        const existing = await prisma.runtimeAction.findUnique({ where: { id: actionId } });
        if (!existing) return null;
        const currentInput = (existing.input as any) || {};
        const nextInput = {
            ...currentInput,
            ...partial
        };
        const updated = await prisma.runtimeAction.update({
            where: { id: actionId },
            data: {
                decision: partial.decision ?? existing.decision,
                riskScore:
                    partial.riskScore !== undefined
                        ? Number.isFinite(Number(partial.riskScore))
                            ? Number(partial.riskScore)
                            : null
                        : existing.riskScore,
                input: nextInput
            }
        });
        return this.mapRuntimeAction(updated);
    }

    // --- Security ---
    async createSecurityPairing(pairing: any) {
        const created = await prisma.securityPairing.create({
            data: {
                id: pairing.id,
                workspaceId: pairing.workspaceId,
                channelId: pairing.channelId,
                secretKey: JSON.stringify({
                    otpDigest: pairing.otpDigest,
                    tokenDigest: pairing.tokenDigest,
                    attempts: pairing.attempts ?? 0,
                    status: pairing.status ?? "pending",
                    expiresAt: pairing.expiresAt ?? null,
                    pairedAt: pairing.pairedAt ?? null,
                    updatedAt: pairing.updatedAt ?? pairing.createdAt ?? nowIso()
                }),
                createdAt: toDate(pairing.createdAt) || new Date()
            }
        });
        return this.mapSecurityPairing(created);
    }

    async updateSecurityPairing(pairingId: string, partial: any) {
        const existing = await prisma.securityPairing.findUnique({ where: { id: pairingId } });
        if (!existing) return null;
        const existingSecret = safeJsonParse(existing.secretKey) || {};
        const nextSecret = {
            ...existingSecret,
            ...partial
        };
        const updated = await prisma.securityPairing.update({
            where: { id: pairingId },
            data: {
                channelId: partial.channelId ?? existing.channelId,
                workspaceId: partial.workspaceId ?? existing.workspaceId,
                secretKey: JSON.stringify(nextSecret)
            }
        });
        return this.mapSecurityPairing(updated);
    }

    async getSecurityPairingById(pairingId: string) {
        const pairing = await prisma.securityPairing.findUnique({
            where: { id: pairingId }
        });
        return pairing ? this.mapSecurityPairing(pairing) : null;
    }

    async listSecurityPairings(filters: any = {}) {
        const where: any = {};
        if (filters.workspaceId) where.workspaceId = filters.workspaceId;
        if (filters.channelId) where.channelId = filters.channelId;
        const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 100);
        const pairings = await prisma.securityPairing.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: safeLimit
        });
        return pairings.map((pairing) => this.mapSecurityPairing(pairing));
    }

    async createSecurityAuthToken(token: any) {
        const metadata = encodeAuthMeta({
            channelId: token.channelId ?? null,
            status: token.status ?? "active",
            revokedAt: token.revokedAt ?? null
        });
        await prisma.authToken.create({
            data: {
                id: token.id,
                token: token.tokenDigest,
                workspaceId: token.workspaceId,
                scopes: [...(Array.isArray(token.scopes) ? token.scopes : []), metadata],
                expiresAt: toDate(token.expiresAt),
                createdAt: toDate(token.createdAt) || new Date()
            }
        });
        return token;
    }

    async listSecurityAuthTokens(filters: any = {}) {
        const where: any = {};
        if (filters.workspaceId) where.workspaceId = filters.workspaceId;
        const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 200);
        const tokens = await prisma.authToken.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: safeLimit
        });
        return tokens
            .map((token) => this.mapSecurityAuthToken(token))
            .filter((entry) => !filters.channelId || entry.channelId === filters.channelId);
    }

    async updateSecurityAuthToken(tokenId: string, partial: any) {
        const existing = await prisma.authToken.findUnique({ where: { id: tokenId } });
        if (!existing) return null;
        const decoded = decodeAuthMeta(existing.scopes);
        const nextMeta = {
            channelId: partial.channelId ?? decoded.channelId,
            status: partial.status ?? decoded.status,
            revokedAt: partial.revokedAt ?? decoded.revokedAt
        };
        const nextScopes = [
            ...(Array.isArray(partial.scopes) ? partial.scopes : decoded.scopes),
            encodeAuthMeta(nextMeta)
        ];
        const updated = await prisma.authToken.update({
            where: { id: tokenId },
            data: {
                token: partial.tokenDigest ?? existing.token,
                workspaceId: partial.workspaceId ?? existing.workspaceId,
                scopes: nextScopes,
                expiresAt: partial.expiresAt !== undefined ? toDate(partial.expiresAt) : existing.expiresAt
            }
        });
        return this.mapSecurityAuthToken(updated);
    }

    async createSecurityRateEvent(event: any) {
        await prisma.observabilityEvent.create({
            data: {
                id: event.id,
                workspaceId: event.workspaceId,
                type: "security.rate.event",
                source: "security-fabric",
                payload: event,
                traceId: null,
                createdAt: toDate(event.createdAt) || new Date()
            }
        });
        return event;
    }

    async listSecurityRateEvents(filters: any = {}) {
        const where: any = {
            source: "security-fabric",
            type: "security.rate.event"
        };
        if (filters.workspaceId) where.workspaceId = filters.workspaceId;
        const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 500);
        const events = await prisma.observabilityEvent.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: safeLimit
        });
        return events
            .map((event) => ({
                ...((event.payload as any) || {}),
                id: event.id,
                workspaceId: event.workspaceId ?? ((event.payload as any)?.workspaceId ?? null),
                createdAt: toIso(event.createdAt)
            }))
            .filter((event) => !filters.channelId || event.channelId === filters.channelId);
    }

    // --- Tunnel ---

    async createTunnelProfile(profile: any) {
        await prisma.tunnelProfile.create({
            data: {
                id: profile.id,
                workspaceId: profile.workspaceId,
                provider: profile.provider,
                url: profile.url,
                active: profile.active ?? false,
                createdAt: toDate(profile.createdAt) || new Date(),
                updatedAt: toDate(profile.updatedAt) || new Date()
            }
        });
        return profile;
    }

    async updateTunnelProfile(profileId: string, partial: any) {
        const data: any = { updatedAt: new Date() };
        if (partial.url) data.url = partial.url;
        if (partial.active !== undefined) data.active = partial.active;
        if (partial.provider) data.provider = partial.provider;

        const updated = await prisma.tunnelProfile.update({
            where: { id: profileId },
            data
        });
        return this.mapTunnelProfile(updated);
    }

    async getTunnelProfileById(profileId: string) {
        const profile = await prisma.tunnelProfile.findUnique({
            where: { id: profileId }
        });
        return profile ? this.mapTunnelProfile(profile) : null;
    }

    async listTunnelProfiles(workspaceId: string | null = null) {
        const where: any = {};
        if (workspaceId) where.workspaceId = workspaceId;
        const profiles = await prisma.tunnelProfile.findMany({ where });
        return profiles.map(this.mapTunnelProfile);
    }

    // --- Memory ---
    async createMemoryDocument(document: any) {
        await prisma.memoryDocument.create({
            data: {
                id: document.id,
                workspaceId: document.workspaceId,
                content: document.content,
                embedding: document.embedding ?? null,
                metadata: {
                    sourceId: document.sourceId ?? null,
                    title: document.title ?? null,
                    tags: Array.isArray(document.tags) ? document.tags : [],
                    keywords: Array.isArray(document.keywords) ? document.keywords : [],
                    tokens: document.tokens ?? null,
                    createdAt: document.createdAt ?? nowIso(),
                    updatedAt: document.updatedAt ?? document.createdAt ?? nowIso(),
                    ...(document.metadata && typeof document.metadata === "object" ? document.metadata : {})
                },
                createdAt: toDate(document.createdAt) || new Date()
            }
        });
        return document;
    }

    async updateMemoryDocument(documentId: string, partial: any) {
        const existing = await prisma.memoryDocument.findUnique({ where: { id: documentId } });
        if (!existing) return null;
        const currentMetadata = (existing.metadata as any) || {};
        const nextMetadata = {
            ...currentMetadata,
            ...partial.metadata
        };
        for (const key of ["sourceId", "title", "tags", "keywords", "tokens", "updatedAt"]) {
            if (partial[key] !== undefined) {
                nextMetadata[key] = partial[key];
            }
        }
        const updated = await prisma.memoryDocument.update({
            where: { id: documentId },
            data: {
                workspaceId: partial.workspaceId ?? existing.workspaceId,
                content: partial.content ?? existing.content,
                embedding: partial.embedding !== undefined ? partial.embedding : existing.embedding,
                metadata: nextMetadata
            }
        });
        return this.mapMemoryDocument(updated);
    }

    async getMemoryDocumentById(documentId: string) {
        const document = await prisma.memoryDocument.findUnique({ where: { id: documentId } });
        return document ? this.mapMemoryDocument(document) : null;
    }

    async listMemoryDocuments(filters: any = {}) {
        const where: any = {};
        if (filters.workspaceId) where.workspaceId = filters.workspaceId;
        const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 500);
        const documents = await prisma.memoryDocument.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: safeLimit
        });
        return documents
            .map((document) => this.mapMemoryDocument(document))
            .filter((document) => !filters.sourceId || document.sourceId === filters.sourceId);
    }

    async clearMemoryDocumentsByWorkspace(workspaceId: string) {
        const result = await prisma.memoryDocument.deleteMany({
            where: { workspaceId }
        });
        return Number(result.count ?? 0);
    }

    // --- Mappers ---

    mapCouncilSession(c: any) {
        return {
            id: c.id,
            missionId: c.missionId,
            workspaceId: c.workspaceId,
            runId: c.runId,
            status: c.status,
            problem: c.problem,
            mainAgentId: c.mainAgentId,
            subAgentIds: c.subAgentIds,
            spawnedSubAgentIds: c.spawnedSubAgentIds,
            allowWebResearch: c.allowWebResearch,
            teamAssembly: c.teamAssembly,
            debateRounds: c.debateRounds,
            autoSpawnSubAgents: c.autoSpawnSubAgents,
            autoGenerateSkills: c.autoGenerateSkills,
            idempotencyKey: c.idempotencyKey,
            decomposition: c.decomposition,
            contributions: c.contributions,
            discussion: c.discussion,
            consensus: c.consensus,
            finalBriefing: c.finalBriefing,
            createdAt: toIso(c.createdAt),
            updatedAt: toIso(c.updatedAt)
        };
    }

    mapCouncilRun(r: any) {
        return {
            id: r.id,
            missionId: r.missionId,
            workspaceId: r.workspaceId,
            problem: r.problem,
            mainAgentId: r.mainAgentId,
            subAgentIds: r.subAgentIds,
            spawnedSubAgentIds: r.spawnedSubAgentIds,
            teamAssembly: r.teamAssembly,
            debateRounds: r.debateRounds,
            autoSpawnSubAgents: r.autoSpawnSubAgents,
            autoGenerateSkills: r.autoGenerateSkills,
            idempotencyKey: r.idempotencyKey,
            idempotencySignature: r.idempotencySignature,
            status: r.status,
            createdAt: toIso(r.createdAt),
            startedAt: toIso(r.startedAt),
            endedAt: toIso(r.endedAt),
            councilId: r.councilId,
            error: r.error
        };
    }

    mapHeartbeatJob(j: any) {
        return {
            id: j.id,
            workspaceId: j.workspaceId,
            schedule: j.schedule,
            task: j.task,
            active: j.active,
            createdAt: toIso(j.createdAt),
            updatedAt: toIso(j.updatedAt)
        };
    }

    mapHeartbeatRun(r: any) {
        return {
            id: r.id,
            jobId: r.jobId,
            status: r.status,
            result: r.result,
            createdAt: toIso(r.createdAt)
        };
    }

    mapWizardRun(w: any) {
        return {
            id: w.id,
            workspaceId: w.workspaceId,
            status: w.status,
            step: w.step,
            data: w.data,
            createdAt: toIso(w.createdAt),
            updatedAt: toIso(w.updatedAt)
        };
    }

    mapCompanyRun(c: any) {
        return {
            id: c.id,
            workspaceId: c.workspaceId,
            objective: c.objective,
            status: c.status,
            result: c.result,
            createdAt: toIso(c.createdAt),
            updatedAt: toIso(c.updatedAt)
        };
    }

    mapTunnelProfile(t: any) {
        return {
            id: t.id,
            workspaceId: t.workspaceId,
            provider: t.provider,
            url: t.url,
            active: t.active,
            createdAt: toIso(t.createdAt),
            updatedAt: toIso(t.updatedAt)
        };
    }

    // --- Heartbeat ---

    async createHeartbeatJob(job: any) {
        await prisma.heartbeatJob.create({
            data: {
                id: job.id,
                workspaceId: job.workspaceId,
                schedule: job.schedule,
                task: job.task,
                active: job.active ?? true,
                createdAt: toDate(job.createdAt) || new Date(),
                updatedAt: toDate(job.updatedAt) || new Date()
            }
        });
        return job;
    }

    async updateHeartbeatJob(jobId: string, partial: any) {
        const data: any = { updatedAt: new Date() };
        if (partial.active !== undefined) data.active = partial.active;
        if (partial.schedule) data.schedule = partial.schedule;

        const updated = await prisma.heartbeatJob.update({
            where: { id: jobId },
            data
        });
        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            schedule: updated.schedule,
            task: updated.task,
            active: updated.active,
            createdAt: toIso(updated.createdAt),
            updatedAt: toIso(updated.updatedAt)
        };
    }

    async getHeartbeatJobById(jobId: string) {
        const job = await prisma.heartbeatJob.findUnique({ where: { id: jobId } });
        return job ? {
            id: job.id,
            workspaceId: job.workspaceId,
            schedule: job.schedule,
            task: job.task,
            active: job.active,
            createdAt: toIso(job.createdAt),
            updatedAt: toIso(job.updatedAt)
        } : null;
    }

    async listHeartbeatJobs(workspaceId: string | null = null) {
        const where: any = {};
        if (workspaceId) where.workspaceId = workspaceId;
        const jobs = await prisma.heartbeatJob.findMany({ where });
        return jobs.map(job => ({
            id: job.id,
            workspaceId: job.workspaceId,
            schedule: job.schedule,
            task: job.task,
            active: job.active,
            createdAt: toIso(job.createdAt),
            updatedAt: toIso(job.updatedAt)
        }));
    }

    async createHeartbeatRun(run: any) {
        await prisma.heartbeatRun.create({
            data: {
                id: run.id,
                jobId: run.jobId,
                status: run.status,
                result: run.result,
                createdAt: toDate(run.createdAt) || new Date()
            }
        });
        return run;
    }

    async listHeartbeatRuns(filters: any = {}) {
        const where: any = {};
        if (filters.jobId) where.jobId = filters.jobId;
        const runs = await prisma.heartbeatRun.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: filters.limit ?? 100
        });
        return runs.map(run => ({
            id: run.id,
            jobId: run.jobId,
            status: run.status,
            result: run.result,
            createdAt: toIso(run.createdAt)
        }));
    }

    // --- Wizard ---

    async createWizardRun(run: any) {
        await prisma.wizardRun.create({
            data: {
                id: run.id,
                workspaceId: run.workspaceId,
                status: run.status,
                step: run.step,
                data: run.data,
                createdAt: toDate(run.createdAt) || new Date(),
                updatedAt: toDate(run.updatedAt) || new Date()
            }
        });
        return run;
    }

    async updateWizardRun(runId: string, partial: any) {
        const data: any = { updatedAt: new Date() };
        if (partial.status) data.status = partial.status;
        if (partial.step) data.step = partial.step;
        if (partial.data) data.data = partial.data;

        const updated = await prisma.wizardRun.update({
            where: { id: runId },
            data
        });
        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            status: updated.status,
            step: updated.step,
            data: updated.data,
            createdAt: toIso(updated.createdAt),
            updatedAt: toIso(updated.updatedAt)
        };
    }

    async getWizardRunById(runId: string) {
        const run = await prisma.wizardRun.findUnique({ where: { id: runId } });
        return run ? {
            id: run.id,
            workspaceId: run.workspaceId,
            status: run.status,
            step: run.step,
            data: run.data,
            createdAt: toIso(run.createdAt),
            updatedAt: toIso(run.updatedAt)
        } : null;
    }

    async listWizardRuns(workspaceId: string | null = null) {
        const where: any = {};
        if (workspaceId) where.workspaceId = workspaceId;
        const runs = await prisma.wizardRun.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });
        return runs.map(run => ({
            id: run.id,
            workspaceId: run.workspaceId,
            status: run.status,
            step: run.step,
            data: run.data,
            createdAt: toIso(run.createdAt),
            updatedAt: toIso(run.updatedAt)
        }));
    }

    // --- Company Orchestrator ---

    async createCompanyRun(run: any) {
        await prisma.companyRun.create({
            data: {
                id: run.id,
                workspaceId: run.workspaceId,
                objective: run.objective,
                status: run.status,
                result: run.result,
                createdAt: toDate(run.createdAt) || new Date(),
                updatedAt: toDate(run.updatedAt) || new Date()
            }
        });
        return run;
    }

    async updateCompanyRun(runId: string, partial: any) {
        const data: any = { updatedAt: new Date() };
        if (partial.status) data.status = partial.status;
        if (partial.result) data.result = partial.result;
        if (partial.evaluation) {
            // Merge evaluation into result or specific field? 
            // Original schema check: CompanyRun has `result`. 
            // Logic in server.ts expects updateCompanyRun to handle `evaluation`.
            // `CompanyRun` model has `result` Json.
            // We'll merge into `result`.
            // Ideally we shouldn't fetch here if we can avoid it, but to merge Json deep we might need to.
            // Prisma Json merge is tricky.
        }

        // For simplicity in this implementation, we assume partial.evaluation comes as part of result or we map it.
        // Actually server.ts sends `{ evaluation, updatedAt }`.
        // So we need to store `evaluation` in `result`? 
        // Or did I miss `evaluation` field in CompanyRun schema?
        // Checking schema: `model CompanyRun ... result Json?`.
        // I will assume `evaluation` is part of `result` or stored key in `result`.
        // If server.ts sends `evaluation`, we might need to fetch current result, merge, and save.

        if (partial.evaluation) {
            const current = await this.getCompanyRunById(runId);
            if (current) {
                const currentResult = (current.result as any) || {};
                data.result = { ...currentResult, evaluation: partial.evaluation };
            }
        }

        const updated = await prisma.companyRun.update({
            where: { id: runId },
            data
        });
        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            objective: updated.objective,
            status: updated.status,
            result: updated.result,
            createdAt: toIso(updated.createdAt),
            updatedAt: toIso(updated.updatedAt)
        };
    }

    async getCompanyRunById(runId: string) {
        const run = await prisma.companyRun.findUnique({ where: { id: runId } });
        return run ? {
            id: run.id,
            workspaceId: run.workspaceId,
            objective: run.objective,
            status: run.status,
            result: run.result,
            createdAt: toIso(run.createdAt),
            updatedAt: toIso(run.updatedAt)
        } : null;
    }

    async listCompanyRuns(filters: any = {}) {
        const where: any = {};
        if (filters.workspaceId) where.workspaceId = filters.workspaceId;
        if (filters.status) where.status = filters.status;

        const runs = await prisma.companyRun.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: filters.limit ?? 100
        });
        return runs.map(run => ({
            id: run.id,
            workspaceId: run.workspaceId,
            objective: run.objective,
            status: run.status,
            result: run.result,
            createdAt: toIso(run.createdAt),
            updatedAt: toIso(run.updatedAt)
        }));
    }

    async createObservabilityEvent(event: any) {
        await prisma.observabilityEvent.create({
            data: {
                id: event.id,
                workspaceId: event.workspaceId,
                type: event.type,
                source: event.source,
                payload: event.payload,
                traceId: event.traceId,
                createdAt: toDate(event.createdAt) || new Date()
            }
        });
        return event;
    }

    async listObservabilityEvents(filters: any = {}) {
        const where: any = {};
        if (filters.workspaceId) where.workspaceId = filters.workspaceId;
        if (filters.source) where.source = filters.source;
        if (filters.type) where.type = filters.type;
        if (filters.traceId) where.traceId = filters.traceId;

        const events = await prisma.observabilityEvent.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: filters.limit ?? 200
        });
        return events.map(e => ({
            id: e.id,
            workspaceId: e.workspaceId,
            type: e.type,
            source: e.source,
            payload: e.payload,
            traceId: e.traceId,
            createdAt: toIso(e.createdAt)
        }));
    }

    // --- Mappers ---

    mapMission(m: any) {
        const ctx = (m.context as any) || {};
        return {
            id: m.id,
            title: m.title,
            objective: m.goal,
            status: m.status,
            result: m.result,
            createdAt: toIso(m.createdAt),
            updatedAt: toIso(m.updatedAt),
            workspaceId: ctx.workspaceId,
            kpi: ctx.kpi,
            budgetCap: ctx.budgetCap,
            deadline: ctx.deadline,
            policyPreset: ctx.policyPreset
        };
    }

    mapTask(t: any) {
        const res = (t.result as any) || {};
        return {
            id: t.id,
            missionId: t.missionId,
            title: t.description,
            status: t.status,
            dependencies: t.dependencies,
            createdAt: toIso(t.createdAt),
            updatedAt: toIso(t.updatedAt),
            owner: res.owner,
            dueDate: res.dueDate
        };
    }

    mapAction(a: any) {
        const meta = (a.toolInput as any) || {};
        return {
            id: a.id,
            missionId: a.missionId,
            taskId: meta.taskId,
            actionType: a.type,
            summary: a.description,
            state: meta.state,
            riskScore: meta.riskScore,
            approvalLevel: meta.approvalLevel,
            approvalReason: meta.approvalReason,
            payload: meta,
            idempotencyKey: meta.idempotencyKey,
            idempotencySignature: meta.idempotencySignature,
            createdAt: toIso(a.createdAt),
            updatedAt: toIso(a.createdAt),
            executedAt: meta.executedAt,
            blockedAt: meta.blockedAt,
            metadata: meta
        };
    }

    mapApproval(a: any) {
        return {
            id: a.id,
            missionId: a.missionId,
            actionId: a.actionId,
            status: a.status,
            requestedBy: "system",
            requestedAt: toIso(a.createdAt),
            decidedAt: toIso(a.decisionTime),
            decidedBy: null,
            decisionNote: a.decisionReason,
            reason: a.decisionReason
        };
    }

    mapEvidence(e: any) {
        const c = (e.content as any) || {};
        return {
            id: e.id,
            missionId: e.missionId,
            actionId: c.actionId,
            type: e.type,
            content: c.text,
            createdAt: toIso(e.createdAt)
        };
    }

    mapEvent(e: any) {
        return {
            id: e.id,
            missionId: e.missionId,
            type: e.type,
            actor: e.source,
            payload: e.payload,
            createdAt: toIso(e.createdAt)
        };
    }

    mapAgent(a: any) {
        const skills = (a.skills || []).map((s: any) => s.name);
        return {
            id: a.id,
            role: a.role,
            name: a.name,
            title: a.description,
            workspaceId: a.workspaceId,
            skills,
            createdAt: toIso(a.createdAt),
            updatedAt: toIso(a.updatedAt),
            soul: {},
            model: {},
            canUseWeb: false
        };
    }

    mapSkill(s: any) {
        const mem = (s.memory as any) || {};
        return {
            id: s.id,
            agentId: s.agentId,
            name: s.name,
            description: s.description,
            code: s.code,
            tags: mem.tags || [],
            confidence: mem.confidence || 0,
            createdAt: toIso(s.createdAt),
            updatedAt: toIso(s.updatedAt)
        };
    }

    mapChannelSession(session: any) {
        const parsed = parseSessionKey(session.sessionKey);
        return {
            id: session.id,
            sessionKey: session.sessionKey,
            channelId: session.channelId ?? parsed.channelId,
            workspaceId: session.workspaceId ?? parsed.workspaceId,
            chatId: parsed.chatId,
            userId: parsed.userId,
            metadata: {},
            createdAt: toIso(session.createdAt),
            updatedAt: toIso(session.updatedAt),
            lastInboundAt: null,
            lastOutboundAt: null
        };
    }

    mapChannelMessage(message: any) {
        const metadata = (message.metadata as any) || {};
        const authorRole = String(metadata.authorRole ?? message.role ?? "assistant");
        const direction =
            metadata.direction ??
            (authorRole === "user" || authorRole === "system" ? "inbound" : "outbound");
        return {
            id: message.id,
            sessionId: message.sessionId,
            direction,
            authorId: metadata.authorId ?? "unknown",
            authorRole,
            text: message.content,
            metadata,
            createdAt: toIso(message.createdAt)
        };
    }

    mapRuntimeAction(action: any) {
        const payload = (action.input as any) || {};
        return {
            ...payload,
            id: action.id,
            missionId: action.missionId,
            workspaceId: action.workspaceId,
            toolName: payload.toolName ?? action.tool,
            riskScore: action.riskScore,
            decision: action.decision,
            createdAt: toIso(action.createdAt),
            updatedAt: payload.updatedAt ?? toIso(action.createdAt)
        };
    }

    mapSecurityPairing(pairing: any) {
        const secret = safeJsonParse(pairing.secretKey) || {};
        return {
            id: pairing.id,
            workspaceId: pairing.workspaceId,
            channelId: pairing.channelId,
            otpDigest: secret.otpDigest ?? null,
            tokenDigest: secret.tokenDigest ?? null,
            attempts: Number(secret.attempts ?? 0),
            status: secret.status ?? "pending",
            expiresAt: secret.expiresAt ?? null,
            pairedAt: secret.pairedAt ?? null,
            createdAt: toIso(pairing.createdAt),
            updatedAt: secret.updatedAt ?? toIso(pairing.createdAt)
        };
    }

    mapSecurityAuthToken(token: any) {
        const decoded = decodeAuthMeta(token.scopes);
        return {
            id: token.id,
            workspaceId: token.workspaceId,
            channelId: decoded.channelId,
            scopes: decoded.scopes,
            tokenDigest: token.token,
            status: decoded.status,
            createdAt: toIso(token.createdAt),
            expiresAt: toIso(token.expiresAt),
            revokedAt: decoded.revokedAt
        };
    }

    mapMemoryDocument(document: any) {
        const metadata = (document.metadata as any) || {};
        return {
            id: document.id,
            workspaceId: document.workspaceId,
            sourceId: metadata.sourceId ?? null,
            title: metadata.title ?? null,
            content: document.content,
            tags: Array.isArray(metadata.tags) ? metadata.tags : [],
            keywords: Array.isArray(metadata.keywords) ? metadata.keywords : [],
            embedding: document.embedding,
            tokens: Number(metadata.tokens ?? 0),
            createdAt: toIso(document.createdAt),
            updatedAt: metadata.updatedAt ?? toIso(document.createdAt),
            metadata
        };
    }
}
