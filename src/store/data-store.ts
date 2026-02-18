// @ts-nocheck
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

const emptyState = () => ({
  missions: [],
  tasks: [],
  actions: [],
  approvals: [],
  evidences: [],
  events: [],
  agents: [],
  skills: [],
  councils: [],
  councilRuns: [],
  autopilotGoals: [],
  autopilotLogs: [],
  channelSessions: [],
  channelMessages: [],
  runtimeActions: [],
  securityPairings: [],
  securityAuthTokens: [],
  securityRateEvents: [],
  tunnelProfiles: [],
  memoryDocuments: [],
  heartbeatJobs: [],
  heartbeatRuns: [],
  wizardRuns: [],
  companyRuns: [],
  observabilityEvents: []
});

export class DataStore {
  constructor(options = {}) {
    this.persistPath = options.persistPath ?? null;
    this.externalPersistence = options.externalPersistence ?? null;
    this.state = this.#loadState();
    this.ready = Promise.resolve();
    this.persistenceQueue = Promise.resolve();
    this.externalPersistenceError = null;
    this.debounceTimer = null;
    this.writePromise = Promise.resolve();

    if (this.externalPersistence && typeof this.externalPersistence.loadState === "function") {
      this.ready = this.#hydrateFromExternal();
    }
  }

  #loadState() {
    if (!this.persistPath) {
      return emptyState();
    }
    if (!fs.existsSync(this.persistPath)) {
      return emptyState();
    }

