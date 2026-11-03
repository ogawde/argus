export const RUN_STATUSES = [
  "DRAFT",
  "PLANNING",
  "FLAGGED",
  "READY",
  "APPROVED",
  "APPLYING",
  "RECONCILED",
  "REJECTED",
  "FAILED",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  DRAFT: ["PLANNING", "REJECTED"],
  PLANNING: ["FLAGGED", "READY", "FAILED"],
  FLAGGED: ["READY", "REJECTED"],
  READY: ["FLAGGED", "APPROVED", "REJECTED"],
  APPROVED: ["READY", "DRAFT", "APPLYING", "REJECTED"],
  APPLYING: ["RECONCILED", "FAILED"],
  RECONCILED: [],
  REJECTED: [],
  FAILED: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type Role = "PREPARER" | "APPROVER";

export interface Actor {
  id: string;
  role: Role;
}

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  "RECONCILED",
  "REJECTED",
  "FAILED",
];

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
