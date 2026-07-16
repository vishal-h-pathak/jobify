import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";
import { phaseOneComplete, type ModulesState } from "./moduleRegistry";
import { buildMinimalDoc, type MinimalDocInput } from "./incrementalDoc";
import type { DispatchHuntDeps, DispatchHuntResult } from "../hunt/dispatchHunt";

type SessionRow = Database["public"]["Tables"]["onboarding_sessions"]["Row"];

export interface CheckpointUser {
  id: string;
  email?: string | null;
}

export interface CheckpointDeps {
  admin: SupabaseClient<Database>;
  /**
   * Injected rather than imported directly, so this module's own tests can
   * spy on the call (e.g. assert `systemInitiated: true`) without also
   * exercising `dispatchHunt`'s own GitHub-fetch plumbing — that's already
   * covered by `dispatchHunt.test.ts`. Production callers pass the real
   * `dispatchHunt` from `../hunt/dispatchHunt`.
   */
  dispatchHunt: (deps: DispatchHuntDeps) => Promise<DispatchHuntResult>;
  cooldownHours: number;
  githubRepo: string | undefined;
  githubToken: string | undefined;
  fetchImpl: typeof fetch;
  now: () => Date;
}

/**
 * V3A-1's background-hunt checkpoint (PRODUCT_VISION.md §2): the moment
 * phase 1 (anchor + reactions + values + dealbreakers) completes, fire the
 * first hunt silently — by the time the user finishes the rest of the
 * interview, their feed already exists and has been re-ranked.
 *
 * Idempotency is two-layered, so repeat calls (even with a stale in-memory
 * `session` that hasn't picked up a prior call's write) never double-fire:
 * 1. `modules.checkpoint_hunt` on the passed-in `session` — the fast path.
 * 2. A fresh `profiles` row existence check against `deps.admin` — the
 *    authoritative guard, since it reads current DB state rather than
 *    trusting the caller's possibly-stale `session` argument.
 *
 * Every failure is caught, logged, and swallowed — onboarding must never
 * crash because the background checkpoint had a bad moment. A failure
 * before `checkpoint_hunt` is stamped just means the next module
 * completion re-attempts the checkpoint.
 */
export async function maybeFireCheckpoint(deps: CheckpointDeps, session: SessionRow, user: CheckpointUser): Promise<void> {
  const modules = (session.modules ?? {}) as ModulesState;
  if (!phaseOneComplete(modules)) return;
  if (modules.checkpoint_hunt) return;

  try {
    const { data: existingProfile, error: selectError } = await deps.admin
      .from("profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existingProfile) return;

    const extracted = (session.extracted ?? {}) as MinimalDocInput;
    const doc = buildMinimalDoc(extracted, user.email ?? "");

    const { error: upsertError } = await deps.admin.from("profiles").upsert({ user_id: user.id, doc });
    if (upsertError) throw upsertError;

    await deps.dispatchHunt({
      admin: deps.admin,
      targetUserId: user.id,
      bypassCooldown: false,
      systemInitiated: true,
      cooldownHours: deps.cooldownHours,
      githubRepo: deps.githubRepo,
      githubToken: deps.githubToken,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });

    const { error: sessionError } = await deps.admin
      .from("onboarding_sessions")
      .update({ modules: { ...modules, checkpoint_hunt: { fired_at: deps.now().toISOString() } } })
      .eq("user_id", user.id);
    if (sessionError) throw sessionError;
  } catch (err) {
    console.error("[checkpoint] background-hunt checkpoint failed:", err);
  }
}
