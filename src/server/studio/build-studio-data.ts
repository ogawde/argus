import { diffPlans } from "@/domain/diff";
import { AnalysisSchema, PlanFileSchema, type PlanFile, type PlanLine } from "@/domain/plan";
import { loadPolicy } from "@/domain/policy";
import { velocityWindows } from "@/domain/rules/velocity-spike";
import type { RunStatus } from "@/domain/state";
import {
  StudioDataSchema,
  type DiffLineView,
  type DispositionView,
  type Kpis,
  type MatchedPayee,
  type Permissions,
  type PlanDiff,
  type RationaleView,
  type Severity,
  type Step,
  type StudioData,
  type StudioFlag,
  type StudioLine,
  type VelocitySeries,
  type Viewer,
} from "@/domain/studio-data";
import { getEnv } from "@/lib/env";
import { getCurrentPersona } from "@/server/auth/demo";
import { prisma } from "@/server/db";
import { ESQL_BURST_QUERY, ESQL_SHARED_QUERY } from "@/server/elastic/esql";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const VELOCITY_WEEKS = 26;
const MAX_VELOCITY_PAYEES = 60;

// ---- small pure helpers (easy to read, no database) -------------------------

function zeroKpiFlagged(): Kpis["flagged"] {
  return {
    INFO: 0,
    WARN: 0,
    CRITICAL: 0,
    total: 0,
    distinctLines: 0,
    open: 0,
    openBlocking: 0,
    openWarnings: 0,
  };
}

/** Steps shown in the stepper. The third step is FLAGGED or READY depending on the run. */
export function buildStepper(status: RunStatus): Step[] {
  const reviewLabel = status === "FLAGGED" ? "Flagged" : "Ready";
  const order = ["DRAFT", "PLANNING", "REVIEW", "APPROVED", "APPLYING", "RECONCILED"] as const;
  const labels: Record<(typeof order)[number], string> = {
    DRAFT: "Draft",
    PLANNING: "Planning",
    REVIEW: reviewLabel,
    APPROVED: "Approved",
    APPLYING: "Applying",
    RECONCILED: "Reconciled",
  };

  // where the run is on the track (REJECTED / FAILED stop where they happened)
  const position: Record<RunStatus, number> = {
    DRAFT: 0,
    PLANNING: 1,
    FLAGGED: 2,
    READY: 2,
    APPROVED: 3,
    APPLYING: 4,
    RECONCILED: 5,
    REJECTED: 2,
    FAILED: 1,
  };
  const current = position[status];
  const isStopped = status === "REJECTED" || status === "FAILED";

  const steps: Step[] = order.map((key, index) => {
    if (index < current) return { key, label: labels[key], state: "done" };
    if (index === current) {
      if (isStopped) return { key, label: labels[key], state: "failed" };
      // a finished run is "done", everything else is where we are now
      return { key, label: labels[key], state: status === "RECONCILED" ? "done" : "current" };
    }
    return { key, label: labels[key], state: "upcoming" };
  });

  if (status === "REJECTED") steps[2] = { key: "REVIEW", label: "Rejected", state: "failed" };
  if (status === "FAILED") steps[1] = { key: "PLANNING", label: "Failed", state: "failed" };
  return steps;
}

function shortName(viewer: Viewer): string {
  return viewer.name.split(" ")[0] ?? viewer.id;
}

export function buildPermissions(args: {
  viewer: Viewer | null;
  status: RunStatus;
  preparedById: string;
  openBlocking: number;
}): Permissions {
  const { viewer, status, preparedById, openBlocking } = args;
  const canEditFlags = (status === "FLAGGED" || status === "READY") && viewer !== null;

  let approveBlockedReason: string | null = null;
  if (!viewer) approveBlockedReason = "Sign in as a demo persona to approve.";
  else if (viewer.id === preparedById) {
    approveBlockedReason = `Four-eyes rule: ${shortName(viewer)} prepared this run, so a different approver has to sign it off.`;
  } else if (viewer.role !== "APPROVER") {
    approveBlockedReason = "Only an approver can approve a plan.";
  } else if (status === "FLAGGED") {
    approveBlockedReason = `${openBlocking} blocking flag${openBlocking === 1 ? "" : "s"} still need a decision.`;
  } else if (status !== "READY") {
    approveBlockedReason = `The run is ${status}; approval only opens when it is READY.`;
  }

  const canApprove = approveBlockedReason === null;
  const isApprover = viewer?.role === "APPROVER";
  return {
    canStartPlanning: status === "DRAFT" && viewer?.role === "PREPARER",
    canEditFlags,
    canApprove,
    approveBlockedReason,
    canRevoke: status === "APPROVED" && isApprover,
    canReject: ["DRAFT", "FLAGGED", "READY", "APPROVED"].includes(status) && viewer !== null,
    canApply:
      (status === "APPROVED" || status === "APPLYING") &&
      isApprover &&
      viewer?.id !== preparedById,
  };
}