    try {
      const content = fs.readFileSync(this.persistPath, "utf8");
      const parsed = JSON.parse(content);
      return {
        ...emptyState(),
        ...parsed
      };
    } catch {
      return emptyState();
    }
  }

  #saveState() {
    this.#scheduleExternalSave();
    if (!this.persistPath) {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.debounceTimer = setTimeout(() => {
      this.#flushToDisk().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("DataStore: Failed to flush to disk:", err);
      });
    }, 1000);
  }

  async #flushToDisk() {
    if (!this.persistPath) {
      return;
    }
    const content = JSON.stringify(this.state, null, 2);
    this.writePromise = this.writePromise
      .then(async () => {
        await fsPromises.mkdir(path.dirname(this.persistPath), { recursive: true });
        await fsPromises.writeFile(this.persistPath, content, "utf8");
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("DataStore: Write error:", err);
      });
    await this.writePromise;
  }

  async #hydrateFromExternal() {
    try {
      const loaded = await this.externalPersistence.loadState();
      if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
        return;
      }
      this.state = {
        ...emptyState(),
        ...loaded
      };
      if (this.persistPath) {
        fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
        fs.writeFileSync(this.persistPath, JSON.stringify(this.state, null, 2), "utf8");
      }
    } catch (error) {
      this.externalPersistenceError = error instanceof Error ? error.message : String(error);
    }
  }

  #scheduleExternalSave() {
    if (!this.externalPersistence || typeof this.externalPersistence.saveState !== "function") {
      return;
    }
    const snapshot = clone(this.state);
    this.persistenceQueue = this.persistenceQueue
      .then(async () => {
        await this.externalPersistence.saveState(snapshot);
        this.externalPersistenceError = null;
      })
      .catch((error) => {
        this.externalPersistenceError = error instanceof Error ? error.message : String(error);
      });
  }

  waitUntilReady() {
    return this.ready;
  }

  async waitForPersistence() {
    await this.persistenceQueue;
  }

  async shutdown() {
    await this.waitUntilReady();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      await this.#flushToDisk();
    }
    await this.writePromise;
    await this.waitForPersistence();
    if (this.externalPersistence && typeof this.externalPersistence.close === "function") {
      await this.externalPersistence.close();
    }
  }

  getPersistenceStatus() {
    return {
      externalEnabled: Boolean(this.externalPersistence),
      externalError: this.externalPersistenceError
    };
  }

  listMissions() {
    return clone(this.state.missions);
  }

  getMissionById(missionId) {
    return clone(this.state.missions.find((mission) => mission.id === missionId) ?? null);
  }

  createMission(mission) {
    this.state.missions.push(clone(mission));
    this.#saveState();
    return clone(mission);
  }

  updateMission(missionId, partial) {
    const index = this.state.missions.findIndex((mission) => mission.id === missionId);
    if (index === -1) {
      return null;
    }
    this.state.missions[index] = {
      ...this.state.missions[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.missions[index]);
  }

  listMissionTasks(missionId) {
    return clone(this.state.tasks.filter((task) => task.missionId === missionId));
  }

  createTask(task) {
    this.state.tasks.push(clone(task));
    this.#saveState();
    return clone(task);
  }

  updateTask(taskId, partial) {
    const index = this.state.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      return null;
    }
    this.state.tasks[index] = {
      ...this.state.tasks[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.tasks[index]);
  }

  listMissionActions(missionId) {
    return clone(this.state.actions.filter((action) => action.missionId === missionId));
  }

  getActionById(actionId) {
    return clone(this.state.actions.find((action) => action.id === actionId) ?? null);
  }

  getMissionActionByIdempotencyKey(missionId, idempotencyKey) {
    return clone(
      this.state.actions.find(
        (action) => action.missionId === missionId && action.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }

  createAction(action) {
    this.state.actions.push(clone(action));
    this.#saveState();
    return clone(action);
  }

  updateAction(actionId, partial) {
    const index = this.state.actions.findIndex((action) => action.id === actionId);
    if (index === -1) {
      return null;
    }
    this.state.actions[index] = {
      ...this.state.actions[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.actions[index]);
  }

  createApproval(approval) {
    this.state.approvals.push(clone(approval));
    this.#saveState();
    return clone(approval);
  }

  getApprovalById(approvalId) {
    return clone(this.state.approvals.find((approval) => approval.id === approvalId) ?? null);
  }

  getApprovalByActionId(actionId) {
    return clone(this.state.approvals.find((approval) => approval.actionId === actionId) ?? null);
  }

  updateApproval(approvalId, partial) {
    const index = this.state.approvals.findIndex((approval) => approval.id === approvalId);
    if (index === -1) {
      return null;
    }
    this.state.approvals[index] = {
      ...this.state.approvals[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.approvals[index]);
  }

  listMissionApprovals(missionId) {
    return clone(this.state.approvals.filter((approval) => approval.missionId === missionId));
  }

  createEvidence(evidence) {
    this.state.evidences.push(clone(evidence));
    this.#saveState();
    return clone(evidence);
  }

  listMissionEvidence(missionId) {
    return clone(this.state.evidences.filter((evidence) => evidence.missionId === missionId));
  }

  createEvent(event) {
    this.state.events.push(clone(event));
    this.#saveState();
    return clone(event);
  }

  listMissionEvents(missionId) {
    return clone(this.state.events.filter((event) => event.missionId === missionId));
  }

  listAgents(workspaceId = null) {
    if (!workspaceId) {
      return clone(this.state.agents);
    }
    return clone(this.state.agents.filter((agent) => agent.workspaceId === workspaceId));
  }

  getAgentById(agentId) {
    return clone(this.state.agents.find((agent) => agent.id === agentId) ?? null);
  }

  createAgent(agent) {
    this.state.agents.push(clone(agent));
    this.#saveState();
    return clone(agent);
  }

  updateAgent(agentId, partial) {
    const index = this.state.agents.findIndex((agent) => agent.id === agentId);
    if (index === -1) {
      return null;
    }
    this.state.agents[index] = {
      ...this.state.agents[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.agents[index]);
  }

  listAgentSkills(agentId) {
    return clone(this.state.skills.filter((skill) => skill.agentId === agentId));
  }

  getSkillById(skillId) {
    return clone(this.state.skills.find((skill) => skill.id === skillId) ?? null);
  }

  getAgentSkillByCanonicalKey(agentId, canonicalKey) {
    return clone(
      this.state.skills.find(
        (skill) => skill.agentId === agentId && skill.canonicalKey === canonicalKey
      ) ?? null
    );
  }

  createSkill(skill) {
    this.state.skills.push(clone(skill));
    this.#saveState();
    return clone(skill);
  }

  updateSkill(skillId, partial) {
    const index = this.state.skills.findIndex((skill) => skill.id === skillId);
    if (index === -1) {
      return null;
    }
    this.state.skills[index] = {
      ...this.state.skills[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.skills[index]);
  }

  appendSkillMemory(skillId, memoryEntry, maxMemory = 100) {
    const index = this.state.skills.findIndex((skill) => skill.id === skillId);
    if (index === -1) {
      return null;
    }

    const skill = this.state.skills[index];
    const memory = Array.isArray(skill.memory) ? [...skill.memory, clone(memoryEntry)] : [clone(memoryEntry)];
    const limit = Math.max(1, Number.isFinite(Number(maxMemory)) ? Number(maxMemory) : 100);
    const trimmed = memory.length > limit ? memory.slice(memory.length - limit) : memory;

    this.state.skills[index] = {
      ...skill,
      memory: trimmed,
      memoryCount: trimmed.length,
      lastUsedAt: memoryEntry.createdAt ?? null,
      updatedAt: memoryEntry.createdAt ?? skill.updatedAt
    };
    this.#saveState();
    return clone(this.state.skills[index]);
  }

  createCouncilSession(session) {
    this.state.councils.push(clone(session));
    this.#saveState();
    return clone(session);
  }

  getCouncilSessionById(councilId) {
    return clone(this.state.councils.find((session) => session.id === councilId) ?? null);
  }

  listMissionCouncilSessions(missionId) {
    return clone(this.state.councils.filter((session) => session.missionId === missionId));
  }

  createCouncilRun(run) {
    this.state.councilRuns.push(clone(run));
    this.#saveState();
    return clone(run);
  }

  updateCouncilRun(runId, partial) {
    const index = this.state.councilRuns.findIndex((run) => run.id === runId);
    if (index === -1) {
      return null;
    }
    this.state.councilRuns[index] = {
      ...this.state.councilRuns[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.councilRuns[index]);
  }

  getCouncilRunById(runId) {
    return clone(this.state.councilRuns.find((run) => run.id === runId) ?? null);
  }

  getMissionCouncilRunByIdempotencyKey(missionId, idempotencyKey) {
    return clone(
      this.state.councilRuns.find(
        (run) => run.missionId === missionId && run.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }

  listMissionCouncilRuns(missionId) {
    return clone(this.state.councilRuns.filter((run) => run.missionId === missionId));
  }

  listAutopilotGoals(filters = {}) {
    let items = this.state.autopilotGoals;
    if (filters.workspaceId) {
      items = items.filter((goal) => goal.workspaceId === filters.workspaceId);
    }
    if (filters.status) {
      items = items.filter((goal) => goal.status === filters.status);
    }
    const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 200);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }

  getAutopilotGoalById(goalId) {
    return clone(this.state.autopilotGoals.find((goal) => goal.id === goalId) ?? null);
  }

  createAutopilotGoal(goal) {
    this.state.autopilotGoals.push(clone(goal));
    this.#saveState();
    return clone(goal);
  }

  updateAutopilotGoal(goalId, partial) {
    const index = this.state.autopilotGoals.findIndex((goal) => goal.id === goalId);
    if (index === -1) {
      return null;
    }
    this.state.autopilotGoals[index] = {
      ...this.state.autopilotGoals[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.autopilotGoals[index]);
  }

  listAutopilotLogs(goalId, limit = 200) {
    const safeLimit = Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : 200);
    const items = this.state.autopilotLogs.filter((log) => log.goalId === goalId);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }

  createAutopilotLog(log) {
    this.state.autopilotLogs.push(clone(log));
    this.#saveState();
    return clone(log);
  }

  listChannelSessions(workspaceId = null) {
    if (!workspaceId) {
      return clone(this.state.channelSessions);
    }
    return clone(this.state.channelSessions.filter((session) => session.workspaceId === workspaceId));
  }

  getChannelSessionById(sessionId) {
    return clone(this.state.channelSessions.find((session) => session.id === sessionId) ?? null);
  }

  getChannelSessionByKey(sessionKey) {
    return clone(this.state.channelSessions.find((session) => session.sessionKey === sessionKey) ?? null);
  }

  createChannelSession(session) {
    this.state.channelSessions.push(clone(session));
    this.#saveState();
    return clone(session);
  }

  updateChannelSession(sessionId, partial) {
    const index = this.state.channelSessions.findIndex((session) => session.id === sessionId);
    if (index === -1) {
      return null;
    }
    this.state.channelSessions[index] = {
      ...this.state.channelSessions[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.channelSessions[index]);
  }

  listChannelSessionMessages(sessionId, limit = 100) {
    const safeLimit = Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : 100);
    const messages = this.state.channelMessages.filter((message) => message.sessionId === sessionId);
    const sliced = messages.length > safeLimit ? messages.slice(messages.length - safeLimit) : messages;
    return clone(sliced);
  }

  createChannelMessage(message) {
    this.state.channelMessages.push(clone(message));
    this.#saveState();
    return clone(message);
  }

  listRuntimeActions(filters = {}) {
    let items = this.state.runtimeActions;
    if (filters.workspaceId) {
      items = items.filter((item) => item.workspaceId === filters.workspaceId);
    }
    if (filters.missionId) {
      items = items.filter((item) => item.missionId === filters.missionId);
    }
    if (filters.status) {
      items = items.filter((item) => item.status === filters.status);
    }
    if (filters.decision) {
      items = items.filter((item) => item.decision === filters.decision);
    }
    if (filters.actionType) {
      items = items.filter((item) => item.actionType === filters.actionType);
    }
    const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 100);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }

  getRuntimeActionById(actionId) {
    return clone(this.state.runtimeActions.find((action) => action.id === actionId) ?? null);
  }

  createRuntimeAction(action) {
    this.state.runtimeActions.push(clone(action));
    this.#saveState();
    return clone(action);
  }

  updateRuntimeAction(actionId, partial) {
    const index = this.state.runtimeActions.findIndex((action) => action.id === actionId);
    if (index === -1) {
      return null;
    }
    this.state.runtimeActions[index] = {
      ...this.state.runtimeActions[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.runtimeActions[index]);
  }

  createSecurityPairing(pairing) {
    this.state.securityPairings.push(clone(pairing));
    this.#saveState();
    return clone(pairing);
  }

  updateSecurityPairing(pairingId, partial) {
    const index = this.state.securityPairings.findIndex((pairing) => pairing.id === pairingId);
    if (index === -1) {
      return null;
    }
    this.state.securityPairings[index] = {
      ...this.state.securityPairings[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.securityPairings[index]);
  }

  getSecurityPairingById(pairingId) {
    return clone(this.state.securityPairings.find((pairing) => pairing.id === pairingId) ?? null);
  }

  listSecurityPairings(filters = {}) {
    let items = this.state.securityPairings;
    if (filters.workspaceId) {
      items = items.filter((pairing) => pairing.workspaceId === filters.workspaceId);
    }
    if (filters.channelId) {
      items = items.filter((pairing) => pairing.channelId === filters.channelId);
    }
    const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 100);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }

  createSecurityAuthToken(token) {
    this.state.securityAuthTokens.push(clone(token));
    this.#saveState();
    return clone(token);
  }

  listSecurityAuthTokens(filters = {}) {
    let items = this.state.securityAuthTokens;
    if (filters.workspaceId) {
      items = items.filter((token) => token.workspaceId === filters.workspaceId);
    }
    if (filters.channelId) {
      items = items.filter((token) => token.channelId === filters.channelId);
    }
    const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 200);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }

  updateSecurityAuthToken(tokenId, partial) {
    const index = this.state.securityAuthTokens.findIndex((token) => token.id === tokenId);
    if (index === -1) {
      return null;
    }
    this.state.securityAuthTokens[index] = {
      ...this.state.securityAuthTokens[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.securityAuthTokens[index]);
  }

  createSecurityRateEvent(event) {
    this.state.securityRateEvents.push(clone(event));
    this.#saveState();
    return clone(event);
  }

  listSecurityRateEvents(filters = {}) {
    let items = this.state.securityRateEvents;
    if (filters.workspaceId) {
      items = items.filter((item) => item.workspaceId === filters.workspaceId);
    }
    if (filters.channelId) {
      items = items.filter((item) => item.channelId === filters.channelId);
    }
    const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 500);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }

  createTunnelProfile(profile) {
    this.state.tunnelProfiles.push(clone(profile));
    this.#saveState();
    return clone(profile);
  }

  updateTunnelProfile(tunnelId, partial) {
    const index = this.state.tunnelProfiles.findIndex((profile) => profile.id === tunnelId);
    if (index === -1) {
      return null;
    }
    this.state.tunnelProfiles[index] = {
      ...this.state.tunnelProfiles[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.tunnelProfiles[index]);
  }

  getTunnelProfileById(tunnelId) {
    return clone(this.state.tunnelProfiles.find((profile) => profile.id === tunnelId) ?? null);
  }

  listTunnelProfiles(workspaceId = null) {
    if (!workspaceId) {
      return clone(this.state.tunnelProfiles);
    }
    return clone(this.state.tunnelProfiles.filter((profile) => profile.workspaceId === workspaceId));
  }

  createMemoryDocument(document) {
    this.state.memoryDocuments.push(clone(document));
    this.#saveState();
    return clone(document);
  }

  updateMemoryDocument(documentId, partial) {
    const index = this.state.memoryDocuments.findIndex((document) => document.id === documentId);
    if (index === -1) {
      return null;
    }
    this.state.memoryDocuments[index] = {
      ...this.state.memoryDocuments[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.memoryDocuments[index]);
  }

  getMemoryDocumentById(documentId) {
    return clone(this.state.memoryDocuments.find((document) => document.id === documentId) ?? null);
  }

  listMemoryDocuments(filters = {}) {
    let items = this.state.memoryDocuments;
    if (filters.workspaceId) {
      items = items.filter((document) => document.workspaceId === filters.workspaceId);
    }
    if (filters.sourceId) {
      items = items.filter((document) => document.sourceId === filters.sourceId);
    }
    const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 500);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }

  clearMemoryDocumentsByWorkspace(workspaceId) {
    const before = this.state.memoryDocuments.length;
    this.state.memoryDocuments = this.state.memoryDocuments.filter(
      (document) => document.workspaceId !== workspaceId
    );
    const deleted = before - this.state.memoryDocuments.length;
    this.#saveState();
    return deleted;
  }

  createHeartbeatJob(job) {
    this.state.heartbeatJobs.push(clone(job));
    this.#saveState();
    return clone(job);
  }

  updateHeartbeatJob(jobId, partial) {
    const index = this.state.heartbeatJobs.findIndex((job) => job.id === jobId);
    if (index === -1) {
      return null;
    }
    this.state.heartbeatJobs[index] = {
      ...this.state.heartbeatJobs[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.heartbeatJobs[index]);
  }

  getHeartbeatJobById(jobId) {
    return clone(this.state.heartbeatJobs.find((job) => job.id === jobId) ?? null);
  }

  listHeartbeatJobs(workspaceId = null) {
    if (!workspaceId) {
      return clone(this.state.heartbeatJobs);
    }
    return clone(this.state.heartbeatJobs.filter((job) => job.workspaceId === workspaceId));
  }

  createHeartbeatRun(run) {
    this.state.heartbeatRuns.push(clone(run));
    this.#saveState();
    return clone(run);
  }

  listHeartbeatRuns(filters = {}) {
    let items = this.state.heartbeatRuns;
    if (filters.jobId) {
      items = items.filter((run) => run.jobId === filters.jobId);
    }
    if (filters.workspaceId) {
      items = items.filter((run) => run.workspaceId === filters.workspaceId);
    }
    const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 200);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }

  createWizardRun(run) {
    this.state.wizardRuns.push(clone(run));
    this.#saveState();
    return clone(run);
  }

  updateWizardRun(runId, partial) {
    const index = this.state.wizardRuns.findIndex((run) => run.id === runId);
    if (index === -1) {
      return null;
    }
    this.state.wizardRuns[index] = {
      ...this.state.wizardRuns[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.wizardRuns[index]);
  }

  getWizardRunById(runId) {
    return clone(this.state.wizardRuns.find((run) => run.id === runId) ?? null);
  }

  listWizardRuns(workspaceId = null) {
    if (!workspaceId) {
      return clone(this.state.wizardRuns);
    }
    return clone(this.state.wizardRuns.filter((run) => run.workspaceId === workspaceId));
  }

  createCompanyRun(run) {
    this.state.companyRuns.push(clone(run));
    this.#saveState();
    return clone(run);
  }

  updateCompanyRun(runId, partial) {
    const index = this.state.companyRuns.findIndex((run) => run.id === runId);
    if (index === -1) {
      return null;
    }
    this.state.companyRuns[index] = {
      ...this.state.companyRuns[index],
      ...clone(partial)
    };
    this.#saveState();
    return clone(this.state.companyRuns[index]);
  }

  getCompanyRunById(runId) {
    return clone(this.state.companyRuns.find((run) => run.id === runId) ?? null);
  }

  listCompanyRuns(filters = {}) {
    let items = this.state.companyRuns;
    if (filters.workspaceId) {
      items = items.filter((run) => run.workspaceId === filters.workspaceId);
    }
    if (filters.status) {
      items = items.filter((run) => run.status === filters.status);
    }
    const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 200);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }

  createObservabilityEvent(event) {
    this.state.observabilityEvents.push(clone(event));
    this.#saveState();
    return clone(event);
  }

  listObservabilityEvents(filters = {}) {
    let items = this.state.observabilityEvents;
    if (filters.workspaceId) {
      items = items.filter((event) => event.workspaceId === filters.workspaceId);
    }
    if (filters.source) {
      items = items.filter((event) => event.source === filters.source);
    }
    const safeLimit = Math.max(1, Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : 500);
    const sliced = items.length > safeLimit ? items.slice(items.length - safeLimit) : items;
    return clone(sliced);
  }
}
