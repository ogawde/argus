import { Button } from "@/components/ui/button";
import { switchPersonaForm } from "@/server/actions/form";
import { DEMO_PERSONAS, getCurrentPersona } from "@/server/auth/demo";

/** Demo-only: pick who you are. Shown when DEMO_AUTH is on. */
export async function PersonaSwitcher() {
  const current = await getCurrentPersona();
  if (!current) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>
        Signed in as <strong>{current.name}</strong>
      </span>
      {DEMO_PERSONAS.filter((p) => p.id !== current.id).map((p) => (
        <form key={p.id} action={switchPersonaForm}>
          <input type="hidden" name="personaId" value={p.id} />
          <Button type="submit" variant="outline" size="sm">
            Switch to {p.name}
          </Button>
        </form>
      ))}
    </div>
  );
}