function toRationale(raw: unknown): RationaleView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.summary !== "string") return null;
  return {
    summary: r.summary,
    assessment: typeof r.assessment === "string" ? r.assessment : undefined,
    citedEvidenceKeys: Array.isArray(r.citedEvidenceKeys)
      ? r.citedEvidenceKeys.filter((k): k is string => typeof k === "string")
      : [],
    model: typeof r.model === "string" ? r.model : undefined,
    promptVersion: typeof r.promptVersion === "string" ? r.promptVersion : undefined,
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : undefined,
    unverifiedCitations: typeof r.unverifiedCitations === "boolean" ? r.unverifiedCitations : undefined,
  };
}

function lineMarker(line: PlanLine, lastAmountMinor: number | null): StudioLine["marker"] {
  if (!line.include) return "removed";
  if (!line.payeeId) return "added";
  if (lastAmountMinor !== null && lastAmountMinor !== line.amount.minor) return "changed";
  return "same";
}

const EMPTY_DIFF: PlanDiff = {
  parentHash: null,
  added: 0,
  removed: 0,
  changed: 0,
  deltaIncludedCount: 0,
  deltaIncludedMinor: 0,
  lines: [],
};

/**
 * Diff of included lines: previous revision of this run → current revision.
 * diffPlans() keys on payeeRef, so we hand it lineId as the key. That way two lines for the
 * same payee (a duplicate row) show up as separate +/− entries.
 */
export function buildPlanDiff(previous: PlanFile | null, current: PlanFile): PlanDiff {
  if (!previous) return EMPTY_DIFF;

  const byLineId = new Map<string, PlanLine>();
  for (const line of [...previous.lines, ...current.lines]) byLineId.set(line.lineId, line);

  const keyed = (plan: PlanFile) =>
    plan.lines.filter((l) => l.include).map((l) => ({ ...l, payeeRef: l.lineId }));
  const diff = diffPlans(keyed(previous), keyed(current)).filter((d) => d.kind !== "unchanged");

  const lines: DiffLineView[] = diff.map((d) => {
    const line = byLineId.get(d.payeeRef);
    const kind = d.kind as "added" | "removed" | "changed";
    return {
      payeeRef: line?.payeeRef ?? d.payeeRef,
      kind,
      displayName: line?.displayName ?? d.payeeRef,
      beforeMinor: d.before?.amountMinor ?? null,
      afterMinor: d.after?.amountMinor ?? null,
      deltaMinor:
        kind === "added"
          ? (d.after?.amountMinor ?? 0)
          : kind === "removed"
            ? -(d.before?.amountMinor ?? 0)
            : (d.deltaMinor ?? 0),
    };
  });

  return {
    parentHash: current.parentHash,
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
    changed: lines.filter((l) => l.kind === "changed").length,
    deltaIncludedCount: current.totals.includedCount - previous.totals.includedCount,
    deltaIncludedMinor: current.totals.includedMinor - previous.totals.includedMinor,
    lines,
  };
}

/** Weekly payout counts for one payee, ending at the cycle date. Zero weeks are kept so the chart has no gaps. */
export function buildVelocityPoints(args: {
  paidAt: Date[];
  amountMinor: number[];
  cycleDate: Date;
  burstStart: Date;
}): VelocitySeries["points"] {
  const { paidAt, amountMinor, cycleDate, burstStart } = args;
  const firstWeek = cycleDate.getTime() - VELOCITY_WEEKS * WEEK_MS;
  const counts = new Array<number>(VELOCITY_WEEKS).fill(0);
  const totals = new Array<number>(VELOCITY_WEEKS).fill(0);

  paidAt.forEach((date, i) => {
    const index = Math.floor((date.getTime() - firstWeek) / WEEK_MS);
    if (index < 0 || index >= VELOCITY_WEEKS) return;
    counts[index] = (counts[index] ?? 0) + 1;
    totals[index] = (totals[index] ?? 0) + (amountMinor[i] ?? 0);
  });

  return counts.map((count, index) => {
    const weekStartMs = firstWeek + index * WEEK_MS;
    return {
      weekStart: new Date(weekStartMs).toISOString().slice(0, 10),
      count,
      totalMinor: totals[index] ?? 0,
      // a week counts as "burst" when it ends after the burst window opens
      inBurst: weekStartMs + WEEK_MS > burstStart.getTime(),
    };
  });
}

