import { Check, X } from "lucide-react";
import type { Step } from "@/domain/studio-data";
import { cn } from "@/lib/utils";

/** Draft → Planning → Flagged/Ready → Approved → Applying → Reconciled */
export function RunStepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex w-full items-start" aria-label="Run progress">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const nextDone = steps[index + 1]?.state !== "upcoming";
        return (
          <li
            key={step.key}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn("relative flex min-w-0 flex-1 flex-col items-start gap-1.5", isLast && "flex-none")}
          >
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
                  step.state === "done" && "border-teal bg-teal text-primary-foreground",
                  step.state === "current" && "border-ink bg-ink text-surface ring-4 ring-teal/25",
                  step.state === "upcoming" && "border-rule-strong bg-surface text-ink-faint",
                  step.state === "failed" && "border-sev-critical bg-sev-critical text-surface",
                )}
              >
                {step.state === "done" ? <Check className="size-4" strokeWidth={3} /> : null}
                {step.state === "failed" ? <X className="size-4" strokeWidth={3} /> : null}
                {step.state === "current" || step.state === "upcoming" ? index + 1 : null}
              </span>
              {!isLast ? (
                <span
                  aria-hidden
                  className={cn("mx-1 h-0.5 flex-1 rounded-full", step.state === "done" && nextDone ? "bg-teal" : "bg-rule-strong")}
                />
              ) : null}
            </div>
            <span
              className={cn(
                "text-xs font-semibold tracking-wide",
                step.state === "current" && "text-ink",
                step.state === "done" && "text-teal-deep",
                step.state === "upcoming" && "text-ink-faint",
                step.state === "failed" && "text-sev-critical",
              )}
            >
              {step.label}
              <span className="sr-only"> — {step.state}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
