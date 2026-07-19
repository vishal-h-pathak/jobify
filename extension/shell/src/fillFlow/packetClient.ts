import type { SubmitPacket } from "../engineTypes";

// See ready/readyList.ts's header comment for why this is a plain
// credentials:"include" fetch against the app origin rather than a bearer
// token — `/api/submit/packet` is cookie-authed and out of this session's
// ownership to modify.
export type PacketOutcome =
  | { kind: "ok"; packet: SubmitPacket }
  | { kind: "needs_setup" } // 409 no_application_profile
  | { kind: "no_materials" } // 404 no succeeded tailor run / not this user's
  | { kind: "error"; status: number };

export interface PacketClientDeps {
  fetchImpl: typeof fetch;
  appOrigin: string;
}

export async function fetchPacket(deps: PacketClientDeps, postingId: string): Promise<PacketOutcome> {
  const res = await deps.fetchImpl(`${deps.appOrigin}/api/submit/packet?posting_id=${encodeURIComponent(postingId)}`, {
    credentials: "include",
  });
  if (res.status === 409) return { kind: "needs_setup" };
  if (res.status === 404) return { kind: "no_materials" };
  if (!res.ok) return { kind: "error", status: res.status };
  return { kind: "ok", packet: (await res.json()) as SubmitPacket };
}