// ---- main loader ------------------------------------------------------------

/** Everything the review dashboard shows, built from Postgres. Returns null when the run does not exist. */
export async function buildStudioData(runId: string): Promise<StudioData | null> {
  const run = await prisma.payoutRun.findUnique({ where: { id: runId } });
  if (!run) return null;

  const persona = await getCurrentPersona();
  const viewer: Viewer | null = persona
    ? { id: persona.id, name: persona.name, role: persona.role }
    : null;

  const planHash = run.currentPlanHash;
  const [revision, approval, dispositionRows, flagRows, revisionRows, payoutItems] = await Promise.all([
    planHash
      ? prisma.planRevision.findUnique({ where: { runId_hash: { runId, hash: planHash } } })
      : null,
    prisma.approval.findUnique({ where: { runId } }),
    prisma.disposition.findMany({ where: { runId }, orderBy: { at: "asc" } }),
    planHash ? prisma.flag.findMany({ where: { runId, planHash } }) : [],
    prisma.planRevision.findMany({
      where: { runId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { hash: true, parentHash: true, createdById: true, createdAt: true },
    }),
    prisma.payoutItem.findMany({ where: { runId } }),
  ]);

  const plan = revision ? PlanFileSchema.parse(revision.planJson) : null;
  const parentRevision =
    plan?.parentHash && plan.parentHash !== planHash
      ? await prisma.planRevision.findUnique({
          where: { runId_hash: { runId, hash: plan.parentHash } },
        })
      : null;
  const parentPlan = parentRevision ? PlanFileSchema.safeParse(parentRevision.planJson) : null;

  const analysis = revision?.analysisJson ? AnalysisSchema.safeParse(revision.analysisJson) : null;
  const relatedByKey = new Map<string, string[]>();
  if (analysis?.success) {
    for (const f of analysis.data.flags) relatedByKey.set(`${f.lineId}|${f.ruleId}`, f.relatedLineIds);
  }

  // ---- history: last payout per payee, last cycle batch total, payment counts
  const payeeRefs = [...new Set((plan?.lines ?? []).map((l) => l.payeeId).filter((id): id is string => !!id))];
  const history = payeeRefs.length
    ? await prisma.historicalPayout.findMany({
        where: { payeeId: { in: payeeRefs }, currency: plan?.currency },
        orderBy: { paidAt: "desc" },
        select: { payeeId: true, amountMinor: true, paidAt: true },
      })
    : [];
  const lastPayoutByPayee = new Map<string, { amountMinor: number; paidAt: Date }>();
  const paymentCountByPayee = new Map<string, number>();
  for (const h of history) {
    if (!lastPayoutByPayee.has(h.payeeId)) lastPayoutByPayee.set(h.payeeId, h);
    paymentCountByPayee.set(h.payeeId, (paymentCountByPayee.get(h.payeeId) ?? 0) + 1);
  }

  const cycleBatches = await prisma.historicalPayout.groupBy({
    by: ["batchRef"],
    where: { batchRef: { startsWith: "cycle-" }, currency: plan?.currency },
    _sum: { amountMinor: true },
    _count: { _all: true },
    _max: { paidAt: true },
  });
  const lastBatch = cycleBatches
    .filter((b) => b._max.paidAt && b._max.paidAt < run.cycleDate)
    .sort((a, b) => (b._max.paidAt?.getTime() ?? 0) - (a._max.paidAt?.getTime() ?? 0))[0];

  // ---- lines
  const lines: StudioLine[] = (plan?.lines ?? []).map((line) => {
    const last = line.payeeId ? (lastPayoutByPayee.get(line.payeeId)?.amountMinor ?? null) : null;
    return {
      lineId: line.lineId,
      sourceRow: line.sourceRow,
      payeeRef: line.payeeRef,
      payeeId: line.payeeId,
      displayName: line.displayName,
      destination: line.destination.value,
      amountMinor: line.amount.minor,
      currency: line.amount.currency,
      note: line.note,
      include: line.include,
      isNewPayee: line.payeeId === null,
      lastAmountMinor: last,
      deltaMinor: last === null ? null : line.amount.minor - last,
      marker: lineMarker(line, last),
    };
  });

  // ---- matched payees for ENTITY_MATCH flags
  const matchedIds = new Set<string>();
  for (const f of flagRows) {
    const evidence = f.evidence as Array<{ key: string; value: unknown }>;
    const matched = evidence.find((e) => e.key === "er.matchedPayee");
    const id = typeof matched?.value === "string" ? /\(([^()]+)\)\s*$/.exec(matched.value)?.[1] : undefined;
    if (id) matchedIds.add(id);
  }
  const matchedPayees = new Map<string, MatchedPayee>();
  if (matchedIds.size > 0) {
    const [payees, matchedHistory] = await Promise.all([
      prisma.payee.findMany({ where: { id: { in: [...matchedIds] } } }),
      prisma.historicalPayout.findMany({
        where: { payeeId: { in: [...matchedIds] } },
        orderBy: { paidAt: "desc" },
        select: { payeeId: true, amountMinor: true, paidAt: true },
      }),
    ]);
    for (const p of payees) {
      const own = matchedHistory.filter((h) => h.payeeId === p.id);
      matchedPayees.set(p.id, {
        id: p.id,
        displayName: p.displayName,
        legalName: p.legalName,
        destination: p.destinationValue,
        country: p.country,
        createdAt: p.createdAt.toISOString(),
        paymentCount: own.length,
        lastPaidAt: own[0]?.paidAt.toISOString() ?? null,
        lastAmountMinor: own[0]?.amountMinor ?? null,
      });
    }
  }

  // ---- flags (+ their disposition)
  const dispositionByKey = new Map<string, DispositionView>();
  const dispositions: DispositionView[] = dispositionRows.map((d) => ({
    lineId: d.lineId,
    ruleId: d.ruleId,
    action: d.action === "EXCLUDED" ? "EXCLUDED" : "ACCEPTED",
    reason: d.reason,
    actorId: d.actorId,
    at: d.at.toISOString(),
  }));
  for (const d of dispositions) dispositionByKey.set(`${d.lineId}|${d.ruleId}`, d);

  const flags: StudioFlag[] = flagRows.map((f) => {
    const evidence = f.evidence as StudioFlag["evidence"];
    const matchedRaw = evidence.find((e) => e.key === "er.matchedPayee")?.value;
    const matchedId = typeof matchedRaw === "string" ? /\(([^()]+)\)\s*$/.exec(matchedRaw)?.[1] : undefined;
    return {
      id: f.id,
      lineId: f.lineId,
      ruleId: f.ruleId,
      severity: f.severity as Severity,
      blocking: f.blocking,
      evidence,
      relatedLineIds: relatedByKey.get(`${f.lineId}|${f.ruleId}`) ?? [],
      rationale: toRationale(f.rationale),
      disposition: dispositionByKey.get(`${f.lineId}|${f.ruleId}`) ?? null,
      matchedPayee: matchedId ? (matchedPayees.get(matchedId) ?? null) : null,
    };
  });

  // ---- KPIs
  const flagged = zeroKpiFlagged();
  const flaggedLines = new Set<string>();
  for (const f of flags) {
    flagged[f.severity] += 1;
    flagged.total += 1;
    flaggedLines.add(f.lineId);
    const isOpen = f.disposition === null;
    if (isOpen) flagged.open += 1;
    if (isOpen && f.blocking) flagged.openBlocking += 1;
    if (isOpen && !f.blocking) flagged.openWarnings += 1;
  }
  flagged.distinctLines = flaggedLines.size;

  const includedMinor = plan?.totals.includedMinor ?? 0;
  const lastCycleTotal = lastBatch?._sum.amountMinor ?? null;
  const kpis: Kpis = {
    currency: plan?.currency ?? "USD",
    lineCount: lines.length,
    includedCount: plan?.totals.includedCount ?? 0,
    excludedCount: lines.filter((l) => !l.include).length,
    includedMinor,
    flagged,
    lastCycle:
      lastBatch && lastCycleTotal !== null
        ? { batchRef: lastBatch.batchRef, lineCount: lastBatch._count._all, totalMinor: lastCycleTotal }
        : null,
    deltaVsLastCycleMinor: plan && lastCycleTotal !== null ? includedMinor - lastCycleTotal : null,
    deltaVsLastCyclePct:
      plan && lastCycleTotal ? Math.round(((includedMinor - lastCycleTotal) / lastCycleTotal) * 1000) / 10 : null,
  };

  // ---- velocity series for payees that have flags and history
  const policy = loadPolicy();
  const windows = velocityWindows(run.cycleDate, policy);
  const flaggedPayeeIds = new Set<string>();
  for (const f of flags) {
    const line = lines.find((l) => l.lineId === f.lineId);
    if (line?.payeeId) flaggedPayeeIds.add(line.payeeId);
  }
  const velocitySeries: Record<string, VelocitySeries> = {};
  const seriesIds = [...flaggedPayeeIds].slice(0, MAX_VELOCITY_PAYEES);
  if (seriesIds.length > 0) {
    const since = new Date(run.cycleDate.getTime() - VELOCITY_WEEKS * WEEK_MS);
    const rows = await prisma.historicalPayout.findMany({
      where: { payeeId: { in: seriesIds }, paidAt: { gte: since, lt: run.cycleDate } },
      select: { payeeId: true, paidAt: true, amountMinor: true },
    });
    for (const payeeId of seriesIds) {
      const own = rows.filter((r) => r.payeeId === payeeId);
      if (own.length === 0) continue;
      const line = lines.find((l) => l.payeeId === payeeId);
      velocitySeries[payeeId] = {
        payeeId,
        name: line?.displayName ?? payeeId,
        burstStart: windows.burstStart,
        cycleStart: windows.cycleStart,
        points: buildVelocityPoints({
          paidAt: own.map((r) => r.paidAt),
          amountMinor: own.map((r) => r.amountMinor),
          cycleDate: run.cycleDate,
          burstStart: new Date(windows.burstStart),
        }),
      };
    }
  }

  // ---- reconciliation (filled in for real in Phase 6; items appear once an apply creates them)
  const reconciliation = {
    state: run.status === "RECONCILED" ? ("DONE" as const) : payoutItems.length > 0 ? ("IN_PROGRESS" as const) : ("NOT_STARTED" as const),
    outcome: run.reconciliationOutcome,
    items: payoutItems.map((item) => ({
      lineId: item.lineId,
      plannedMinor: item.amountMinor,
      actualMinor: item.status === "SUCCESS" || item.status === "UNCLAIMED" ? item.amountMinor : null,
      status: item.status,
    })),
    note: run.reconciliationOutcome
      ? `Reconciliation ${run.reconciliationOutcome.replaceAll("_", " ").toLowerCase()}.`
      : payoutItems.length > 0
        ? "Waiting on PayPal for the final status of each payout."
        : "Planned vs. actual per payout appears here after the plan is applied.",
  };

  const lastError =
    run.lastError && typeof run.lastError === "object" && "message" in run.lastError
      ? String((run.lastError as { message: unknown }).message)
      : run.lastError
        ? JSON.stringify(run.lastError)
        : null;

  const status = run.status as RunStatus;
  const data: StudioData = {
    generatedAt: new Date().toISOString(),
    run: {
      id: run.id,
      status,
      filename: run.sourceFilename,
      cycleDate: run.cycleDate.toISOString().slice(0, 10),
      preparedById: run.preparedById,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      sourceSha256: run.sourceSha256,
      lastError,
    },
    planHash,
    planMeta: plan
      ? {
          policyVersion: plan.baseline.policyVersion,
          payeeMasterVersion: plan.baseline.payeeMasterVersion,
          historyWatermark: plan.baseline.historyWatermark,
          engineVersions: analysis?.success ? analysis.data.engineVersions : null,
        }
      : null,
    viewer,
    permissions: buildPermissions({
      viewer,
      status,
      preparedById: run.preparedById,
      openBlocking: flagged.openBlocking,
    }),
    stepper: buildStepper(status),
    kpis,
    lines,
    flags,
    dispositions,
    approval: approval
      ? { approverId: approval.approverId, planHash: approval.planHash, at: approval.at.toISOString() }
      : null,
    planDiff: plan ? buildPlanDiff(parentPlan?.success ? parentPlan.data : null, plan) : EMPTY_DIFF,
    revisions: revisionRows.map((r) => ({
      hash: r.hash,
      parentHash: r.parentHash,
      createdById: r.createdById,
      createdAt: r.createdAt.toISOString(),
    })),
    velocitySeries,
    esql: { velocity: ESQL_BURST_QUERY, sharedDestination: ESQL_SHARED_QUERY },
    reconciliation,
    rationaleCount: flags.filter((f) => f.rationale !== null).length,
    llmMode: getEnv().LLM_MODE,
  };

  return StudioDataSchema.parse(data);
}
