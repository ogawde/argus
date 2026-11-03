import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import type { Actor, Role } from "@/domain/state";

export const PERSONA_COOKIE = "argus_persona";

export interface Persona {
  id: string;
  name: string;
  role: Role;
}

export const DEMO_PERSONAS: readonly Persona[] = [
  { id: "maya", name: "Maya (preparer)", role: "PREPARER" },
  { id: "daniel", name: "Daniel (approver)", role: "APPROVER" },
];

export function findPersona(id: string | undefined): Persona | null {
  return DEMO_PERSONAS.find((p) => p.id === id) ?? null;
}

/** Current persona from the cookie. Defaults to Maya. Returns null when DEMO_AUTH is off. */
export async function getCurrentPersona(): Promise<Persona | null> {
  if (!getEnv().DEMO_AUTH) return null;
  const store = await cookies();
  const saved = findPersona(store.get(PERSONA_COOKIE)?.value);
  return saved ?? DEMO_PERSONAS[0]!;
}

export async function getCurrentActor(): Promise<Actor | null> {
  const persona = await getCurrentPersona();
  if (!persona) return null;
  return { id: persona.id, role: persona.role };
}

export async function setPersonaCookie(id: string): Promise<void> {
  const store = await cookies();
  store.set(PERSONA_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}
