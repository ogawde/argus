import type { Prisma } from "@prisma/client";
import type { PlanFile } from "@/domain/plan";
import type { PayeeLookup } from "@/domain/plan-builder";
import { loadPolicy } from "@/domain/policy";
import type {
  HistoricalPayoutView,
  PayeeView,
  RuleContext,
} from "@/domain/rules/types";

/** Everything the planner reads from Postgres, in the shapes the domain wants. */
export interface Baseline {
  payeesByRef: Map<string, PayeeLookup>;
  payeeByRef: Map<string, PayeeView>;
  historyByPayeeId: Map<string, HistoricalPayoutView[]>;
  priorBatchTotalsMinor: number[];
  historyWatermark: Date;
}

export async function loadBaseline(tx: Prisma.TransactionClient): Promise<Baseline> {
  const payees = await tx.payee.findMany();
  const history = await tx.historicalPayout.findMany();

  // payee id doubles as the CSV payee_ref
  const payeesByRef = new Map<string, PayeeLookup>(
    payees.map((p) => [
      p.id,
      { id: p.id, displayName: p.displayName, destinationValue: p.destinationValue },
    ]),
  );
  const payeeByRef = new Map<string, PayeeView>(payees.map((p) => [p.id, p]));

  const historyByPayeeId = new Map<string, HistoricalPayoutView[]>();
  const totalsByBatch = new Map<string, number>();
  let historyWatermark = new Date(0);

  for (const h of history) {
    const list = historyByPayeeId.get(h.payeeId) ?? [];
    list.push(h);
    historyByPayeeId.set(h.payeeId, list);

    // only monthly "cycle-" batches count as prior batch totals
    if (h.batchRef.startsWith("cycle-")) {
      totalsByBatch.set(h.batchRef, (totalsByBatch.get(h.batchRef) ?? 0) + h.amountMinor);
    }
    if (h.paidAt > historyWatermark) historyWatermark = h.paidAt;
  }

  return {
    payeesByRef,
    payeeByRef,
    historyByPayeeId,
    priorBatchTotalsMinor: [...totalsByBatch.values()],
    historyWatermark,
  };
}

export function makeRuleContext(
  plan: PlanFile,
  cycleDate: Date,
  baseline: Baseline,
): RuleContext {
  return {
    plan,
    policy: loadPolicy(),
    cycleDate,
    historyByPayeeId: baseline.historyByPayeeId,
    payeeByRef: baseline.payeeByRef,
    priorBatchTotalsMinor: baseline.priorBatchTotalsMinor,
  };
}
