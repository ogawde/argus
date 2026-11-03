"use server";

import { z } from "zod";
import { parseCsvText } from "@/domain/csv";
import { sourceSha256 } from "@/domain/plan-builder";
import { loadPolicy } from "@/domain/policy";
import { appendAudit } from "@/server/audit";
import { getCurrentActor } from "@/server/auth/demo";
import { prisma } from "@/server/db";
import { sourceCacheKey } from "@/server/planning/run-planning";
import { fail, ok, type ActionResult } from "@/server/actions/result";

const CycleDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "cycle date must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00.000Z`).getTime()), "not a real date");

/** Validate the uploaded CSV and create a DRAFT run. Planning happens later. */
export async function createRun(formData: FormData): Promise<ActionResult<{ runId: string }>> {
  const actor = await getCurrentActor();
  if (!actor) return fail("UNAUTHENTICATED", "Sign in as a demo persona first.");
  if (actor.role !== "PREPARER") return fail("FORBIDDEN", "Only a preparer can create runs.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("FILE_REQUIRED", "Choose a CSV file to upload.");
  }

  const cycle = CycleDateSchema.safeParse(formData.get("cycleDate"));
  if (!cycle.success) return fail("BAD_CYCLE_DATE", cycle.error.issues[0]!.message);

  const policy = loadPolicy();
  if (file.size > policy.csv.maxBytes) {
    return fail("CSV_INVALID", `file exceeds ${policy.csv.maxBytes} bytes`);
  }

  const text = await file.text();
  const parsed = parseCsvText(text, policy.csv);
  if (parsed.errors.length > 0) {
    const first = parsed.errors
      .slice(0, 5)
      .map((e) => `row ${e.rowNumber} ${e.field}: ${e.reason}`)
      .join("; ");
    return fail("CSV_INVALID", `${parsed.errors.length} problem(s). ${first}`);
  }
  if (parsed.rows.length === 0) return fail("CSV_INVALID", "the file has no rows");

  const sha = sourceSha256(text);

  // Same file already paid out? Refuse.
  const sameSource = await prisma.payoutRun.findMany({
    where: { sourceSha256: sha },
    select: { id: true, status: true },
  });
  const alreadyPaid = sameSource.some((r) => r.status === "RECONCILED");
  const applied = await prisma.appliedPlan.findFirst({
    where: { runId: { in: sameSource.map((r) => r.id) } },
  });
  if (alreadyPaid || applied) {
    return fail("ALREADY_APPLIED_SOURCE", "This exact file has already been paid out.");
  }

  const newest = await prisma.payee.aggregate({ _max: { version: true } });
  const payeeMasterVersion = newest._max.version ?? 1;

  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.payoutRun.create({
      data: {
        status: "DRAFT",
        preparedById: actor.id,
        cycleDate: new Date(`${cycle.data}T00:00:00.000Z`),
        sourceFilename: file.name,
        sourceSha256: sha,
        payeeMasterVersion,
      },
    });
    // No sourceText column, so keep the raw CSV in AnalysisCache until planning.
    await tx.analysisCache.create({
      data: {
        key: sourceCacheKey(run.id),
        kind: "csv",
        value: { filename: file.name, text },
      },
    });
    await appendAudit(tx, {
      actorId: actor.id,
      type: "RUN_CREATED",
      runId: run.id,
      data: {
        filename: file.name,
        sourceSha256: sha,
        rowCount: parsed.rows.length,
        cycleDate: cycle.data,
      },
    });
    return run.id;
  });

  return ok({ runId });
}
