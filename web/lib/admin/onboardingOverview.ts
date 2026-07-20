import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { FALLBACK_TEXT_MARKERS, LOOP_BREAKER_QUESTION } from "@/lib/onboarding/handleTurn";
import { MODULE_REGISTRY, type ModuleKey, type ModulesState } from "@/lib/onboarding/moduleRegistry";

export interface ModuleStatusRow {
  key: ModuleKey;
  done: boolean;
  completedAt: string | null;
}

export interface OnboardingOverviewRow {
  userId: string;
  stage: string;
  status: "in_progress" | "complete";
  /** `onboarding_sessions.updated_at` when `status === "complete"` — the
   * row's last write IS the completion write (see handleTurn.ts's `if
   * (done)` branch), so this needs no separate column. */
  completedAt: string | null;
  /** `onboarding_sessions.updated_at` regardless of status — every turn
   * (including the completion turn) updates this row, so it doubles as a
   * last-activity signal for in-progress users. */
  lastActivityAt: string;
  turnCount: number;
  /** Best-effort telemetry: `fallback_kind` is a return-value-only field
   * (see HandleTurnResult), never persisted — these counts come from
   * scanning stored assistant messages for the canned fallback/loop-breaker
   * text (see handleTurn.ts::FALLBACK_TEXT_MARKERS). "reprompt" turns leave
   * no such marker (the model continues in its own words), so they're
   * invisible here and this undercounts total fallback activity. */
  fallbackCount: number;
  loopBreakerCount: number;
  modules: ModuleStatusRow[];
}

interface OnboardingSessionRow {
  user_id: string;
  stage: string;
  status: "in_progress" | "complete";
  updated_at: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  modules: ModulesState;
}

function summarizeModules(modules: ModulesState): ModuleStatusRow[] {
  return (Object.keys(MODULE_REGISTRY) as ModuleKey[]).map((key) => {
    const entry = modules[key];
    const completedAt = entry && "completed_at" in entry ? entry.completed_at : null;
    return { key, done: Boolean(entry), completedAt };
  });
}

/** Pure aggregation over a raw `onboarding_sessions` row — split out so the
 * fallback-marker scan and module summary are unit testable without a
 * database (same convention as `spend.ts`/`systemMetrics.ts`). */
export function summarizeOnboardingSession(row: OnboardingSessionRow): OnboardingOverviewRow {
  let fallbackCount = 0;
  let loopBreakerCount = 0;
  let turnCount = 0;
  for (const message of row.messages) {
    if (message.role === "user") turnCount += 1;
    if (message.role !== "assistant") continue;
    if (message.content.includes(LOOP_BREAKER_QUESTION)) loopBreakerCount += 1;
    else if (FALLBACK_TEXT_MARKERS.some((marker) => message.content.includes(marker))) fallbackCount += 1;
  }

  return {
    userId: row.user_id,
    stage: row.stage,
    status: row.status,
    completedAt: row.status === "complete" ? row.updated_at : null,
    lastActivityAt: row.updated_at,
    turnCount,
    fallbackCount,
    loopBreakerCount,
    modules: summarizeModules(row.modules ?? {}),
  };
}

/** Every user's onboarding behavior, keyed by `user_id`, for the admin
 * "Onboarding behavior" section and the Friends card's consumed-row join.
 * One full-table read of `onboarding_sessions` (messages included) —
 * acceptable at this app's current friend-group scale. */
export async function getOnboardingOverview(
  admin: SupabaseClient<Database>
): Promise<Map<string, OnboardingOverviewRow>> {
  const { data, error } = await admin
    .from("onboarding_sessions")
    .select("user_id, stage, status, updated_at, messages, modules");
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.user_id, summarizeOnboardingSession(row as OnboardingSessionRow)]));
}
