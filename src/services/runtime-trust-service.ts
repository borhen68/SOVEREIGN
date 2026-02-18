// @ts-nocheck
import { makeId } from "../lib/id.js";
import { nowIso } from "../lib/time.js";
import { ActionType } from "../domain/constants.js";

const ALLOWED_POLICY_PRESETS = new Set(["strict", "balanced", "fast"]);
const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|token|secret|password|passwd|authorization|cookie|session|private[_-]?key|credential)/i;

const SENSITIVE_VALUE_PATTERNS = [
  /\bsk-[a-zA-Z0-9]{16,}\b/g,
  /\bxox[baprs]-[a-zA-Z0-9-]{16,}\b/g,
  /\bgh[pousr]_[a-zA-Z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g
];

const KEYWORDS = {
  [ActionType.DESTRUCTIVE]: [
    "delete",
    "destroy",
    "drop",
    "wipe",
    "truncate",
    "remove",
    "shutdown",
    "terminate"
  ],
  [ActionType.FINANCIAL]: [
    "pay",
    "charge",
    "invoice",
    "refund",
    "purchase",
    "transfer",
    "wire",
    "billing"
  ],
  [ActionType.EXTERNAL_SEND]: [
    "send",
    "email",
    "message",
    "notify",
    "publish",
    "post",
    "tweet",
    "dispatch"
  ],
  [ActionType.WRITE]: [
    "write",
    "create",
    "update",
    "edit",
    "save",
    "append",
    "patch",
    "commit"
  ]
};

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function safeString(value) {
  return String(value ?? "").trim();
}

function normalizePolicyPreset(value, fallback = "balanced") {
  const normalized = safeString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ALLOWED_POLICY_PRESETS.has(normalized) ? normalized : fallback;
}

function inferActionTypeFromText(text) {
  const normalized = safeString(text).toLowerCase();
  if (!normalized) {
    return null;
  }
  for (const actionType of [
    ActionType.DESTRUCTIVE,
    ActionType.FINANCIAL,
    ActionType.EXTERNAL_SEND,
    ActionType.WRITE
  ]) {
    if (KEYWORDS[actionType].some((keyword) => normalized.includes(keyword))) {
      return actionType;
    }
  }
  return null;
}

function normalizeActionType(value) {
  const raw = safeString(value).toLowerCase();
  if (!raw) {
    return "";
  }
  return Object.values(ActionType).includes(raw) ? raw : "";
}

function redactString(text) {
  let output = String(text ?? "");
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

function redactSecrets(value, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 6;
  const depth = Number.isInteger(options.depth) ? options.depth : 0;
  if (depth > maxDepth) {
    return "[TRUNCATED]";
  }

  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, { ...options, depth: depth + 1 }));
  }
  if (!isRecord(value)) {
    return safeString(value);
  }

  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactSecrets(nested, { ...options, depth: depth + 1 });
  }
  return out;
}

function truncateSnapshot(value, maxChars = 4000) {
  const serialized = JSON.stringify(value);
  if (!serialized) {
    return value;
  }
  if (serialized.length <= maxChars) {
    return value;
  }
  return {
    _truncated: true,
    _maxChars: maxChars,
    preview: serialized.slice(0, maxChars)
  };
}

function computeRiskSummary(actions) {
  const total = actions.length;
  const blocked = actions.filter((action) => action.status === "blocked").length;
  const failed = actions.filter((action) => action.status === "failed").length;
  const success = actions.filter((action) => action.status === "success").length;
  const allowedAttempts = actions.filter((action) => action.decision === "allowed").length;
  const successfulAllowed = actions.filter(
    (action) => action.decision === "allowed" && action.status === "success"
  ).length;
  const successRate = allowedAttempts ? Number(((successfulAllowed / allowedAttempts) * 100).toFixed(2)) : 0;
  const blockedRate = total ? Number(((blocked / total) * 100).toFixed(2)) : 0;

  return {
    total,
    allowed: allowedAttempts,
    blocked,
    failed,
    success,
    successRate,
    blockedRate
  };
}

export class RuntimeTrustService {
  constructor(options = {}) {
    this.store = options.store;
    this.policyEngine = options.policyEngine;
    this.missionService = options.missionService ?? null;
    this.clock = typeof options.clock === "function" ? options.clock : nowIso;
    this.defaultPolicyPreset = normalizePolicyPreset(options.defaultPolicyPreset, "balanced");
    this.maxSnapshotChars = Number.isFinite(Number(options.maxSnapshotChars))
      ? Math.max(500, Number(options.maxSnapshotChars))
      : 4000;
  }

  async listRuntimeActions(filters = {}) {
    return this.store.listRuntimeActions(filters);
  }

  async getRuntimeAction(actionId) {
    return this.store.getRuntimeActionById(actionId);
  }

  async getRuntimeMetrics(filters = {}) {
    const actions = await this.store.listRuntimeActions({
      workspaceId: filters.workspaceId,
      missionId: filters.missionId,
      actionType: filters.actionType,
      status: filters.status,
      decision: filters.decision,
      limit: Number(filters.limit ?? 1000)
    });
    return computeRiskSummary(actions);
  }

