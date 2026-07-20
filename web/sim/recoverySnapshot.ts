import type { SessionSnapshot } from "../lib/onboarding/handleTurn";

/**
 * RECOVERY invariant (session-prompt 45, task 3): "serialize the session
 * snapshot, throw the loop away, rebuild from the snapshot — exactly what
 * the live app does on a return visit." A JSON round-trip is exactly that
 * operation: no shared object references survive it, and (same as a real
 * jsonb column) explicit `undefined` fields are dropped rather than
 * preserved — so this doubles as the "extracted state is byte-identical
 * across the boundary" check the sim runs at each seeded recovery point.
 */
export function serializeSnapshot(session: SessionSnapshot): string {
  return JSON.stringify(session);
}

export function deserializeSnapshot(json: string): SessionSnapshot {
  return JSON.parse(json) as SessionSnapshot;
}

export function roundTripSnapshot(session: SessionSnapshot): SessionSnapshot {
  return deserializeSnapshot(serializeSnapshot(session));
}
