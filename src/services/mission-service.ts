// @ts-nocheck
import { makeId } from "../lib/id.js";
import { nowIso, parseDeadline } from "../lib/time.js";
import {
  ActionState,
  ActionType,
  ApprovalStatus,
  MissionStatus,
  TaskStatus
} from "../domain/constants.js";

const ALLOWED_POLICY_PRESETS = new Set(["strict", "balanced", "fast"]);
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

function percent(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const key = String(value).trim();
  if (!key) {
    return null;
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    const error = new Error(`idempotencyKey must be <= ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`);
    error.statusCode = 400;
    throw error;
  }
  return key;
}

function buildActionIdempotencySignature(input) {
  return JSON.stringify({
    taskId: input.taskId ?? null,
    actionType: input.actionType,
    summary: input.summary,
    payload: input.payload ?? {}
  });
}

export class MissionService {
  constructor(store, policyEngine) {
    this.store = store;
    this.policyEngine = policyEngine;
  }

  async listMissions() {
    return this.store.listMissions();
  }

  async getMission(missionId) {
    return this.store.getMissionById(missionId);
  }

  async createMission(input) {
    const title = String(input.title ?? "").trim();
    // ... validation (omitted for brevity in prompt, but should keep it)
    const objective = String(input.objective ?? "").trim();
    const kpi = String(input.kpi ?? "").trim();
    const deadline = parseDeadline(input.deadline);

    if (!title) {
      throw this.#badRequest("Mission title is required.");
    }
    if (!objective) {
      throw this.#badRequest("Mission objective is required.");
    }
    if (!kpi) {
      throw this.#badRequest("Mission KPI is required.");
    }
    if (!deadline) {
      throw this.#badRequest("Mission deadline must be a valid ISO date or date string.");
    }

    const policyPreset = ALLOWED_POLICY_PRESETS.has(input.policyPreset)
      ? input.policyPreset
      : "balanced";

    const createdAt = nowIso();
    const mission = {
      id: makeId("mission"),
      workspaceId: input.workspaceId ? String(input.workspaceId) : "default",
      title,
      objective,
      kpi,
      budgetCap: Number.isFinite(Number(input.budgetCap)) ? Number(input.budgetCap) : null,
      deadline,
      policyPreset,
      status: MissionStatus.DRAFT,
      createdAt,
      updatedAt: createdAt
    };

    await this.store.createMission(mission);
    await this.#recordEvent(mission.id, {
      type: "mission.created",
      actor: "user",
      payload: {
        title: mission.title,
        policyPreset: mission.policyPreset,
        deadline: mission.deadline
      }
    });

    return mission;
  }

  async simulateMission(missionId) {
    const mission = await this.#requireMission(missionId);

    const simulatedAt = nowIso();
    const plans = [
      {
        id: makeId("plan"),
        strategy: "Conservative",
        summary: "Start with low-risk tasks, validate signal, then scale.",
        predictedOutcome: "High reliability, slower velocity.",
        confidence: 0.78
      },
      {
        id: makeId("plan"),
        strategy: "Balanced",
        summary: "Parallelize safe tasks while escalating risky tasks for approval.",
        predictedOutcome: "Strong reliability and moderate speed.",
        confidence: 0.85
      },
      {
        id: makeId("plan"),
        strategy: "Aggressive",
        summary: "Maximize throughput and rely on reactive approvals for blockers.",
        predictedOutcome: "Faster execution, higher interruption risk.",
        confidence: 0.68
      }
    ];

    await this.store.updateMission(mission.id, {
      status: MissionStatus.SIMULATING,
      updatedAt: simulatedAt
    });

    await this.#recordEvent(mission.id, {
      type: "mission.simulated",
      actor: "system",
      payload: {
        plans,
        selectedPolicy: mission.policyPreset
      }
    });

    return {
      missionId: mission.id,
      simulatedAt,
      plans
    };
  }

  async startMission(missionId) {
    const mission = await this.#requireMission(missionId);
    if (mission.status === MissionStatus.CANCELLED || mission.status === MissionStatus.COMPLETED) {
      throw this.#badRequest("Mission cannot be started from its current status.");
    }

    const updatedMission = await this.store.updateMission(mission.id, {
      status: MissionStatus.EXECUTING,
      updatedAt: nowIso()
    });

    await this.#recordEvent(mission.id, {
      type: "mission.started",
      actor: "user",
      payload: { previousStatus: mission.status }
    });

    return updatedMission;
  }

  async createTask(missionId, input) {
    const mission = await this.#requireMission(missionId);
    const title = String(input.title ?? "").trim();
    if (!title) {
      throw this.#badRequest("Task title is required.");
    }

    const dueDate = input.dueDate ? parseDeadline(input.dueDate) : null;
    if (input.dueDate && !dueDate) {
      throw this.#badRequest("Task dueDate must be a valid date.");
    }

    const createdAt = nowIso();
    const task = {
      id: makeId("task"),
      missionId: mission.id,
      title,
      owner: String(input.owner ?? "unassigned"),
      dueDate,
      status: TaskStatus.PENDING,
      createdAt,
      updatedAt: createdAt
    };

    await this.store.createTask(task);
    await this.#recordEvent(mission.id, {
      type: "task.created",
      actor: "user",
      payload: {
        taskId: task.id,
        title: task.title
      }
    });

    return task;
  }

  async updateTaskStatus(missionId, taskId, status) {
    await this.#requireMission(missionId);
    if (!Object.values(TaskStatus).includes(status)) {
      throw this.#badRequest("Invalid task status.");
    }

    const task = await this.store.updateTask(taskId, {
      status,
      updatedAt: nowIso()
    });
    if (!task || task.missionId !== missionId) {
      throw this.#notFound("Task not found.");
    }

    await this.#recordEvent(missionId, {
      type: "task.updated",
      actor: "user",
      payload: {
        taskId,
        status
      }
    });

    if (status === TaskStatus.DONE) {
      await this.#tryAutoCompleteMission(missionId);
    }
    return task;
  }

  async recordAction(missionId, input) {
    const mission = await this.#requireMission(missionId);
    const actionType = String(input.actionType ?? "");
    const summary = String(input.summary ?? "").trim();
    const taskId = input.taskId ? String(input.taskId) : null;
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);

    if (!Object.values(ActionType).includes(actionType)) {
      throw this.#badRequest("Invalid actionType.");
    }
    if (!summary) {
      throw this.#badRequest("Action summary is required.");
    }

    const idempotencySignature = idempotencyKey
      ? buildActionIdempotencySignature({
        taskId,
        actionType,
        summary,
        payload: input.payload ?? {}
      })
      : null;

    if (idempotencyKey) {
      const existingAction = await this.store.getMissionActionByIdempotencyKey(mission.id, idempotencyKey);
      if (existingAction) {
        if (
          existingAction.idempotencySignature &&
          existingAction.idempotencySignature !== idempotencySignature
        ) {
          throw this.#conflict(
            `idempotencyKey '${idempotencyKey}' is already used with different action parameters.`
          );
        }
        const existingApproval = await this.store.getApprovalByActionId(existingAction.id);
        await this.#recordEvent(mission.id, {
          type: "action.idempotent_replay",
          actor: "system",
          payload: {
            actionId: existingAction.id,
            idempotencyKey
          }
        });
        return {
          action: existingAction,
          approval: existingApproval,
          idempotent: true
        };
      }
    }

    const decision = this.policyEngine.evaluateAction({
      actionType,
      policyPreset: mission.policyPreset,
      additionalRiskDelta: Number(input.additionalRiskDelta ?? 0)
    });

    const actionId = makeId("action");
    const createdAt = nowIso();
    let action = await this.store.createAction({
      id: actionId,
      missionId: mission.id,
      taskId,
      actionType,
      summary,
      state: decision.requiresApproval ? ActionState.PENDING_APPROVAL : ActionState.EXECUTED,
      riskScore: decision.riskScore,
      approvalLevel: decision.approvalLevel,
      approvalReason: decision.reason,
      payload: input.payload ?? {},
      idempotencyKey,
      idempotencySignature,
      createdAt,
      updatedAt: createdAt,
      executedAt: decision.requiresApproval ? null : createdAt,
      blockedAt: null
    });

    await this.#recordEvent(mission.id, {
      type: "action.logged",
      actor: "system",
      payload: {
        actionId,
        actionType,
        state: action.state,
        riskScore: action.riskScore,
        idempotencyKey
      }
    });

    if (!decision.requiresApproval) {
      await this.#writeEvidence(action, input.evidence);
      await this.#recordEvent(mission.id, {
        type: "action.executed",
        actor: "system",
        payload: {
          actionId: action.id,
          summary: action.summary
        }
      });
      return { action, approval: null, idempotent: false };
    }

    const approval = await this.store.createApproval({
      id: makeId("approval"),
      missionId: mission.id,
      actionId: action.id,
      status: ApprovalStatus.REQUESTED,
      requestedBy: "system",
      requestedAt: createdAt,
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
      reason: decision.reason
    });

    await this.#recordEvent(mission.id, {
      type: "approval.requested",
      actor: "system",
      payload: {
        approvalId: approval.id,
        actionId: action.id,
        reason: approval.reason
      }
    });

    return { action, approval, idempotent: false };
  }

  async decideApproval(approvalId, input) {
    const approval = await this.store.getApprovalById(approvalId);
    if (!approval) {
      throw this.#notFound("Approval request not found.");
    }
    if (approval.status !== ApprovalStatus.REQUESTED) {
      throw this.#badRequest("Approval request is already resolved.");
    }

    const decision = String(input.decision ?? "").trim().toLowerCase();
    if (!["approve", "reject"].includes(decision)) {
      throw this.#badRequest("Decision must be either 'approve' or 'reject'.");
    }

    const status = decision === "approve" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    const decidedAt = nowIso();
    const actor = String(input.actor ?? "user");
    const decisionNote = input.note ? String(input.note) : null;

    const updatedApproval = await this.store.updateApproval(approval.id, {
      status,
      decidedAt,
      decidedBy: actor,
      decisionNote
    });
    const action = await this.store.getActionById(approval.actionId);
    if (!action) {
      throw this.#notFound("Related action not found.");
    }

    if (status === ApprovalStatus.APPROVED) {
      await this.store.updateAction(action.id, {
        state: ActionState.EXECUTED,
        executedAt: decidedAt,
        updatedAt: decidedAt
      });
      await this.#recordEvent(approval.missionId, {
        type: "approval.approved",
        actor,
        payload: {
          approvalId: approval.id,
          actionId: action.id
        }
      });
      await this.#recordEvent(approval.missionId, {
        type: "action.executed",
        actor: "system",
        payload: {
          actionId: action.id,
          summary: action.summary
        }
      });
    } else {
      await this.store.updateAction(action.id, {
        state: ActionState.BLOCKED,
        blockedAt: decidedAt,
        updatedAt: decidedAt
      });
      await this.store.updateMission(approval.missionId, {
        status: MissionStatus.BLOCKED,
        updatedAt: decidedAt
      });
      await this.#recordEvent(approval.missionId, {
        type: "approval.rejected",
        actor,
        payload: {
          approvalId: approval.id,
          actionId: action.id
        }
      });
    }

    return updatedApproval;
  }

  async getTimeline(missionId) {
    await this.#requireMission(missionId);
    const events = (await this.store.listMissionEvents(missionId))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const actions = await this.store.listMissionActions(missionId);
    const approvals = await this.store.listMissionApprovals(missionId);
    const evidence = await this.store.listMissionEvidence(missionId);

    return {
      missionId,
      events,
      actions,
      approvals,
      evidence
    };
  }

  async getMetrics(missionId) {
    const mission = await this.#requireMission(missionId);
    const tasks = await this.store.listMissionTasks(missionId);
    const actions = await this.store.listMissionActions(missionId);
    const approvals = await this.store.listMissionApprovals(missionId);

    const doneTasks = tasks.filter((task) => task.status === TaskStatus.DONE).length;
    const blockedActions = actions.filter((action) => action.state === ActionState.BLOCKED).length;
    const executedActions = actions.filter((action) => action.state === ActionState.EXECUTED).length;
    const approvalRequested = approvals.filter(
      (approval) => approval.status === ApprovalStatus.REQUESTED
    ).length;
    const approvedCount = approvals.filter((approval) => approval.status === ApprovalStatus.APPROVED).length;
    const rejectedCount = approvals.filter((approval) => approval.status === ApprovalStatus.REJECTED).length;

    return {
      missionId: mission.id,
      missionStatus: mission.status,
      commitmentClosureRate: percent(doneTasks, tasks.length),
      taskCount: tasks.length,
      taskDoneCount: doneTasks,
      actionCount: actions.length,
      actionExecutedCount: executedActions,
      actionBlockedCount: blockedActions,
      approvalsRequested: approvalRequested,
      approvalsApproved: approvedCount,
      approvalsRejected: rejectedCount
    };
  }

  async #tryAutoCompleteMission(missionId) {
    const mission = await this.store.getMissionById(missionId);
    if (!mission) {
      return;
    }
    const tasks = await this.store.listMissionTasks(missionId);
    if (tasks.length === 0) {
      return;
    }
    const unfinished = tasks.some((task) => task.status !== TaskStatus.DONE);
    if (unfinished) {
      return;
    }
    await this.store.updateMission(missionId, {
      status: MissionStatus.COMPLETED,
      updatedAt: nowIso()
    });
    await this.#recordEvent(missionId, {
      type: "mission.completed",
      actor: "system",
      payload: {
        reason: "All tasks marked done."
      }
    });
  }

  async #writeEvidence(action, evidenceInput) {
    if (!evidenceInput) {
      return;
    }
    const evidenceItems = Array.isArray(evidenceInput) ? evidenceInput : [evidenceInput];
    for (const entry of evidenceItems) {
      if (!entry) {
        continue;
      }
      await this.store.createEvidence({
        id: makeId("evidence"),
        missionId: action.missionId,
        actionId: action.id,
        type: String(entry.type ?? "note"),
        content: String(entry.content ?? ""),
        createdAt: nowIso()
      });
    }
  }

  async #recordEvent(missionId, input) {
    await this.store.createEvent({
      id: makeId("event"),
      missionId,
      type: input.type,
      actor: input.actor ?? "system",
      payload: input.payload ?? {},
      createdAt: nowIso()
    });
  }

  async #requireMission(missionId) {
    const mission = await this.store.getMissionById(missionId);
    if (!mission) {
      throw this.#notFound("Mission not found.");
    }
    return mission;
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

  #conflict(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
  }
}