  async beforeInvoke(params) {
    if (!this.store || !this.policyEngine) {
      return {
        allowed: true,
        actionType: ActionType.READ,
        riskScore: 0,
        requiresApproval: false,
        runtimeActionId: null,
        missionActionId: null,
        approvalId: null
      };
    }

    const context = isRecord(params.context) ? params.context : {};
    const pluginId = safeString(params.pluginId || params.manifest?.id || "unknown-plugin");
    const toolName = safeString(params.tool?.name || "unknown-tool");
    const actionType = this.#resolveActionType({
      context,
      tool: params.tool,
      manifest: params.manifest
    });
    const policyPreset = normalizePolicyPreset(context.policyPreset, this.defaultPolicyPreset);
    const summary =
      safeString(context.summary) || `Plugin tool ${pluginId}.${toolName} requested ${actionType}.`;
    const inputSnapshot = truncateSnapshot(
      redactSecrets(params.input ?? {}, { maxDepth: 6 }),
      this.maxSnapshotChars
    );

    let riskScore = 0;
    let requiresApproval = false;
    let approvalReason = "";
    let missionActionId = null;
    let approvalId = null;
    let allowed = true;
    let source = safeString(context.source) || "plugin.invoke";
    const createdAt = this.clock();

    if (this.missionService && context.missionId) {
      try {
        const recorded = await this.missionService.recordAction(String(context.missionId), {
          taskId: context.taskId ? String(context.taskId) : null,
          actionType,
          summary,
          payload: {
            source,
            pluginId,
            toolName,
            input: inputSnapshot
          },
          idempotencyKey: context.idempotencyKey ? String(context.idempotencyKey) : null,
          additionalRiskDelta: Number(context.additionalRiskDelta ?? 0)
        });
        riskScore = Number(recorded.action?.riskScore ?? 0);
        requiresApproval = Boolean(recorded.approval);
        approvalReason = safeString(recorded.action?.approvalReason);
        missionActionId = recorded.action?.id ?? null;
        approvalId = recorded.approval?.id ?? null;
        if (requiresApproval) {
          allowed = false;
          source = `${source}.approval_required`;
        }
      } catch (error) {
        // Fall back to local policy evaluation if mission context is invalid.
        const decision = this.policyEngine.evaluateAction({
          actionType,
          policyPreset,
          additionalRiskDelta: Number(context.additionalRiskDelta ?? 0)
        });
        riskScore = decision.riskScore;
        requiresApproval = decision.requiresApproval;
        approvalReason = decision.reason;
        allowed = !requiresApproval;
      }
    } else {
      const decision = this.policyEngine.evaluateAction({
        actionType,
        policyPreset,
        additionalRiskDelta: Number(context.additionalRiskDelta ?? 0)
      });
      riskScore = decision.riskScore;
      requiresApproval = decision.requiresApproval;
      approvalReason = decision.reason;
      allowed = !requiresApproval || context.bypassApproval === true;
    }

    const runtimeAction = await this.store.createRuntimeAction({
      id: makeId("runtime"),
      pluginId,
      toolName,
      actionType,
      source,
      summary,
      workspaceId: safeString(context.workspaceId) || "default",
      missionId: context.missionId ? String(context.missionId) : null,
      taskId: context.taskId ? String(context.taskId) : null,
      sessionId: context.sessionId ? String(context.sessionId) : null,
      userId: context.userId ? String(context.userId) : null,
      policyPreset,
      riskScore,
      requiresApproval,
      approvalReason,
      approvalId,
      missionActionId,
      decision: allowed ? "allowed" : "blocked",
      status: allowed ? "pending" : "blocked",
      inputSnapshot,
      outputSnapshot: null,
      error: null,
      createdAt,
      updatedAt: createdAt,
      startedAt: createdAt,
      finishedAt: allowed ? null : createdAt
    });

    return {
      allowed,
      actionType,
      riskScore,
      requiresApproval,
      approvalReason,
      runtimeActionId: runtimeAction.id,
      missionActionId,
      approvalId
    };
  }

  async afterInvoke(params) {
    if (!params?.gate?.runtimeActionId || !this.store) {
      return null;
    }
    const runtimeActionId = params.gate.runtimeActionId;
    const updatedAt = this.clock();

    if (params.error) {
      return this.store.updateRuntimeAction(runtimeActionId, {
        status: "failed",
        error: safeString(params.error?.message || params.error),
        updatedAt,
        finishedAt: updatedAt
      });
    }

    const outputSnapshot = truncateSnapshot(
      redactSecrets(clone(params.result), { maxDepth: 6 }),
      this.maxSnapshotChars
    );
    return this.store.updateRuntimeAction(runtimeActionId, {
      status: "success",
      outputSnapshot,
      updatedAt,
      finishedAt: updatedAt
    });
  }

  #resolveActionType(params) {
    const explicit = normalizeActionType(params.context?.actionType);
    if (explicit) {
      return explicit;
    }

    const declared = normalizeActionType(params.tool?.actionType);
    if (declared) {
      return declared;
    }

    const keywordScan = inferActionTypeFromText(
      `${safeString(params.tool?.name)} ${safeString(params.tool?.description)}`
    );
    if (keywordScan) {
      return keywordScan;
    }

    const permissions = isRecord(params.manifest?.permissions) ? params.manifest.permissions : {};
    if (permissions.destructive === true) {
      return ActionType.DESTRUCTIVE;
    }
    if (permissions.financial === true) {
      return ActionType.FINANCIAL;
    }
    if (permissions.network === true) {
      return ActionType.EXTERNAL_SEND;
    }
    if (permissions.filesystem === true) {
      return ActionType.WRITE;
    }
    return ActionType.READ;
  }
}
