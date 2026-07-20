import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { DEFAULT_MONTHLY_USD_CAP, getBudgetCap } from "@/lib/db/ledger";
import { summarizeOnboardingSession, type OnboardingOverviewRow } from "./onboardingOverview";
import { aggregateHuntFeedOverview, emptyHuntFeedRow, type UserHuntFeedRow } from "./huntFeedOverview";

export interface UserProfileReview {
  extracted: Record<string, unknown>;
  doc: Record<string, string> | null;
  validationStatus: { status: string; errors: string[] } | null;
  /** ADM-3 §3: null only when the user has no `onboarding_sessions` row at
   * all (shouldn't happen for anyone this panel is reachable for, but the
   * row is fetched independently of `profiles`, so guard it anyway). */
  onboarding: OnboardingOverviewRow | null;
  /** ADM-3 §4: this user's matches funnel + surfaced location-tier mix. */
  huntFeed: UserHuntFeedRow;
  /** ADM-3 §1/§3: this user's month-to-date pool spend vs their cap —
   * "per-module" $ breakdown isn't derivable (every onboarding-turn ledger
   * row shares one `event` value regardless of which module fired it); see
   * `onboarding.modules` above for per-module done/not instead. */
  spend: { mtdUsd: number; capUsd: number };
}

function monthStartIso(): string {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  return monthStart.toISOString();
}

/**
 * Session 29 (ONB-D) task 1: the admin "Review profile" panel's data —
 * read-only, service-role only (caller must have already passed
 * `requireAdmin()`). Two independent tables since onboarding's working
 * state (`onboarding_sessions.extracted`) and the finished doc
 * (`profiles.doc` + `validation_status`) live separately; either can be
 * absent (in-progress onboarding has no profiles row yet).
 *
 * ADM-3: extended with onboarding behavior, hunt/feed funnel, and spend-vs-
 * cap — all fetched fresh per drill-in (this route already runs on demand,
 * not on every admin page load) rather than reusing the bulk `*Overview`
 * maps built for the admin page's other cards.
 */
export async function getUserProfileReview(
  admin: SupabaseClient<Database>,
  userId: string
): Promise<UserProfileReview> {
  const [sessionRes, profileRes, fullSessionRes, matchesRes, capUsd, ledgerRes] = await Promise.all([
    admin.from("onboarding_sessions").select("extracted").eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("doc, validation_status").eq("user_id", userId).maybeSingle(),
    admin.from("onboarding_sessions").select("user_id, stage, status, updated_at, messages, modules").eq("user_id", userId).maybeSingle(),
    admin.from("matches").select("user_id, status, location_tier").eq("user_id", userId),
    getBudgetCap(admin, userId).catch(() => DEFAULT_MONTHLY_USD_CAP),
    admin.from("budget_ledger").select("cost_usd").eq("user_id", userId).eq("byo", false).gte("created_at", monthStartIso()),
  ]);
  if (sessionRes.error) throw sessionRes.error;
  if (profileRes.error) throw profileRes.error;
  if (fullSessionRes.error) throw fullSessionRes.error;
  if (matchesRes.error) throw matchesRes.error;
  if (ledgerRes.error) throw ledgerRes.error;

  const onboarding = fullSessionRes.data
    ? summarizeOnboardingSession(fullSessionRes.data as Parameters<typeof summarizeOnboardingSession>[0])
    : null;
  const huntFeed =
    aggregateHuntFeedOverview((matchesRes.data ?? []) as Parameters<typeof aggregateHuntFeedOverview>[0]).get(userId) ??
    emptyHuntFeedRow(userId);
  const mtdUsd = (ledgerRes.data ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);

  return {
    extracted: sessionRes.data?.extracted ?? {},
    doc: profileRes.data?.doc ?? null,
    validationStatus: profileRes.data?.validation_status ?? null,
    onboarding,
    huntFeed,
    spend: { mtdUsd, capUsd },
  };
}
