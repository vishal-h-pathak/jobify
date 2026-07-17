import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";

export type DispatchTailorResult =
  | { kind: "not_configured" }
  | { kind: "budget_exceeded" }
  | { kind: "daily_limit"; count: number }
  | { kind: "cooldown" } // an active run already exists for this posting
  | { kind: "dispatch_failed"; status: number }
  | { kind: "ok"; runId: string };

export interface DispatchTailorDeps {
  admin: SupabaseClient<Database>;
  targetUserId: string;
  postingId: string;
  mode: "tailor" | "render"; // this task's route only ever passes "tailor"; kept for the type's honesty
  template: string | null;
  isByo: boolean; // caller already checked api_keys via getApiKeyInfo
  monthToDateSpend: number; // caller already computed via getMonthToDateSpend
  budgetCap: number; // caller already computed via getBudgetCap
  dailyLimit: number; // 5, injected so tests don't hardcode it twice
  githubRepo: string | undefined;
  githubToken: string | undefined;
  fetchImpl: typeof fetch;
  now: () => Date;
}

/**
 * Core logic behind `POST /api/tailor/run`, factored out of the route
 * handler so it's directly unit-testable with a fake `admin`/`fetchImpl`/
 * `now` — see `dispatchTailor.test.ts`. The route owns turning each
 * `DispatchTailorResult` into the right HTTP status; this function never
 * touches `NextResponse`.
 *
 * Sequence (session V3B-S2, task 2 brief + global-constraints judgment
 * calls #2-6): config check (before any DB work, since dispatch can never
 * succeed without it) -> pool-budget gate (BYO-exempt) -> 5/day counter
 * (uniform, no BYO exemption) -> insert (unique-violation = cooldown,
 * race-safe vs. a pre-check-then-insert) -> GitHub Actions dispatch ->
 * dispatch-failure marks the row `failed` synchronously so it doesn't sit
 * as a phantom `queued` row until the stale-reap.
 */
export async function dispatchTailor(deps: DispatchTailorDeps): Promise<DispatchTailorResult> {
  const {
    admin,
    targetUserId,
    postingId,
    mode,
    template,
    isByo,
    monthToDateSpend,
    budgetCap,
    dailyLimit,
    githubRepo,
    githubToken,
    fetchImpl,
    now,
  } = deps;

  if (!githubRepo || !githubToken) {
    return { kind: "not_configured" };
  }

  if (!isByo && monthToDateSpend >= budgetCap) {
    return { kind: "budget_exceeded" };
  }

  const dayStart = new Date(now());
  dayStart.setUTCHours(0, 0, 0, 0);

  // Daily counter is scoped to `mode = 'tailor'` specifically (task 2
  // brief), not whatever `mode` this particular call happens to carry —
  // it's the count of actual tailoring generations today, independent of
  // any future `render` dispatches.
  const { count, error: countError } = await admin
    .from("tailor_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", targetUserId)
    .eq("mode", "tailor")
    .gte("created_at", dayStart.toISOString());
  if (countError) throw countError;
  if ((count ?? 0) >= dailyLimit) {
    return { kind: "daily_limit", count: count ?? 0 };
  }

  const { data: inserted, error: insertError } = await admin
    .from("tailor_runs")
    .insert({ user_id: targetUserId, posting_id: postingId, mode, template })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      return { kind: "cooldown" };
    }
    throw insertError;
  }
  const runId = inserted.id;

  // Never log or echo `githubToken` anywhere below this line — only the
  // Authorization header value, never surfaced in a response or thrown
  // error.
  //
  // `template` is sent as `""` rather than omitted when null: GitHub
  // Actions workflow_dispatch string inputs reject `null`, and always
  // sending the key (vs. conditionally spreading it in) keeps the payload
  // shape uniform and simpler to assert on in tests.
  const res = await fetchImpl(
    `https://api.github.com/repos/${githubRepo}/actions/workflows/hosted-tailor.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          user_id: targetUserId,
          posting_id: postingId,
          run_id: runId,
          mode,
          template: template ?? "",
        },
      }),
    }
  );

  if (res.status !== 204) {
    const { error: updateError } = await admin
      .from("tailor_runs")
      .update({ status: "failed", error: `dispatch failed (status ${res.status})` })
      .eq("id", runId);
    if (updateError) throw updateError;
    return { kind: "dispatch_failed", status: res.status };
  }

  return { kind: "ok", runId };
}
