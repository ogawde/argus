import { switchPersonaForm } from "@/server/actions/form";
import { DEMO_PERSONAS, getCurrentPersona } from "@/server/auth/demo";

/** Demo-only: pick who you are. Shown when DEMO_AUTH is on. */
export async function PersonaSwitcher() {
  const current = await getCurrentPersona();
  if (!current) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="eyebrow hidden sm:inline">Viewing as</span>
      <div
        role="group"
        aria-label="Switch demo persona"
        className="inline-flex rounded-lg border border-rule-strong bg-surface p-0.5"
      >
        {DEMO_PERSONAS.map((persona) => {
          const isActive = persona.id === current.id;
          return (
            <form key={persona.id} action={switchPersonaForm}>
              <input type="hidden" name="personaId" value={persona.id} />
              <button
                type="submit"
                disabled={isActive}
                aria-pressed={isActive}
                className={
                  isActive
                    ? "rounded-md bg-ink px-3 py-1 text-xs font-semibold text-surface"
                    : "rounded-md px-3 py-1 text-xs font-medium text-ink-soft hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-teal"
                }
              >
                {persona.name}
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}
