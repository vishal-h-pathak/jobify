import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MatchCard } from "@/components/feed/MatchCard";
import { ProfileHealthBanner } from "@/components/feed/ProfileHealthBanner";
import {
  groupMatches,
  markSeenBulk,
  sortByBestScore,
  type MatchRow,
  type MatchWithPosting,
  type PostingRow,
} from "@/lib/db/matches";

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

  const { data: matchesData, error: matchesError } = await supabase
    .from("matches")
    .select("*")
    .eq("user_id", user.id);
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
  const newSorted = sortByBestScore(grouped.new);
  const savedSorted = sortByBestScore(grouped.saved);
  const appliedSorted = sortByBestScore(grouped.applied);
  const dismissedSorted = sortByBestScore(grouped.dismissed);

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

      <h1 className="text-2xl font-semibold tracking-tight">Your feed</h1>

      {totalMatches === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing yet — your profile is built and waiting on its first cycle. The hunter runs daily, so check back
          tomorrow.
        </p>
      )}

      {onlyDismissedLeft && (
        <p className="text-zinc-600 dark:text-zinc-400">
          You&apos;ve cleared everything for now — new postings show up here as tomorrow&apos;s run comes in.
        </p>
      )}

      {newSorted.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">New</h2>
          {newSorted.map((m) => (
            <MatchCard key={m.posting_id} match={m} />
          ))}
        </section>
      )}

      {savedSorted.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Saved</h2>
          {savedSorted.map((m) => (
            <MatchCard key={m.posting_id} match={m} />
          ))}
        </section>
      )}

      {appliedSorted.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Applied</h2>
          {appliedSorted.map((m) => (
            <MatchCard key={m.posting_id} match={m} />
          ))}
        </section>
      )}

      {dismissedSorted.length > 0 && (
        <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-500">
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
