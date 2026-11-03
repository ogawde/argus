"use server";

import { findPersona, setPersonaCookie } from "@/server/auth/demo";
import { getEnv } from "@/lib/env";
import { fail, ok, type ActionResult } from "@/server/actions/result";

export async function switchPersona(personaId: string): Promise<ActionResult<{ personaId: string }>> {
  if (!getEnv().DEMO_AUTH) return fail("AUTH_DISABLED", "Demo auth is off.");
  const persona = findPersona(personaId);
  if (!persona) return fail("UNKNOWN_PERSONA", "Unknown persona.");
  await setPersonaCookie(persona.id);
  return ok({ personaId: persona.id });
}
