// web/components/submit/api.ts
import type { ApplicationProfile, SubmitPacket } from "./types";

/**
 * GET /api/submit/profile → 200 ApplicationProfile | 404 (never onboarded).
 * DI'd exactly like the onboarding page's `submitTurn`/`submitAnchor`
 * (web/app/(app)/onboarding/page.tsx) so it's unit-testable without mocking
 * global `fetch`.
 */
export async function fetchApplicationProfile(fetchImpl: typeof fetch = fetch): Promise<ApplicationProfile | null> {
  const res = await fetchImpl("/api/submit/profile");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Couldn't load your application defaults — try refreshing.");
  return res.json();
}

/** POST /api/submit/profile → 204. */
export async function saveApplicationProfile(
  profile: ApplicationProfile,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const res = await fetchImpl("/api/submit/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : "Couldn't save — try again.");
  }
}

export type SubmitPacketOutcome =
  | { kind: "ready"; packet: SubmitPacket }
  | { kind: "needs_setup" }
  | { kind: "no_materials" }
  | { kind: "error"; message: string };

/**
 * GET /api/submit/packet?posting_id=<id> → 200 SubmitPacket
 * | 409 {error:"no_application_profile"} | 404 {error:"no_materials"}.
 */
export async function fetchSubmitPacket(
  postingId: string,
  fetchImpl: typeof fetch = fetch
): Promise<SubmitPacketOutcome> {
  const res = await fetchImpl(`/api/submit/packet?posting_id=${encodeURIComponent(postingId)}`);
  if (res.status === 200) return { kind: "ready", packet: await res.json() };
  if (res.status === 409) return { kind: "needs_setup" };
  if (res.status === 404) return { kind: "no_materials" };
  return { kind: "error", message: "Couldn't load your submit kit — try refreshing." };
}
