import { Sparkles } from "lucide-react";
import type { RationaleView } from "@/domain/studio-data";

const ASSESSMENT_LABEL: Record<string, string> = {
  LIKELY_FRAUD: "Likely fraud",
  SUSPICIOUS: "Suspicious",
  LIKELY_BENIGN: "Likely benign",
  INSUFFICIENT: "Not enough evidence",
};

/** The advisory AI text. Always labelled, always shows which model wrote it. */
export function RationaleBlock({
  rationale,
  llmMode,
}: {
  rationale: RationaleView | null;
  llmMode: string;
}) {
  return (
    <section
      className="rounded-lg border border-dashed border-teal/50 bg-teal-wash/40 p-3"
      aria-label="AI-assisted rationale"
    >
      <header className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-teal-deep">
          <Sparkles className="size-3.5" aria-hidden /> AI-assisted rationale — advisory
        </h4>
        {rationale?.model ? (
          <span className="num rounded border border-teal/30 bg-surface px-1.5 py-0.5 text-[0.6875rem] text-ink-soft">
            {rationale.model}
          </span>
        ) : null}
      </header>

      {rationale ? (
        <>
          <p className="text-sm leading-relaxed text-ink">{rationale.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-ink-soft">
            {rationale.assessment ? (
              <span className="rounded-full border border-rule-strong bg-surface px-2 py-0.5 font-semibold">
                {ASSESSMENT_LABEL[rationale.assessment] ?? rationale.assessment}
              </span>
            ) : null}
            {rationale.citedEvidenceKeys.length > 0 ? (
              <span>
                Cites:{" "}
                {rationale.citedEvidenceKeys.map((key) => (
                  <code key={key} className="num mr-1 rounded bg-surface px-1 py-0.5">
                    {key}
                  </code>
                ))}
              </span>
            ) : null}
            {rationale.unverifiedCitations ? (
              <span className="text-sev-warn">Some cited keys were not in the evidence and were dropped.</span>
            ) : null}
          </div>
          <p className="mt-2 text-[0.6875rem] text-ink-faint">
            Written from the evidence above. It never changes a decision or the plan hash.
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-faint">
          {llmMode === "off"
            ? "AI rationales are switched off for this environment."
            : "No rationale yet. It appears here as soon as it is ready."}
        </p>
      )}
    </section>
  );
}
