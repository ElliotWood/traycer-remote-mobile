import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";

/** One realistic, schema-valid entry per actionable kind — used across the detector/payload/presentation tests. */
export const APPROVAL_ENTRY: HostNotificationEntry = {
  id: "approval.requested:chat-1",
  updatedAt: 1_000,
  readAt: null,
  sourceRef: "appr-1",
  severity: "needs_action",
  epicId: "epic-1",
  chatId: "chat-1",
  kind: "approval.requested",
  outcome: null,
  resolvedAt: null,
  payload: {
    kind: "approval",
    epicId: "epic-1",
    chatId: "chat-1",
    chatTitle: "Refactor auth",
    taskTitle: "Ship the refactor",
    approvalId: "appr-1",
  },
};

export const INTERVIEW_ENTRY: HostNotificationEntry = {
  id: "interview.requested:chat-2",
  updatedAt: 1_000,
  readAt: null,
  sourceRef: "iv-1",
  severity: "needs_action",
  epicId: "epic-1",
  chatId: "chat-2",
  kind: "interview.requested",
  outcome: null,
  resolvedAt: null,
  payload: {
    kind: "interview",
    epicId: "epic-1",
    chatId: "chat-2",
    chatTitle: "Design review",
    taskTitle: "Pick an approach",
    interviewBlockId: "iv-1",
  },
};

export const STALLED_ENTRY: HostNotificationEntry = {
  id: "stall-1",
  updatedAt: 1_000,
  readAt: null,
  sourceRef: null,
  severity: "failure",
  epicId: "epic-1",
  chatId: "chat-3",
  kind: "agent.stalled",
  outcome: "errored",
  payload: {
    kind: "agent_stalled",
    epicId: "epic-1",
    chatId: "chat-3",
    agentId: "agent-1",
    agentName: "Agent X",
    taskTitle: "Migrate the schema",
    reason: "provider_buffering",
    title: "Stalled",
    outcome: "errored",
  },
};

export const STOPPED_ENTRY: HostNotificationEntry = {
  id: "stop-1",
  updatedAt: 1_000,
  readAt: null,
  sourceRef: null,
  severity: "failure",
  epicId: "epic-1",
  chatId: "chat-4",
  kind: "agent.stopped",
  outcome: "errored",
  payload: {
    outcome: "errored",
    kind: "chat",
    epicId: "epic-1",
    chatId: "chat-4",
    agentName: "Agent X",
    taskTitle: "Fix the bug",
    code: "auth",
  },
};

export const STOPPED_DONE_ENTRY: HostNotificationEntry = {
  ...STOPPED_ENTRY,
  id: "stop-2",
  severity: "done",
  outcome: "completed",
  payload: { ...STOPPED_ENTRY.payload, outcome: "completed" },
};

export const WORKSPACE_FAILED_ENTRY: HostNotificationEntry = {
  id: "workspace-1",
  updatedAt: 1_000,
  readAt: null,
  sourceRef: null,
  severity: "failure",
  epicId: "epic-1",
  chatId: "chat-5",
  kind: "workspace.operation.failed",
  outcome: "errored",
  payload: {
    kind: "workspace_operation_failed",
    epicId: "epic-1",
    chatId: "chat-5",
    chatTitle: "Worktree setup",
    taskTitle: "Provision worktree",
    operation: "provision",
    title: "Worktree creation failed",
    message: "git worktree add failed",
    outcome: "errored",
  },
};

export const ALL_ACTIONABLE_ENTRIES = [
  APPROVAL_ENTRY,
  INTERVIEW_ENTRY,
  STALLED_ENTRY,
  STOPPED_ENTRY,
  WORKSPACE_FAILED_ENTRY,
];
