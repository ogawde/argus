"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  "Reading the CSV",
  "Matching payees and building the plan",
  "Running the rule checks",
  "Elasticsearch: velocity and shared destinations",
  "Entity resolution (vectors + fuzzy names)",
  "Writing advisory AI rationales",
];

const STEP_MS = 1400;

/**
 * Shown while a run is in PLANNING. The server does not stream per-step progress,
 * so the checklist advances on a timer and the last step waits until the run really moves on.
 */
export function PlanningSteps() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((current) => Math.min(current + 1, STEPS.length - 1));
    }, STEP_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="rounded-xl border border-rule-strong bg-surface p-5" aria-live="polite" aria-label="Planning progress">
      <p className="eyebrow">Planning in progress</p>
      <h2 className="font-display text-2xl font-semibold text-ink">Analysing the batch</h2>
      <ol className="mt-3 flex flex-col gap-2">
        {STEPS.map((label, index) => {
          const isDone = index < activeIndex;
          const isActive = index === activeIndex;
          return (
            <li key={label} className={cn("flex items-center gap-2.5 text-sm", !isDone && !isActive && "text-ink-faint")}>
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border",
                  isDone && "border-teal bg-teal text-primary-foreground",
                  isActive && "border-ink text-ink",
                  !isDone && !isActive && "border-rule-strong",
                )}
              >
                {isDone ? <Check className="size-3" strokeWidth={3} /> : null}
                {isActive ? <Loader2 className="size-3 animate-spin" /> : null}
              </span>
              <span className={cn(isActive && "font-medium text-ink")}>{label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
