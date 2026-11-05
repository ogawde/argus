import { z } from "zod";

/**
 * Shape of GET /api/runs/[id]/studio-data.
 * One JSON document with everything the review dashboard needs, so the
 * client island never has to join tables itself.
 */

/** Whole-batch flags (BATCH_TOTAL_DEVIATION) use this line id. */
export const BATCH_LINE_ID = "__BATCH__";

export const SeveritySchema = z.enum(["INFO", "WARN", "CRITICAL"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const RUN_STATUS_VALUES = [
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
export const RunStatusSchema = z.enum(RUN_STATUS_VALUES);

export const EvidenceItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const RationaleSchema = z.object({
  summary: z.string(),
  assessment: z.string().optional(),
  citedEvidenceKeys: z.array(z.string()).default([]),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  generatedAt: z.string().optional(),
  unverifiedCitations: z.boolean().optional(),
});
export type RationaleView = z.infer<typeof RationaleSchema>;

export const DispositionViewSchema = z.object({
  lineId: z.string(),
  ruleId: z.string(),
  action: z.enum(["ACCEPTED", "EXCLUDED"]),
  reason: z.string(),
  actorId: z.string(),
  at: z.string(),
});
export type DispositionView = z.infer<typeof DispositionViewSchema>;

/** The established payee an ENTITY_MATCH flag points at. */
export const MatchedPayeeSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  legalName: z.string(),
  destination: z.string(),
  country: z.string().nullable(),
  createdAt: z.string(),
  paymentCount: z.number().int(),
  lastPaidAt: z.string().nullable(),
  lastAmountMinor: z.number().int().nullable(),
});
export type MatchedPayee = z.infer<typeof MatchedPayeeSchema>;

export const LineMarkerSchema = z.enum(["added", "removed", "changed", "same"]);
export type LineMarker = z.infer<typeof LineMarkerSchema>;

export const StudioLineSchema = z.object({
  lineId: z.string(),
  sourceRow: z.number().int(),
  payeeRef: z.string(),
  payeeId: z.string().nullable(),
  displayName: z.string(),
  destination: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  note: z.string(),
  include: z.boolean(),
  isNewPayee: z.boolean(),
  /** Payee's most recent historical payout (same currency), if any */
  lastAmountMinor: z.number().int().nullable(),
  /** amount − lastAmount, null when there is no history */
  deltaMinor: z.number().int().nullable(),
  /** + new payee, − excluded from this plan, ~ amount differs from last payout */
  marker: LineMarkerSchema,
});
export type StudioLine = z.infer<typeof StudioLineSchema>;

export const StudioFlagSchema = z.object({
  id: z.string(),
  lineId: z.string(),
  ruleId: z.string(),
  severity: SeveritySchema,
  blocking: z.boolean(),
  evidence: z.array(EvidenceItemSchema),
  relatedLineIds: z.array(z.string()),
  rationale: RationaleSchema.nullable(),
  disposition: DispositionViewSchema.nullable(),
  matchedPayee: MatchedPayeeSchema.nullable(),
});
export type StudioFlag = z.infer<typeof StudioFlagSchema>;

export const StepStateSchema = z.enum(["done", "current", "upcoming", "failed"]);
export const StepSchema = z.object({
  key: z.string(),
  label: z.string(),
  state: StepStateSchema,
});
export type Step = z.infer<typeof StepSchema>;

export const KpiSchema = z.object({
  currency: z.string(),
  lineCount: z.number().int(),
  includedCount: z.number().int(),
  excludedCount: z.number().int(),
  includedMinor: z.number().int(),
  flagged: z.object({
    INFO: z.number().int(),
    WARN: z.number().int(),
    CRITICAL: z.number().int(),
    total: z.number().int(),
    distinctLines: z.number().int(),
    open: z.number().int(),
    openBlocking: z.number().int(),
    openWarnings: z.number().int(),
  }),
  lastCycle: z
    .object({
      batchRef: z.string(),
      lineCount: z.number().int(),
      totalMinor: z.number().int(),
    })
    .nullable(),
  deltaVsLastCycleMinor: z.number().int().nullable(),
  deltaVsLastCyclePct: z.number().nullable(),
});
export type Kpis = z.infer<typeof KpiSchema>;

export const DiffLineViewSchema = z.object({
  payeeRef: z.string(),
  kind: z.enum(["added", "removed", "changed"]),
  displayName: z.string(),
  beforeMinor: z.number().int().nullable(),
  afterMinor: z.number().int().nullable(),
  deltaMinor: z.number().int(),
});
export type DiffLineView = z.infer<typeof DiffLineViewSchema>;

export const PlanDiffSchema = z.object({
  /** Previous plan revision of this run (null for the first revision) */
  parentHash: z.string().nullable(),
  added: z.number().int(),
  removed: z.number().int(),
  changed: z.number().int(),
  deltaIncludedCount: z.number().int(),
  deltaIncludedMinor: z.number().int(),
  lines: z.array(DiffLineViewSchema),
});
export type PlanDiff = z.infer<typeof PlanDiffSchema>;

export const VelocityPointSchema = z.object({
  weekStart: z.string(),
  count: z.number().int(),
  totalMinor: z.number().int(),
  inBurst: z.boolean(),
});

export const VelocitySeriesSchema = z.object({
  payeeId: z.string(),
  name: z.string(),
  burstStart: z.string(),
  cycleStart: z.string(),
  points: z.array(VelocityPointSchema),
});
export type VelocitySeries = z.infer<typeof VelocitySeriesSchema>;

export const ReconciliationItemSchema = z.object({
  lineId: z.string(),
  plannedMinor: z.number().int(),
  actualMinor: z.number().int().nullable(),
  status: z.string(),
});

export const ReconciliationSchema = z.object({
  state: z.enum(["NOT_STARTED", "IN_PROGRESS", "DONE"]),
  outcome: z.string().nullable(),
  items: z.array(ReconciliationItemSchema),
  note: z.string(),
});

export const ViewerSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["PREPARER", "APPROVER"]),
});
export type Viewer = z.infer<typeof ViewerSchema>;

