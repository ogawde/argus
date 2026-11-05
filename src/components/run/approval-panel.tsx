"use client";

import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import type { StudioData } from "@/domain/studio-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatMoney, hashPrefix, plural } from "@/components/run/format";
import { applyPlan } from "@/server/actions/apply-plan";
import { approvePlan, revokeApproval } from "@/server/actions/approval";
import type { ActionResult } from "@/server/actions/result";

interface ApprovalPanelProps {
  data: StudioData;
  onChanged: () => Promise<void>;
  onReject: () => void;
}

type Notice = { tone: "ok" | "error" | "info"; text: string } | null;

function failureText(result: ActionResult<unknown>): string | null {
  return result.ok ? null : result.message;
}

/** Sign-off area: typed confirmation, four-eyes message, approve / revoke, apply (stub until Phase 5). */
export function ApprovalPanel({ data, onChanged, onReject }: ApprovalPanelProps) {
  const { run, permissions, planHash, approval, kpis } = data;
  const [confirmText, setConfirmText] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const status = run.status;
  const prefix = planHash ? hashPrefix(planHash) : "";
  const approveWord = `APPROVE ${prefix}`;
  const applyWord = `APPLY ${prefix}`;
  const isConfirmed = (word: string) => confirmText.trim().toUpperCase() === word.toUpperCase();

  async function perform(action: () => Promise<ActionResult<unknown>>, okText: string) {
    setIsBusy(true);
    setNotice(null);
    try {
      const failure = failureText(await action());
      setNotice(failure ? { tone: "error", text: failure } : { tone: "ok", text: okText });
      setConfirmText("");
      await onChanged();
    } finally {
      setIsBusy(false);
    }
  }

  function approve() {
    if (!planHash) return;
    void perform(() => approvePlan(run.id, planHash), "Plan approved. The hash is now locked in.");
  }

  function revoke() {
    void perform(() => revokeApproval(run.id), "Approval revoked. The run is back in READY.");
  }

  async function apply() {
    setIsBusy(true);
    setNotice(null);
    try {
      if (!planHash) return;
      const typed = status === "APPLYING" ? applyWord : confirmText.trim();
      const result = await applyPlan(run.id, planHash, typed);
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message });
      } else {
        setNotice({
          tone: result.data.alreadyApplied ? "info" : "ok",
          text: result.data.message,
        });
        setConfirmText("");
        await onChanged();
      }
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Approval">
      <div className="flex items-center justify-between gap-2">
        <h3 className="eyebrow flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden /> Approval
        </h3>
        {permissions.canReject ? (
          <button type="button" onClick={onReject} className="text-xs font-medium text-ink-faint underline-offset-2 hover:text-sev-critical hover:underline focus-visible:outline-2 focus-visible:outline-teal">
            Reject run…
          </button>
        ) : null}
      </div>

      {status === "DRAFT" || status === "PLANNING" || !planHash ? (
        <p className="rounded-lg border border-dashed border-rule-strong p-4 text-sm text-ink-faint">
          Approval opens once the plan is analysed and every blocking flag has a decision.
        </p>
      ) : status === "REJECTED" || status === "FAILED" ? (
        <p className="rounded-lg border border-dashed border-rule-strong p-4 text-sm text-ink-faint">
          This run is {status.toLowerCase()}, so there is nothing to approve.
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-rule-strong bg-surface p-4">
          <p className="text-sm text-ink-soft">
            You are signing off <strong className="text-ink">{plural(kpis.includedCount, "payout")}</strong> totalling{" "}
            <strong className="num text-ink">{formatMoney(kpis.includedMinor, kpis.currency)}</strong>
            {kpis.flagged.open > 0 ? <>, with <strong className="text-ink">{kpis.flagged.open} open flag{kpis.flagged.open === 1 ? "" : "s"}</strong></> : null}.
          </p>

          {status === "APPLYING" ? (
            <div className="flex flex-col gap-2">
              <p className="rounded-lg border border-sev-info/30 bg-sev-info-wash px-3 py-2 text-sm text-sev-info">
                This run is already applying. Apply again only to resume the same PayPal batch — it will not pay twice.
              </p>
              {permissions.canApply ? (
                <Button type="button" disabled={isBusy} onClick={apply}>
                  {isBusy ? "Checking…" : "Check apply status"}
                </Button>
              ) : null}
            </div>
          ) : status === "APPROVED" && approval ? (
            <>
              <p className="rounded-lg border border-ok/30 bg-ok-wash px-3 py-2 text-sm text-ok">
                Approved by <strong>{approval.approverId}</strong> on {formatDateTime(approval.at)}.
              </p>
              {permissions.canApply ? (
                <div className="flex flex-col gap-2">
                  <label htmlFor="apply-confirm" className="text-xs font-medium text-ink-soft">
                    Type <code className="num rounded bg-paper-deep px-1">{applyWord}</code> to unlock apply
                  </label>
                  <Input id="apply-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" className="num" placeholder={applyWord} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={!isConfirmed(applyWord) || isBusy} onClick={apply}>
                      Apply to PayPal sandbox
                    </Button>
                    {permissions.canRevoke ? (
                      <Button type="button" variant="outline" disabled={isBusy} onClick={revoke}>
                        Revoke approval
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : permissions.canApprove ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="approve-confirm" className="text-xs font-medium text-ink-soft">
                Type <code className="num rounded bg-paper-deep px-1">{approveWord}</code> to confirm you reviewed hash{" "}
                <code className="num rounded bg-paper-deep px-1">{prefix}</code>
              </label>
              <Input id="approve-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" className="num" placeholder={approveWord} />
              <Button type="button" disabled={!isConfirmed(approveWord) || isBusy} onClick={approve} className="self-start">
                {isBusy ? "Approving…" : "Approve plan"}
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-lg border border-rule-strong bg-paper-deep/60 px-3 py-2.5 text-sm text-ink-soft" role="note">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold text-ink">Approve is disabled</p>
                <p>{permissions.approveBlockedReason}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error"
              ? "rounded-md border border-sev-critical/30 bg-sev-critical-wash px-3 py-2 text-sm text-sev-critical"
              : notice.tone === "ok"
                ? "rounded-md border border-ok/30 bg-ok-wash px-3 py-2 text-sm text-ok"
                : "rounded-md border border-sev-info/30 bg-sev-info-wash px-3 py-2 text-sm text-sev-info"
          }
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
