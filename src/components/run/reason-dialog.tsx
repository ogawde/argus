"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface ReasonRequest {
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  tone: "accept" | "exclude" | "neutral";
  presets: string[];
  defaultReason?: string;
}

/** One reason box used for Accept, Exclude, bulk accept and Reject. Enter submits. */
export function ReasonDialog({
  request,
  isBusy,
  error,
  onCancel,
  onSubmit,
}: {
  request: ReasonRequest | null;
  isBusy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => (!open && !isBusy ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-md">
        {/* key resets the typed text every time the dialog opens for a new request */}
        {request ? (
          <ReasonForm key={request.title + request.description} request={request} isBusy={isBusy} error={error} onCancel={onCancel} onSubmit={onSubmit} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  request,
  isBusy,
  error,
  onCancel,
  onSubmit,
}: {
  request: ReasonRequest;
  isBusy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState(request.defaultReason ?? "");
  const canSubmit = reason.trim().length >= 3 && !isBusy;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(reason.trim());
      }}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle className="font-display text-2xl">{request.title}</DialogTitle>
        <DialogDescription>{request.description}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <label htmlFor="reason-input" className="text-sm font-medium text-ink">
          Reason (saved in the audit log)
        </label>
        <Input
          id="reason-input"
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this the right call?"
          minLength={3}
          maxLength={500}
          autoComplete="off"
        />
        <div className="flex flex-wrap gap-1.5">
          {request.presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setReason(preset)}
              className="rounded-full border border-rule-strong bg-surface px-2.5 py-0.5 text-xs text-ink-soft hover:bg-teal-wash hover:text-teal-deep focus-visible:outline-2 focus-visible:outline-teal"
            >
              {preset}
            </button>
          ))}
        </div>
        {error ? (
          <p role="alert" className="rounded-md border border-sev-critical/30 bg-sev-critical-wash px-3 py-2 text-sm text-sev-critical">
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit}
          variant={request.tone === "exclude" ? "destructive" : "default"}
        >
          {isBusy ? request.busyLabel : request.confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