export const PermissionsSchema = z.object({
  canStartPlanning: z.boolean(),
  canEditFlags: z.boolean(),
  canApprove: z.boolean(),
  /** Why the approve button is disabled (null when it is enabled) */
  approveBlockedReason: z.string().nullable(),
  canRevoke: z.boolean(),
  canReject: z.boolean(),
  canApply: z.boolean(),
});
export type Permissions = z.infer<typeof PermissionsSchema>;

export const RevisionViewSchema = z.object({
  hash: z.string(),
  parentHash: z.string().nullable(),
  createdById: z.string(),
  createdAt: z.string(),
});

export const StudioDataSchema = z.object({
  generatedAt: z.string(),
  run: z.object({
    id: z.string(),
    status: RunStatusSchema,
    filename: z.string(),
    cycleDate: z.string(),
    preparedById: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    sourceSha256: z.string(),
    lastError: z.string().nullable(),
  }),
  planHash: z.string().nullable(),
  planMeta: z
    .object({
      policyVersion: z.string(),
      payeeMasterVersion: z.number().int(),
      historyWatermark: z.string(),
      engineVersions: z
        .object({ policy: z.string(), erWeights: z.string(), esMapping: z.string() })
        .nullable(),
    })
    .nullable(),
  viewer: ViewerSchema.nullable(),
  permissions: PermissionsSchema,
  stepper: z.array(StepSchema),
  kpis: KpiSchema,
  lines: z.array(StudioLineSchema),
  flags: z.array(StudioFlagSchema),
  dispositions: z.array(DispositionViewSchema),
  approval: z
    .object({ approverId: z.string(), planHash: z.string(), at: z.string() })
    .nullable(),
  planDiff: PlanDiffSchema,
  revisions: z.array(RevisionViewSchema),
  velocitySeries: z.record(z.string(), VelocitySeriesSchema),
  esql: z.object({ velocity: z.string(), sharedDestination: z.string() }),
  reconciliation: ReconciliationSchema,
  rationaleCount: z.number().int(),
  llmMode: z.string(),
});

export type StudioData = z.infer<typeof StudioDataSchema>;
