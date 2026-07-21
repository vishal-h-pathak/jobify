import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { MODULE_REGISTRY, type ModuleKey, type ModulesState } from "@/lib/onboarding/moduleRegistry";

export type ResetModuleResult = { kind: "ok" } | { kind: "no_session" } | { kind: "not_completed" };

/**
 * Admin action (ADM-3 §5): clears one module's completion entry from a
 * user's `onboarding_sessions.modules`, so the module reports incomplete
 * again and the relevant regeneration route (e.g. POST
 * /api/onboarding/modules/mirror/generate) will run it fresh next time the
 * user (or an admin drill-in) triggers it — un-sticks a module stuck on a
 * bad output without touching anything else in `extracted` or `messages`.
 * No schema change: `modules` is already a jsonb map keyed by `ModuleKey`
 * (see moduleRegistry.ts) — deleting a key IS "incomplete" per
 * `markModuleComplete`'s own contract (presence = done).
 */
export async function resetUserModule(
  admin: SupabaseClient<Database>,
  userId: string,
  moduleKey: ModuleKey
): Promise<ResetModuleResult> {
  const { data: session, error: readError } = await admin
    .from("onboarding_sessions")
    .select("modules, extracted")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw readError;
  if (!session) return { kind: "no_session" };

  const modules = (session.modules ?? {}) as ModulesState;
  if (!modules[moduleKey]) return { kind: "not_completed" };

  const { [moduleKey]: _removed, ...rest } = modules;
  const update: { modules: ModulesState; extracted?: Record<string, unknown> } = { modules: rest as ModulesState };

  // INT2-B (session-prompts/56_int2_deck.md §4): resetting "reactions" must
  // also clear the generated deck, or the module would report incomplete
  // but immediately re-serve the same stale scenarios instead of regenerating.
  if (moduleKey === "reactions") {
    const extracted = (session.extracted ?? {}) as Record<string, unknown>;
    const { reaction_deck: _deck, ...restExtracted } = extracted;
    update.extracted = restExtracted;
  }

  const { error: updateError } = await admin
    .from("onboarding_sessions")
    .update(update)
    .eq("user_id", userId);
  if (updateError) throw updateError;
  return { kind: "ok" };
}

export const RESETTABLE_MODULE_KEYS = Object.keys(MODULE_REGISTRY) as ModuleKey[];
