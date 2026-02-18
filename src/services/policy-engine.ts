// @ts-nocheck
import { ActionType } from "../domain/constants.js";

const BASE_RISK_BY_ACTION = {
  [ActionType.READ]: 10,
  [ActionType.WRITE]: 35,
  [ActionType.EXTERNAL_SEND]: 65,
  [ActionType.FINANCIAL]: 85,
  [ActionType.DESTRUCTIVE]: 95
};

const POLICY_PRESETS = {
  strict: { delta: 10, autoApproveThreshold: 45 },
  balanced: { delta: 0, autoApproveThreshold: 60 },
  fast: { delta: -10, autoApproveThreshold: 70 }
};

function clampRisk(score) {
  return Math.max(0, Math.min(100, score));
}

export class PolicyEngine {
  evaluateAction(input) {
    const actionType = input.actionType;
    const policyPreset = POLICY_PRESETS[input.policyPreset] ?? POLICY_PRESETS.balanced;
    const baseRisk = BASE_RISK_BY_ACTION[actionType] ?? 50;
    const score = clampRisk(baseRisk + policyPreset.delta + (input.additionalRiskDelta ?? 0));

    const hardApprovalActions = new Set([ActionType.FINANCIAL, ActionType.DESTRUCTIVE]);
    const requiresApproval =
      hardApprovalActions.has(actionType) || score >= policyPreset.autoApproveThreshold;

    return {
      riskScore: score,
      requiresApproval,
      approvalLevel: requiresApproval ? "user" : "none",
      reason: this.#reasonForDecision(actionType, score, requiresApproval, policyPreset.autoApproveThreshold)
    };
  }

  #reasonForDecision(actionType, score, requiresApproval, threshold) {
    if (!requiresApproval) {
      return `Risk score ${score} is below policy threshold ${threshold}.`;
    }
    if (actionType === ActionType.FINANCIAL) {
      return "Financial actions always require explicit approval.";
    }
    if (actionType === ActionType.DESTRUCTIVE) {
      return "Destructive actions always require explicit approval.";
    }
    return `Risk score ${score} is at or above policy threshold ${threshold}.`;
  }
}

export function isValidActionType(actionType) {
  return Object.values(ActionType).includes(actionType);
}
