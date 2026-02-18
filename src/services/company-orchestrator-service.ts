// @ts-nocheck
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";

export const COMPANY_STATUS = Object.freeze({
  PLANNING: "planning",
  EXECUTING: "executing",
  WAITING_HUMAN: "waiting_human",
  COMPLETED: "completed",
  FAILED: "failed"
});

const HIGH_RISK_HINTS = [
  "nuke",
  "drop database",
  "delete all",
  "wipe",
  "rm -rf",
  "wire money",
  "transfer funds",
  "production secrets",
  "credential rotation without backup"
];

const AMBIGUOUS_HINTS = ["do whatever", "anything", "not sure", "handle it somehow", "figure it out"];

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

function normalizeStringArray(input, maxItems = 32) {
  if (!Array.isArray(input)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const normalized = safeString(item).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function buildDeadline(days = 14) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function normalizeDecision(value) {
  const decision = safeString(value, "approve").toLowerCase();
  if (["approve", "approved", "resume", "continue"].includes(decision)) {
    return "approve";
  }
  if (["reject", "rejected", "deny", "denied", "cancel"].includes(decision)) {
    return "reject";
  }
  return "";
}

export class CompanyOrchestratorService {
  constructor(options = {}) {
    this.store = options.store;
    this.architectureService = options.architectureService;
    this.missionService = options.missionService;
    this.councilService = options.councilService;
    this.verificationEngine = options.verificationEngine;
    this.commandQueue = options.commandQueue ?? null;
    this.channelGatewayService = options.channelGatewayService ?? null;
    this.securityFabricService = options.securityFabricService ?? null;
    this.observabilityService = options.observabilityService ?? null;
    this.evaluationService = options.evaluationService ?? null;
    this.notificationOutboxService = options.notificationOutboxService ?? null;
    this.councilStepTimeoutMs = clampInt(
      options.councilStepTimeoutMs ?? process.env.COMPANY_COUNCIL_STEP_TIMEOUT_MS,
      180000,
      5000,
      900000
    );
  }

  async listRuns(filters = {}) {
    return this.store.listCompanyRuns({
      workspaceId: filters.workspaceId ? safeString(filters.workspaceId) : undefined,
      status: filters.status ? safeString(filters.status) : undefined,
      limit: clampInt(filters.limit, 100, 1, 2000)
    });
  }

  async getRun(runId) {
    return this.store.getCompanyRunById(safeString(runId));
  }

  async executeObjective(input = {}) {
    const objective = safeString(input.objective ?? input.goal);
    if (!objective) {
      throw this.#badRequest("objective is required.");
    }

    const workspaceId = safeString(input.workspaceId, "default");
    const notifyTargets = Array.isArray(input.notifyTargets) ? input.notifyTargets : [];
    const teamSize = clampInt(input.teamSize, 4, 2, 8);
    const debateRounds = clampInt(input.debateRounds, 2, 1, 4);
    const maxRetries = clampInt(input.maxRetries, 2, 1, 5);
    const policyPreset = safeString(input.policyPreset, "balanced");
    const runtimeEscalationPolicy = this.#buildRuntimeEscalationPolicy(input);
    const createdAt = nowIso();

    let run = await this.store.createCompanyRun({
      id: makeId("company"),
      workspaceId,
      source: safeString(input.source, "api"),
      objective,
      status: COMPANY_STATUS.PLANNING,
      createdAt,
      updatedAt: createdAt,
      startedAt: createdAt,
      completedAt: null,
      missionId: null,
      planId: null,
      mainAgentId: null,
      summary: null,
      errors: [],
      stageLogs: [],
      pendingEscalation: null,
      resumeState: null,
      traceId: null,
      evaluation: null
    });

    const trace = await this.#ensureTrace({
      runId: run.id,
      workspaceId,
      missionId: null,
      objective
    });
    if (trace && !run.traceId) {
      run =
        (await this.store.updateCompanyRun(run.id, {
          traceId: trace.id,
          updatedAt: nowIso()
        })) ?? run;
    }

    await this.#logStage(run.id, "planning.start", "Building company plan.", {}, { traceId: trace?.id });
    const planningSpan = await this.#startSpan({
      traceId: trace?.id,
      workspaceId,
      runId: run.id,
      name: "planning"
    });

    try {
      const rateGate = this.securityFabricService
        ? await this.securityFabricService.checkRateLimit({
          workspaceId,
          channelId: "company",
          cost: Math.max(1, Math.floor(objective.length / 40))
        })
        : { allowed: true };
      if (!rateGate.allowed) {
        throw this.#badRequest(`Security rate gate blocked execution: ${rateGate.reason}.`);
      }

      const plan = await this.architectureService.buildCompanyPlan({
        workspaceId,
        objective,
        teamSize,
        debateRounds,
        autoSpawnSubAgents: input.autoSpawnSubAgents !== false,
        autoGenerateSkills: input.autoGenerateSkills !== false,
        useLlmSkillDraft: input.useLlmSkillDraft === true,
        skillLlm: input.skillLlm
      });

      const mission = await this.missionService.createMission({
        workspaceId,
        title: safeString(input.title, objective.slice(0, 80)),
        objective,
        kpi: safeString(input.kpi, "Objective completed with verification and delivered artifacts."),
        deadline: safeString(input.deadline, buildDeadline(14)),
        budgetCap: Number.isFinite(Number(input.budgetCap)) ? Number(input.budgetCap) : null,
        policyPreset
      });
      await this.missionService.startMission(mission.id);

      run =
        (await this.store.updateCompanyRun(run.id, {
          status: COMPANY_STATUS.EXECUTING,
          missionId: mission.id,
          planId: plan.planId,
          mainAgentId: plan.mainAgent.id,
          updatedAt: nowIso()
        })) ?? run;

      await this.#endSpan(planningSpan, {
        workspaceId,
        runId: run.id,
        missionId: mission.id,
        status: "completed"
      });

      const escalation = this.#assessEscalationNeed({
        objective,
        plan
      });
      if (escalation.required && input.autoApproveEscalation !== true) {
        const paused = await this.#pauseForHuman({
          runId: run.id,
          workspaceId,
          objective,
          missionId: mission.id,
          plan,
          notifyTargets,
          maxRetries,
          policyPreset,
          reason: escalation.reason,
          details: escalation,
          traceId: trace?.id,
          stage: "pre_execution",
          nextWorkstreamIndex: 0,
          executionResults: [],
          runtimeEscalationPolicy
        });
        return paused;
      }

      const finalRun = await this.#executeRun({
        runId: run.id,
        workspaceId,
        objective,
        missionId: mission.id,
        plan,
        notifyTargets,
        maxRetries,
        traceId: trace?.id,
        runtimeEscalationPolicy,
        options: input
      });
      await this.#endTrace(trace?.id, {
        workspaceId,
        runId: run.id,
        missionId: mission.id,
        status: finalRun.status,
        summary: finalRun.summary
      });
      return finalRun;
    } catch (error) {
      await this.#endSpan(planningSpan, {
        workspaceId,
        runId: run.id,
        status: "failed",
        level: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      await this.#endTrace(trace?.id, {
        workspaceId,
        runId: run.id,
        status: "failed",
        level: "error",
        summary: error instanceof Error ? error.message : String(error)
      });
      const message = error instanceof Error ? error.message : String(error);
      const latestRun = (await this.store.getCompanyRunById(run.id)) ?? run;
      const failed = await this.store.updateCompanyRun(run.id, {
        status: COMPANY_STATUS.FAILED,
        updatedAt: nowIso(),
        completedAt: nowIso(),
        summary: `Company orchestration failed: ${message}`,
        errors: [...(Array.isArray(latestRun.errors) ? latestRun.errors : []), message]
      });
      await this.#logStage(run.id, "execution.failed", message, {}, { traceId: trace?.id });
      await this.#observe(
        "company.failed",
        "Company run failed.",
        {
          runId: run.id,
          objective,
          error: message
        },
        {
          workspaceId,
          traceId: trace?.id
        }
      );
      throw Object.assign(new Error(message), {
        statusCode: error?.statusCode ?? 500,
        run: failed
      });
    }
  }

  async resumeRun(runId, input = {}) {
    const normalizedRunId = safeString(runId);
    if (!normalizedRunId) {
      throw this.#badRequest("runId is required.");
    }
    const existing = await this.store.getCompanyRunById(normalizedRunId);
    if (!existing) {
      const error = new Error("Company run not found.");
      error.statusCode = 404;
      throw error;
    }
    if (existing.status !== COMPANY_STATUS.WAITING_HUMAN) {
      throw this.#badRequest("Only runs in waiting_human state can be resumed.");
    }

    const decision = normalizeDecision(input.decision ?? input.action);
    if (!decision) {
      throw this.#badRequest("decision must be approve or reject.");
    }

    const traceId = safeString(existing.traceId);
    const workspaceId = safeString(existing.workspaceId, "default");
    const missionId = safeString(existing.missionId) || null;
    const escalation = existing.pendingEscalation && typeof existing.pendingEscalation === "object"
      ? existing.pendingEscalation
      : {};
    const now = nowIso();

    if (decision === "reject") {
      const rejected = await this.store.updateCompanyRun(existing.id, {
        status: COMPANY_STATUS.FAILED,
        updatedAt: now,
        completedAt: now,
        summary: safeString(input.note, "Execution rejected by human approval gate."),
        pendingEscalation: {
          ...escalation,
          status: "rejected",
          resolvedAt: now,
          decisionNote: safeString(input.note)
        },
        resumeState: null
      });
      await this.#logStage(
        existing.id,
        "escalation.rejected",
        "Run rejected by human approver.",
        {
          note: safeString(input.note)
        },
        {
          traceId
        }
      );
      await this.#endTrace(traceId, {
        workspaceId,
        runId: existing.id,
        missionId,
        status: "rejected",
        summary: safeString(input.note, "Rejected by human approver.")
      });
      return rejected;
    }

    const resumeState = existing.resumeState && typeof existing.resumeState === "object" ? existing.resumeState : null;
    if (!resumeState) {
      throw this.#badRequest("Run does not have resume state.");
    }
    if (!resumeState.plan || typeof resumeState.plan !== "object") {
      throw this.#badRequest("Run resume state is missing plan.");
    }
    if (!safeString(resumeState.missionId)) {
      throw this.#badRequest("Run resume state is missing missionId.");
    }

    await this.store.updateCompanyRun(existing.id, {
      status: COMPANY_STATUS.EXECUTING,
      updatedAt: now,
      summary: safeString(input.note, "Resumed after human approval."),
      pendingEscalation: {
        ...escalation,
        status: "approved",
        resolvedAt: now,
        decisionNote: safeString(input.note)
      }
    });
    await this.#logStage(
      existing.id,
      "escalation.approved",
      "Run resumed by human approver.",
      {
        note: safeString(input.note)
      },
      {
        traceId
      }
    );

    const runtimeEscalationPolicy = this.#mergeRuntimeEscalationPolicy(
      resumeState.runtimeEscalationPolicy,
      input
    );
    const finalRun = await this.#executeRun({
      runId: existing.id,
      workspaceId: safeString(resumeState.workspaceId, workspaceId),
      objective: safeString(resumeState.objective, existing.objective),
      missionId: safeString(resumeState.missionId, existing.missionId),
      plan: resumeState.plan,
      notifyTargets: Array.isArray(resumeState.notifyTargets) ? resumeState.notifyTargets : [],
      maxRetries: clampInt(resumeState.maxRetries, 2, 1, 5),
      traceId,
      startWorkstreamIndex: clampInt(
        resumeState.nextWorkstreamIndex,
        0,
        0,
        Number.MAX_SAFE_INTEGER
      ),
      priorExecutionResults: Array.isArray(resumeState.executionResults)
        ? resumeState.executionResults
        : [],
      runtimeEscalationPolicy,
      options: input
    });
    await this.#endTrace(traceId, {
      workspaceId: finalRun.workspaceId,
      runId: finalRun.id,
      missionId: finalRun.missionId,
      status: finalRun.status,
      summary: finalRun.summary
    });
    return finalRun;
  }

  async #executeRun(input = {}) {
    const runId = safeString(input.runId);
    const run = await this.store.getCompanyRunById(runId);
    if (!run) {
      const error = new Error("Company run not found.");
      error.statusCode = 404;
      throw error;
    }

    const workspaceId = safeString(input.workspaceId, run.workspaceId || "default");
    const objective = safeString(input.objective, run.objective);
    const missionId = safeString(input.missionId, run.missionId);
    const plan = input.plan && typeof input.plan === "object" ? input.plan : null;
    if (!plan || !Array.isArray(plan.workstreams)) {
      throw this.#badRequest("plan with workstreams is required.");
    }
    if (!missionId) {
      throw this.#badRequest("missionId is required.");
    }
    const mission = await this.missionService.getMission(missionId);
    const missionBudgetCap = this.#resolveMissionBudgetCap(mission?.budgetCap);

    const notifyTargets = Array.isArray(input.notifyTargets) ? input.notifyTargets : [];
    const maxRetries = clampInt(input.maxRetries, 2, 1, 5);
    const traceId = safeString(input.traceId) || null;
    const options = input.options && typeof input.options === "object" ? input.options : {};
    const runtimeEscalationPolicy = this.#mergeRuntimeEscalationPolicy(
      input.runtimeEscalationPolicy,
      options
    );
    const workstreams = Array.isArray(plan.workstreams) ? plan.workstreams : [];
    const startWorkstreamIndex = clampInt(
      input.startWorkstreamIndex,
      0,
      0,
      Math.max(0, workstreams.length)
    );
    const executionResults = Array.isArray(input.priorExecutionResults)
      ? [...input.priorExecutionResults]
      : [];

    const executionSpan = await this.#startSpan({
      traceId,
      workspaceId,
      runId,
      missionId,
      name: "execution_loop"
    });

    for (let workstreamIndex = startWorkstreamIndex; workstreamIndex < workstreams.length; workstreamIndex += 1) {
      const stream = workstreams[workstreamIndex];
      const budgetGate = await this.#checkMissionBudget({
        workspaceId,
        missionId,
        runId,
        budgetCap: missionBudgetCap
      });
      if (!budgetGate.allowed) {
        const message = `Mission budget cap exceeded before workstream ${workstreamIndex + 1} (${safeString(stream.title, stream.id || "workstream")}). Spend ${budgetGate.usage.costUsd} / cap ${missionBudgetCap}.`;
        const failed = await this.store.updateCompanyRun(runId, {
          status: COMPANY_STATUS.FAILED,
          completedAt: nowIso(),
          updatedAt: nowIso(),
          summary: message,
          pendingEscalation: null,
          resumeState: null,
          result: {
            executionResults,
            successCount: executionResults.filter((item) => item.success).length,
            failureCount: executionResults.filter((item) => !item.success).length,
            budget: {
              capUsd: missionBudgetCap,
              spentUsd: budgetGate.usage.costUsd,
              tokenUsage: budgetGate.usage.tokenUsage
            }
          }
        });
        await this.#logStage(
          runId,
          "execution.budget_blocked",
          message,
          {
            missionId,
            budgetCap: missionBudgetCap,
            spentUsd: budgetGate.usage.costUsd,
            tokenUsage: budgetGate.usage.tokenUsage
          },
          {
            traceId,
            spanId: executionSpan?.id ?? null
          }
        );
        await this.#notifyTargets(
          notifyTargets,
          workspaceId,
          [
            "SOVEREIGN company run failed due to mission budget cap.",
            `Objective: ${objective}`,
            `Spent: ${budgetGate.usage.costUsd} USD / Cap: ${missionBudgetCap} USD`
          ].join("\n"),
          {
            runId,
            missionId,
            source: "company.budget_cap"
          }
        );
        await this.#endSpan(executionSpan, {
          traceId,
          workspaceId,
          runId,
          missionId,
          status: COMPANY_STATUS.FAILED,
          level: "warning",
          metadata: {
            reason: "budget_cap_exceeded",
            budgetCap: missionBudgetCap,
            spentUsd: budgetGate.usage.costUsd
          }
        });
        return failed;
      }

      const preExecutionEscalation = this.#assessRuntimeWorkstreamEscalation({
        objective,
        workstream: stream,
        workstreamIndex,
        runtimeEscalationPolicy
      });
      if (preExecutionEscalation.required && options.autoApproveEscalation !== true) {
        const paused = await this.#pauseForHuman({
          runId,
          workspaceId,
          objective,
          missionId,
          plan,
          notifyTargets,
          maxRetries,
          policyPreset: safeString(options.policyPreset, "balanced"),
          reason: preExecutionEscalation.reason,
          details: preExecutionEscalation,
          traceId,
          stage: "runtime_pre_workstream",
          nextWorkstreamIndex: workstreamIndex,
          executionResults,
          runtimeEscalationPolicy
        });
        await this.#endSpan(executionSpan, {
          traceId,
          workspaceId,
          runId,
          missionId,
          status: COMPANY_STATUS.WAITING_HUMAN,
          level: "warning"
        });
        return paused;
      }

      const streamSpan = await this.#startSpan({
        traceId,
        workspaceId,
        runId,
        missionId,
        parentSpanId: executionSpan?.id ?? null,
        name: `workstream:${safeString(stream.title || stream.id || "stream")}`
      });

      const task = await this.missionService.createTask(missionId, {
        title: `${stream.title}: ${stream.task}`,
        owner: stream.assignedAgentName ?? "unassigned",
        dueDate: buildDeadline(7)
      });

      let completed = false;
      let lastError = null;
      for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
          await this.missionService.updateTaskStatus(missionId, task.id, "in_progress");
          const councilInput = {
            problem: `${objective}\nWorkstream: ${stream.title}\nTask: ${stream.task}`,
            mainAgentId: plan.mainAgent.id,
            subAgentIds: stream.assignedAgentId ? [stream.assignedAgentId] : undefined,
            teamSize: stream.assignedAgentId ? undefined : 2,
            debateRounds: 1,
            allowWebResearch: true,
            autoSpawnSubAgents: true,
            autoGenerateSkills: true
          };
          const council = await this.#runCouncilQueued(missionId, councilInput);
          const consensus = clampNumber(council?.consensus?.consensusScore, 0, 0, 1);
          await this.missionService.updateTaskStatus(missionId, task.id, "done");
          const result = {
            taskId: task.id,
            workstreamId: stream.id,
            success: true,
            attempt,
            councilId: council.id,
            consensus
          };
          executionResults.push(result);

          const postCouncilEscalation = this.#assessRuntimeConsensusEscalation({
            objective,
            workstream: stream,
            workstreamIndex,
            result,
            runtimeEscalationPolicy
          });
          if (postCouncilEscalation.required && options.autoApproveEscalation !== true) {
            await this.#endSpan(streamSpan, {
              traceId,
              workspaceId,
              runId,
              missionId,
              status: COMPANY_STATUS.WAITING_HUMAN,
              level: "warning",
              metadata: {
                reason: postCouncilEscalation.reason
              }
            });
            const paused = await this.#pauseForHuman({
              runId,
              workspaceId,
              objective,
              missionId,
              plan,
              notifyTargets,
              maxRetries,
              policyPreset: safeString(options.policyPreset, "balanced"),
              reason: postCouncilEscalation.reason,
              details: postCouncilEscalation,
              traceId,
              stage: "runtime_post_council",
              nextWorkstreamIndex: workstreamIndex + 1,
              executionResults,
              runtimeEscalationPolicy
            });
            await this.#endSpan(executionSpan, {
              traceId,
              workspaceId,
              runId,
              missionId,
              status: COMPANY_STATUS.WAITING_HUMAN,
              level: "warning"
            });
            return paused;
          }

          completed = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          await this.#logStage(
            runId,
            "workstream.retry",
            `Retrying workstream ${stream.title}.`,
            {
              workstreamId: stream.id,
              attempt,
              error: lastError
            },
            {
              traceId,
              spanId: streamSpan?.id ?? null
            }
          );
        }
      }

      if (!completed) {
        await this.missionService.updateTaskStatus(missionId, task.id, "failed");
        executionResults.push({
          taskId: task.id,
          workstreamId: stream.id,
          success: false,
          error: lastError
        });
      }

      await this.#endSpan(streamSpan, {
        traceId,
        workspaceId,
        runId,
        missionId,
        status: completed ? "completed" : "failed",
        level: completed ? "info" : "error",
        error: completed ? "" : lastError
      });
    }

    const verificationSpan = await this.#startSpan({
      traceId,
      workspaceId,
      runId,
      missionId,
      parentSpanId: executionSpan?.id ?? null,
      name: "verification"
    });

    const sources = executionResults.map((item) => ({
      type: item.success ? "primary" : "web",
      stance: item.success ? "support" : "contradict",
      publishedAt: nowIso()
    }));
    const verification = this.verificationEngine.verifyClaim({
      claim: `Objective completed: ${objective}`,
      sources
    });
    await this.#endSpan(verificationSpan, {
      traceId,
      workspaceId,
      runId,
      missionId,
      status: verification.verdict
    });

    const successCount = executionResults.filter((item) => item.success).length;
    const failureCount = executionResults.length - successCount;
    const summary = `Completed ${successCount}/${executionResults.length} workstreams. Verification: ${verification.verdict}.`;

    let evaluation = null;
    const evalSpan = await this.#startSpan({
      traceId,
      workspaceId,
      runId,
      missionId,
      parentSpanId: executionSpan?.id ?? null,
      name: "evaluation"
    });
    if (this.evaluationService && typeof this.evaluationService.evaluateCompanyRun === "function") {
      evaluation = await this.evaluationService.evaluateCompanyRun({
        runId,
        workspaceId,
        objective,
        executionResults,
        verification,
        summary,
        traceId,
        useLlmJudge: options.useLlmJudge !== false,
        modelRef: safeString(options.evalModelRef),
        provider: safeString(options.evalProvider),
        passThreshold: options.evalPassThreshold
      });
    }
    await this.#endSpan(evalSpan, {
      traceId,
      workspaceId,
      runId,
      missionId,
      status: evaluation ? evaluation.grade : "skipped"
    });

    const finalStatus = failureCount === 0 ? COMPANY_STATUS.COMPLETED : COMPANY_STATUS.FAILED;
    const finalRun = await this.store.updateCompanyRun(runId, {
      status: finalStatus,
      completedAt: nowIso(),
      updatedAt: nowIso(),
      summary,
      verification,
      evaluation,
      pendingEscalation: null,
      resumeState: null,
      result: {
        executionResults,
        successCount,
        failureCount
      }
    });

    await this.#notifyTargets(
      notifyTargets,
      workspaceId,
      [`SOVEREIGN company run ${finalStatus}.`, `Objective: ${objective}`, summary].join("\n"),
      {
        runId,
        missionId,
        source: "company.execute"
      }
    );
    await this.#logStage(
      runId,
      "execution.done",
      summary,
      {
        missionId,
        verification,
        evaluation
      },
      {
        traceId,
        spanId: executionSpan?.id ?? null
      }
    );
    await this.#endSpan(executionSpan, {
      traceId,
      workspaceId,
      runId,
      missionId,
      status: finalStatus
    });
    return finalRun;
  }

  async #pauseForHuman(input = {}) {
    const runId = safeString(input.runId);
    const run = await this.store.getCompanyRunById(runId);
    if (!run) {
      throw this.#badRequest("run not found for escalation.");
    }

    const now = nowIso();
    const paused = await this.store.updateCompanyRun(run.id, {
      status: COMPANY_STATUS.WAITING_HUMAN,
      updatedAt: now,
      summary: `Waiting human approval: ${safeString(input.reason)}`,
      pendingEscalation: {
        id: makeId("esc"),
        stage: safeString(input.stage, "pre_execution"),
        reason: safeString(input.reason),
        details: input.details && typeof input.details === "object" ? input.details : {},
        status: "pending",
        createdAt: now
      },
      resumeState: {
        workspaceId: safeString(input.workspaceId, run.workspaceId),
        objective: safeString(input.objective, run.objective),
        missionId: safeString(input.missionId, run.missionId),
        maxRetries: clampInt(input.maxRetries, 2, 1, 5),
        policyPreset: safeString(input.policyPreset, "balanced"),
        nextWorkstreamIndex: clampInt(
          input.nextWorkstreamIndex,
          0,
          0,
          Number.MAX_SAFE_INTEGER
        ),
        executionResults: Array.isArray(input.executionResults) ? input.executionResults : [],
        runtimeEscalationPolicy:
          input.runtimeEscalationPolicy && typeof input.runtimeEscalationPolicy === "object"
            ? input.runtimeEscalationPolicy
            : null,
        notifyTargets: Array.isArray(input.notifyTargets) ? input.notifyTargets : [],
        plan: input.plan
      }
    });

    await this.#notifyTargets(
      Array.isArray(input.notifyTargets) ? input.notifyTargets : [],
      safeString(input.workspaceId, run.workspaceId),
      [
        "SOVEREIGN run paused for human approval.",
        `Objective: ${safeString(input.objective, run.objective)}`,
        `Reason: ${safeString(input.reason)}`
      ].join("\n"),
      {
        runId: run.id,
        missionId: safeString(input.missionId, run.missionId),
        source: "company.waiting_human"
      }
    );
    await this.#logStage(
      run.id,
      "execution.waiting_human",
      `Escalated for approval: ${safeString(input.reason)}`,
      {
        missionId: safeString(input.missionId),
        details: input.details ?? {}
      },
      {
        traceId: safeString(input.traceId)
      }
    );
    await this.#observe(
      "company.waiting_human",
      "Company run paused for human escalation.",
      {
        runId: run.id,
        reason: safeString(input.reason),
        details: input.details ?? {}
      },
      {
        workspaceId: safeString(input.workspaceId, run.workspaceId),
        traceId: safeString(input.traceId),
        missionId: safeString(input.missionId)
      }
    );
    return paused;
  }

  #assessEscalationNeed(input = {}) {
    const objective = safeString(input.objective).toLowerCase();
    const plan = input.plan && typeof input.plan === "object" ? input.plan : {};
    const workstreams = Array.isArray(plan.workstreams) ? plan.workstreams : [];

    const highRiskMatches = HIGH_RISK_HINTS.filter((hint) => objective.includes(hint));
    if (highRiskMatches.length > 0) {
      return {
        required: true,
        reason: "High-risk objective detected.",
        severity: "high",
        triggers: highRiskMatches
      };
    }

    const ambiguityMatches = AMBIGUOUS_HINTS.filter((hint) => objective.includes(hint));
    if (ambiguityMatches.length > 0) {
      return {
        required: true,
        reason: "Objective is ambiguous and requires clarification.",
        severity: "medium",
        triggers: ambiguityMatches
      };
    }

    if (workstreams.length === 0) {
      return {
        required: true,
        reason: "Planner returned no executable workstreams.",
        severity: "high",
        triggers: ["no_workstreams"]
      };
    }

    return {
      required: false,
      reason: "",
      severity: "none",
      triggers: []
    };
  }

  #buildRuntimeEscalationPolicy(input = {}) {
    const customRiskHints = normalizeStringArray(input.runtimeRiskHints);
    return {
      enabled: input.runtimeEscalationEnabled !== false,
      pauseOnHighRiskStream: input.runtimePauseOnHighRiskStream !== false,
      pauseOnLowConsensus: input.runtimePauseOnLowConsensus !== false,
      lowConsensusThreshold: clampNumber(input.runtimeLowConsensusThreshold, 0.6, 0, 1),
      riskHints: normalizeStringArray([...HIGH_RISK_HINTS, ...customRiskHints], 64)
    };
  }

  #mergeRuntimeEscalationPolicy(base, overrides = {}) {
    const source = base && typeof base === "object" ? base : {};
    const merged = {
      enabled: source.enabled !== false,
      pauseOnHighRiskStream: source.pauseOnHighRiskStream !== false,
      pauseOnLowConsensus: source.pauseOnLowConsensus !== false,
      lowConsensusThreshold: clampNumber(source.lowConsensusThreshold, 0.6, 0, 1),
      riskHints: normalizeStringArray(source.riskHints, 64)
    };

    if ("runtimeEscalationEnabled" in overrides) {
      merged.enabled = overrides.runtimeEscalationEnabled !== false;
    }
    if ("runtimePauseOnHighRiskStream" in overrides) {
      merged.pauseOnHighRiskStream = overrides.runtimePauseOnHighRiskStream !== false;
    }
    if ("runtimePauseOnLowConsensus" in overrides) {
      merged.pauseOnLowConsensus = overrides.runtimePauseOnLowConsensus !== false;
    }
    if ("runtimeLowConsensusThreshold" in overrides) {
      merged.lowConsensusThreshold = clampNumber(
        overrides.runtimeLowConsensusThreshold,
        merged.lowConsensusThreshold,
        0,
        1
      );
    }
    if ("runtimeRiskHints" in overrides) {
      merged.riskHints = normalizeStringArray(
        [...merged.riskHints, ...normalizeStringArray(overrides.runtimeRiskHints)],
        64
      );
    }
    return merged;
  }

  #assessRuntimeWorkstreamEscalation(input = {}) {
    const policy = input.runtimeEscalationPolicy && typeof input.runtimeEscalationPolicy === "object"
      ? input.runtimeEscalationPolicy
      : this.#buildRuntimeEscalationPolicy({});
    if (!policy.enabled || !policy.pauseOnHighRiskStream) {
      return {
        required: false,
        reason: "",
        severity: "none",
        triggers: []
      };
    }

    const workstream = input.workstream && typeof input.workstream === "object" ? input.workstream : {};
    const text = [
      safeString(input.objective).toLowerCase(),
      safeString(workstream.title).toLowerCase(),
      safeString(workstream.task).toLowerCase()
    ]
      .filter(Boolean)
      .join(" ");
    const defaultRuntimeHints = [
      "delete",
      "drop",
      "wipe",
      "revoke",
      "rotate credentials",
      "shutdown",
      "prod",
      "production",
      "billing",
      "transfer"
    ];
    const riskHints = normalizeStringArray([...(policy.riskHints ?? []), ...defaultRuntimeHints], 80);
    const matches = riskHints.filter((hint) => text.includes(hint));
    if (matches.length === 0) {
      return {
        required: false,
        reason: "",
        severity: "none",
        triggers: []
      };
    }
    return {
      required: true,
      reason: `High-risk runtime workstream requires approval before execution (${safeString(workstream.title, workstream.id || "workstream")}).`,
      severity: "high",
      triggers: matches.slice(0, 8),
      workstreamId: safeString(workstream.id),
      workstreamIndex: clampInt(input.workstreamIndex, 0, 0, Number.MAX_SAFE_INTEGER)
    };
  }

  #assessRuntimeConsensusEscalation(input = {}) {
    const policy = input.runtimeEscalationPolicy && typeof input.runtimeEscalationPolicy === "object"
      ? input.runtimeEscalationPolicy
      : this.#buildRuntimeEscalationPolicy({});
    if (!policy.enabled || !policy.pauseOnLowConsensus) {
      return {
        required: false,
        reason: "",
        severity: "none",
        triggers: []
      };
    }
    const result = input.result && typeof input.result === "object" ? input.result : {};
    const consensus = clampNumber(result.consensus, 0, 0, 1);
    if (consensus >= policy.lowConsensusThreshold) {
      return {
        required: false,
        reason: "",
        severity: "none",
        triggers: []
      };
    }
    const workstream = input.workstream && typeof input.workstream === "object" ? input.workstream : {};
    return {
      required: true,
      reason: `Low consensus (${consensus}) after council review; human check is required before continuing.`,
      severity: consensus < 0.4 ? "high" : "medium",
      triggers: ["low_consensus"],
      threshold: policy.lowConsensusThreshold,
      consensus,
      workstreamId: safeString(workstream.id),
      workstreamIndex: clampInt(input.workstreamIndex, 0, 0, Number.MAX_SAFE_INTEGER)
    };
  }

  async #ensureTrace(input = {}) {
    if (!this.observabilityService || typeof this.observabilityService.createTrace !== "function") {
      return null;
    }
    return this.observabilityService.createTrace({
      workspaceId: safeString(input.workspaceId, "default"),
      source: "company",
      name: "company.execute",
      runId: safeString(input.runId),
      missionId: safeString(input.missionId) || null,
      metadata: {
        objective: safeString(input.objective)
      }
    });
  }

  async #startSpan(input = {}) {
    if (!this.observabilityService || typeof this.observabilityService.startSpan !== "function") {
      return null;
    }
    const traceId = safeString(input.traceId);
    if (!traceId) {
      return null;
    }
    return this.observabilityService.startSpan({
      workspaceId: safeString(input.workspaceId, "default"),
      source: "company",
      traceId,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      parentSpanId: safeString(input.parentSpanId) || null,
      name: safeString(input.name, "span"),
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
    });
  }

  async #endSpan(span, input = {}) {
    if (!span || !this.observabilityService || typeof this.observabilityService.endSpan !== "function") {
      return null;
    }
    return this.observabilityService.endSpan({
      workspaceId: safeString(input.workspaceId, "default"),
      source: "company",
      traceId: safeString(input.traceId, span.traceId),
      spanId: safeString(input.spanId, span.id),
      parentSpanId: safeString(input.parentSpanId, span.parentSpanId),
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      name: safeString(input.name, span.name),
      status: safeString(input.status, "completed"),
      level: safeString(input.level, "info"),
      error: safeString(input.error),
      startedAt: span.startedAt,
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
    });
  }

  async #endTrace(traceId, input = {}) {
    if (!traceId || !this.observabilityService || typeof this.observabilityService.endTrace !== "function") {
      return null;
    }
    return this.observabilityService.endTrace({
      workspaceId: safeString(input.workspaceId, "default"),
      source: "company",
      traceId,
      runId: safeString(input.runId) || null,
      missionId: safeString(input.missionId) || null,
      status: safeString(input.status, "completed"),
      level: safeString(input.level, "info"),
      summary: safeString(input.summary)
    });
  }

  async #runCouncilQueued(missionId, input) {
    const executeCouncil = async () => {
      return this.#withTimeout(
        () => this.councilService.runCouncil(missionId, input),
        this.councilStepTimeoutMs,
        `company.council timeout after ${this.councilStepTimeoutMs}ms (mission ${missionId})`
      );
    };
    if (!this.commandQueue) {
      return executeCouncil();
    }
    const queued = await this.commandQueue.enqueue(
      {
        lane: `mission:${missionId}`,
        label: "company.council"
      },
      async () => executeCouncil()
    );
    return queued.value;
  }

  async #notifyTargets(targets, workspaceId, text, context = {}) {
    if (!this.channelGatewayService || !Array.isArray(targets) || targets.length === 0) {
      return;
    }
    for (const target of targets) {
      const channelId = safeString(target.channelId).toLowerCase();
      const chatId = safeString(target.chatId);
      if (!channelId || !chatId) {
        continue;
      }
      try {
        await this.channelGatewayService.sendProactiveMessage({
          channelId,
          workspaceId: safeString(target.workspaceId, workspaceId),
          chatId,
          userId: safeString(target.userId, "company"),
          text,
          metadata: {
            source: safeString(context.source, "company.execute")
          }
        });
      } catch (error) {
        if (
          this.notificationOutboxService &&
          typeof this.notificationOutboxService.enqueue === "function"
        ) {
          await this.notificationOutboxService.enqueue({
            workspaceId: safeString(target.workspaceId, workspaceId),
            channelId,
            chatId,
            userId: safeString(target.userId, "company"),
            text,
            metadata: {
              source: safeString(context.source, "company.execute"),
              runId: safeString(context.runId) || null,
              missionId: safeString(context.missionId) || null
            },
            runId: safeString(context.runId) || null,
            missionId: safeString(context.missionId) || null
          });
        }
        await this.#observe(
          "company.notify.failed",
          "Direct notification send failed; queued in outbox.",
          {
            channelId,
            chatId,
            error: error instanceof Error ? error.message : String(error)
          },
          {
            workspaceId: safeString(target.workspaceId, workspaceId),
            traceId: safeString(context.traceId),
            runId: safeString(context.runId) || null,
            missionId: safeString(context.missionId) || null
          }
        );
      }
    }
  }

  #resolveMissionBudgetCap(rawBudgetCap) {
    const parsed = Number(rawBudgetCap);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Number(parsed.toFixed(6));
  }

  async #checkMissionBudget(input = {}) {
    const budgetCap = this.#resolveMissionBudgetCap(input.budgetCap);
    if (!budgetCap) {
      return {
        allowed: true,
        usage: {
          costUsd: 0,
          tokenUsage: 0
        }
      };
    }
    const usage = await this.#computeMissionUsage({
      workspaceId: safeString(input.workspaceId, "default"),
      missionId: safeString(input.missionId),
      runId: safeString(input.runId)
    });
    return {
      allowed: usage.costUsd < budgetCap,
      usage
    };
  }

  async #computeMissionUsage(input = {}) {
    const workspaceId = safeString(input.workspaceId, "default");
    const missionId = safeString(input.missionId);
    const runId = safeString(input.runId);
    if (!missionId || !this.observabilityService) {
      return {
        costUsd: 0,
        tokenUsage: 0
      };
    }

    if (typeof this.observabilityService.getUsage === "function") {
      const usage = await this.observabilityService.getUsage({
        workspaceId,
        missionId,
        runId,
        source: "llm"
      });
      return {
        costUsd: Number(Number(usage?.costUsd ?? 0).toFixed(6)),
        tokenUsage: Math.max(0, Math.round(Number(usage?.tokenUsage ?? 0)))
      };
    }

    if (typeof this.observabilityService.listEvents !== "function") {
      return {
        costUsd: 0,
        tokenUsage: 0
      };
    }
    const events = await Promise.resolve(
      this.observabilityService.listEvents({
        workspaceId,
        missionId,
        runId,
        source: "llm",
        limit: 50000
      })
    );
    let costUsd = 0;
    let tokenUsage = 0;
    for (const event of events ?? []) {
      if (Number.isFinite(Number(event?.costUsd))) {
        costUsd += Math.max(0, Number(event.costUsd));
      }
      if (Number.isFinite(Number(event?.tokenUsage))) {
        tokenUsage += Math.max(0, Number(event.tokenUsage));
      }
    }
    return {
      costUsd: Number(costUsd.toFixed(6)),
      tokenUsage: Math.round(tokenUsage)
    };
  }

  async #withTimeout(run, timeoutMs, message) {
    const safeTimeout = clampInt(timeoutMs, 180000, 1000, 3600000);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const timeoutError = new Error(safeString(message, "Operation timed out."));
        timeoutError.statusCode = 504;
        timeoutError.code = "STEP_TIMEOUT";
        reject(timeoutError);
      }, safeTimeout);
      Promise.resolve()
        .then(run)
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  async #logStage(runId, stage, message, payload = {}, context = {}) {
    const run = await this.store.getCompanyRunById(runId);
    if (!run) {
      return;
    }
    const logs = Array.isArray(run.stageLogs) ? [...run.stageLogs] : [];
    logs.push({
      at: nowIso(),
      stage,
      message,
      payload,
      traceId: safeString(context.traceId, run.traceId),
      spanId: safeString(context.spanId)
    });
    await this.store.updateCompanyRun(runId, {
      stageLogs: logs,
      updatedAt: nowIso()
    });
    await this.#observe(
      `company.${stage}`,
      message,
      { runId, ...payload },
      {
        workspaceId: run.workspaceId,
        traceId: safeString(context.traceId, run.traceId),
        spanId: safeString(context.spanId),
        missionId: run.missionId
      }
    );
  }

  async #observe(type, message, payload, context = {}) {
    if (!this.observabilityService) {
      return;
    }
    await this.observabilityService.record({
      workspaceId: safeString(context.workspaceId, "default"),
      source: "company",
      type,
      message,
      payload,
      traceId: safeString(context.traceId) || null,
      spanId: safeString(context.spanId) || null,
      missionId: safeString(context.missionId) || null,
      runId: safeString(payload?.runId) || null
    });
  }

  #badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }
}
