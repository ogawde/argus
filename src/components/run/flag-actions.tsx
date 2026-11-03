import { Button } from "@/components/ui/button";
import { dispositionForm } from "@/server/actions/form";

/** Reason box + Accept / Exclude buttons for one flag. */
export function FlagActions({
  runId,
  lineId,
  ruleId,
  canExclude,
}: {
  runId: string;
  lineId: string;
  ruleId: string;
  canExclude: boolean;
}) {
  return (
    <form action={dispositionForm} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="lineId" value={lineId} />
      <input type="hidden" name="ruleId" value={ruleId} />
      <input
        name="reason"
        placeholder="Reason"
        required
        minLength={3}
        className="w-48 rounded border px-2 py-1 text-sm"
      />
      <Button type="submit" name="action" value="ACCEPTED" size="sm" variant="outline">
        Accept
      </Button>
      {canExclude ? (
        <Button type="submit" name="action" value="EXCLUDED" size="sm" variant="destructive">
          Exclude
        </Button>
      ) : null}
    </form>
  );
}
