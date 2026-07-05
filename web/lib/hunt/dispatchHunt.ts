import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";

export type DispatchHuntResult =
  | { kind: "no_profile" }
  | { kind: "invalid_profile" }
  | { kind: "cooldown"; cooldownUntil: string }
  | { kind: "not_configured" }
  | { kind: "dispatch_failed"; status: number }
  | { kind: "ok"; cooldownUntil: string };

export interface DispatchHuntDeps {
  admin: SupabaseClient<Database>;
  targetUserId: string;
  /** Admins bypass the per-user cooldown (see 21_user_triggered_hunts.md task 4). */
  bypassCooldown: boolean;
  cooldownHours: number;
  githubRepo: string | undefined;
  githubToken: string | undefined;
  fetchImpl: typeof fetch;
  now: () => Date;
}

/**
 * Core logic behind `POST /api/hunt/run`, factored out of the route
 * handler so it's directly unit-testable with a fake `fetchImpl` and a
 * fake `now` — see `dispatchHunt.test.ts`. The route owns turning each
 * `DispatchHuntResult` into the right HTTP status; this function never
 * touches `NextResponse`.
 *
 * Order matches the session prompt exactly: profile exists + not invalid
 * -> cooldown (skipped for admins) -> GitHub dispatch (config check right
 * before the network call, since that's genuinely when it's needed) ->
 * service-role update of `last_hunt_requested_at`.
 */
export async function dispatchHunt(deps: DispatchHuntDeps): Promise<DispatchHuntResult> {
  const { admin, targetUserId, bypassCooldown, cooldownHours, githubRepo, githubToken, fetchImpl, now } = deps;

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("user_id, validation_status, last_hunt_requested_at")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { kind: "no_profile" };
  if (profile.validation_status?.status === "invalid") return { kind: "invalid_profile" };

  if (!bypassCooldown && profile.last_hunt_requested_at) {
    const cooldownUntil = addHours(new Date(profile.last_hunt_requested_at), cooldownHours);
    if (cooldownUntil.getTime() > now().getTime()) {
      return { kind: "cooldown", cooldownUntil: cooldownUntil.toISOString() };
    }
  }

  if (!githubRepo || !githubToken) {
    return { kind: "not_configured" };
  }

  // Never log or echo `githubToken` anywhere below this line — only the
  // Authorization header value, never surfaced in a response or thrown error.
  const res = await fetchImpl(
    `https://api.github.com/repos/${githubRepo}/actions/workflows/hosted-hunt.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { user_id: targetUserId } }),
    }
  );
  if (res.status !== 204) {
    return { kind: "dispatch_failed", status: res.status };
  }

  const nowIso = now().toISOString();
  const { error: updateError } = await admin
    .from("profiles")
    .update({ last_hunt_requested_at: nowIso })
    .eq("user_id", targetUserId);
  if (updateError) throw updateError;

  return { kind: "ok", cooldownUntil: addHours(new Date(nowIso), cooldownHours).toISOString() };
}

function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setUTCHours(result.getUTCHours() + hours);
  return result;
}
