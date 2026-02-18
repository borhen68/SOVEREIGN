
export const MissionStatus = Object.freeze({
  DRAFT: "draft",
  SIMULATING: "simulating",
  EXECUTING: "executing",
  PAUSED: "paused",
  COMPLETED: "completed",
  BLOCKED: "blocked",
  CANCELLED: "cancelled"
});

export const TaskStatus = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped"
});

export const ApprovalStatus = Object.freeze({
  REQUESTED: "requested",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired"
});

export const ActionType = Object.freeze({
  READ: "read",
  WRITE: "write",
  EXTERNAL_SEND: "external_send",
  FINANCIAL: "financial",
  DESTRUCTIVE: "destructive"
});

export const ActionState = Object.freeze({
  PENDING_APPROVAL: "pending_approval",
  EXECUTED: "executed",
  BLOCKED: "blocked",
  FAILED: "failed"
});

export const AgentRole = Object.freeze({
  MAIN: "main",
  SUB: "sub"
});

export const CouncilStatus = Object.freeze({
  COMPLETED: "completed"
});

export const CouncilRunStatus = Object.freeze({
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
});
