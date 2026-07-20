import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MatchCard } from "@/components/feed/MatchCard";
import { ProfileHealthBanner } from "@/components/feed/ProfileHealthBanner";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  groupMatches,
  markSeenBulk,
  sortByTierThenScore,
  type MatchRow,
  type MatchWithPosting,
  type PostingRow,
} from "@/lib/db/matches";
import { RunHuntButton } from "./RunHuntButton";

// Per-user live read, not cacheable — mirrors the (app) layout's own
// `force-dynamic` (auth.getUser() + a fresh matches/postings read every
// visit, including the batched new -> seen mark below).
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("validation_status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  // No row yet == onboarding never finished (profiles rows are only
  // written by the onboarding chat's final turn) -> send them there.
  if (!profile) redirect("/onboarding");

  // P0.5 (HUNT2 session 47): `matches` now carries a row for every
  // scored posting (rejected_title/rejected_rubric/rejected_rerank/
  // rejected_llm/surfaced) — filter to surfaced-only so rejected rows
  // never leak into the feed.
  const { data: matchesData, error: matchesError } = await supabase
    .from("matches")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "surfaced");
  if (matchesError) throw matchesError;
  const matches: MatchRow[] = matchesData ?? [];

  const postingIds = matches.map((m) => m.posting_id);
  let postings: PostingRow[] = [];
  if (postingIds.length > 0) {
    const { data, error } = await supabase.from("postings").select("*").in("id", postingIds);
    if (error) throw error;
    postings = data ?? [];
  }
  const postingsById = new Map(postings.map((p) => [p.id, p]));

  const withPosting: MatchWithPosting[] = matches.flatMap((m) => {
    const posting = postingsById.get(m.posting_id);
    return posting ? [{ ...m, posting }] : [];
  });

  const grouped = groupMatches(withPosting);
  const newSorted = sortByTierThenScore(grouped.new);
  const savedSorted = sortByTierThenScore(grouped.saved);
  const appliedSorted = sortByTierThenScore(grouped.applied);
  const dismissedSorted = sortByTierThenScore(grouped.dismissed);

  // Batched, not per-card: mark every 'new' row about to render as 'seen'
  // in one UPDATE before the response streams out.
  const stillNewIds = grouped.new.filter((m) => m.state === "new").map((m) => m.posting_id);
  if (stillNewIds.length > 0) {
    await markSeenBulk(supabase, user.id, stillNewIds);
  }

  const totalMatches = withPosting.length;
  const onlyDismissedLeft =
    totalMatches > 0 && newSorted.length === 0 && savedSorted.length === 0 && appliedSorted.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      {profile.validation_status?.status === "invalid" && (
        <ProfileHealthBanner errors={profile.validation_status.errors} />
      )}

      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Your feed</h1>
        <RunHuntButton />
      </div>

      {totalMatches === 0 && (
        <EmptyState
          heading="Nothing yet"
          message="Your profile is built — the hunter runs when you ask. Hit &quot;Run my hunt&quot; above to get your first results."
        />
      )}

      {onlyDismissedLeft && (
        <EmptyState
          heading="You're all caught up"
          message="You've cleared everything for now — new postings show up here as tomorrow's run comes in."
        />
      )}

      {newSorted.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">New ({newSorted.length})</h2>
          {newSorted.map((m) => (
            <MatchCard key={m.posting_id} match={m} />
          ))}
        </section>
      )}

      {savedSorted.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Saved ({savedSorted.length})
          </h2>
          {savedSorted.map((m) => (
            <MatchCard key={m.posting_id} match={m} />
          ))}
        </section>
      )}

      {appliedSorted.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Applied ({appliedSorted.length})
          </h2>
          {appliedSorted.map((m) => (
            <MatchCard key={m.posting_id} match={m} />
          ))}
        </section>
      )}

      {dismissedSorted.length > 0 && (
        <details className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-muted">
            Dismissed ({dismissedSorted.length})
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {dismissedSorted.map((m) => (
              <MatchCard key={m.posting_id} match={m} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
