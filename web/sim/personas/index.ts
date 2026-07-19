import type { Persona } from "./types";
import { createCooperativePersona } from "./cooperative";
import { createTersePersona } from "./terse";
import { createMeanderingPersona } from "./meandering";
import { createCorrectivePersona } from "./corrective";

export type { Persona, PersonaContext } from "./types";

export const PERSONA_NAMES = ["cooperative", "terse", "meandering", "corrective"] as const;
export type PersonaName = (typeof PERSONA_NAMES)[number];

const FACTORIES: Record<PersonaName, () => Persona> = {
  cooperative: createCooperativePersona,
  terse: createTersePersona,
  meandering: createMeanderingPersona,
  corrective: createCorrectivePersona,
};

/** Always returns a fresh instance — personas may hold internal per-run state (see corrective). */
export function createPersona(name: PersonaName): Persona {
  const factory = FACTORIES[name];
  if (!factory) throw new Error(`unknown persona: ${String(name)}`);
  return factory();
}
