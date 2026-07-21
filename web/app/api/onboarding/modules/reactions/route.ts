import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { getProfileDoc, upsertProfileDoc } from "@/lib/db/profiles";
import { hasAccess } from "@/lib/db/access";
import {
  hasReachedReactionThreshold,
  reactionsReceipt,
  sampleReactionPostings,
  type ReactionEntry,
} from "@/lib/onboarding/reactions";
import { buildCheckpointDeps } from "@/lib/onboarding/checkpointDeps";
// V3A-1 contract (session-prompts/31_v3a_modules.md, pinned block): these
// three files are owned by the parallel session 30 (branch feat/v3a-spine)
// and don't exist yet as of this session — see the [key]/route.ts note.
import { markModuleComplete } from "@/lib/onboarding/moduleRegistry";
import { applyModuleToDoc } from "@/lib/onboarding/incrementalDoc";
import { maybeFireCheckpoint } from "@/lib/onboarding/checkpoint";

const FRESHNESS_DAYS = 14;
const CANDIDATE_POOL_LIMIT = 200;

async function requireCaller(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, response: NextResponse.json({ error: "not signed in" }, { status: 401 }) };
  if (!(await hasAccess(supabase, user))) {
    return { user: null, response: NextResponse.json({ error: "invite required" }, { status: 403 }) };
  }
  return { user, response: null };
}

function anchorTitleFrom(extracted: Record<string, unknown>): string | undefined {
  const anchor = extracted.anchor as { current_title?: string; free_text?: string } | undefined;
  return anchor?.current_title || anchor?.free_text;
}

/**
 * ONB (V3a task 3): samples 6-8 live postings near the user's anchor for
 * the swipe-interested/not calibration step — the product demo inside
 * onboarding, and direct supervised signal for the ranker.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { user, response } = await requireCaller(supabase);
  if (!user) return response;

  const session = await getOrCreateSession(supabase, user.id);
  const anchorTitle = anchorTitleFrom(session.extracted);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FRESHNESS_DAYS);

  const [postingsRes, reactedRes] = await Promise.all([
    supabase
      .from("postings")
      .select("id, title, company, location, last_seen_at")
      .neq("link_status", "expired")
      .gte("last_seen_at", cutoff.toISOString())
      .order("last_seen_at", { ascending: false })
      .limit(CANDIDATE_POOL_LIMIT),
    supabase.from("posting_reactions").select("posting_id").eq("user_id", user.id),
  ]);
  if (postingsRes.error) throw postingsRes.error;
  if (reactedRes.error) throw reactedRes.error;

  const reactedPostingIds = new Set((reactedRes.data ?? []).map((row) => row.posting_id));
  const postings = sampleReactionPostings({
    anchorTitle,
    candidates: postingsRes.data ?? [],
    reactedPostingIds,
  });

  return NextResponse.json({ postings });
}

interface ReactionRequestBody {
  posting_id?: unknown;
  reaction?: unknown;
  note?: unknown;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { user, response } = await requireCaller(supabase);
  if (!user) return response;

  const body = (await request.json().catch(() => null)) as ReactionRequestBody | null;
  const postingId = typeof body?.posting_id === "string" ? body.posting_id.trim() : "";
  const reaction = body?.reaction;
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;

  if (!postingId) {
    return NextResponse.json({ error: "posting_id is required" }, { status: 400 });
  }
  if (reaction !== "interested" && reaction !== "not_interested") {
    return NextResponse.json({ error: 'reaction must be "interested" or "not_interested"' }, { status: 400 });
  }

  const { data: posting, error: postingError } = await supabase
    .from("postings")
    .select("id, title, company")
    .eq("id", postingId)
    .maybeSingle();
  if (postingError) throw postingError;
  if (!posting) {
    return NextResponse.json({ error: "posting not found" }, { status: 404 });
  }

  const { error: upsertError } = await supabase
    .from("posting_reactions")
    .upsert({ user_id: user.id, posting_id: postingId, reaction, note: note ?? null }, { onConflict: "user_id,posting_id" });
  if (upsertError) throw upsertError;

  const session = await getOrCreateSession(supabase, user.id);
  const previousReactions = (session.extracted.reactions as ReactionEntry[] | undefined) ?? [];
  const entry: ReactionEntry = {
    posting_id: postingId,
    title: posting.title ?? "",
    company: posting.company,
    reaction,
    ...(note ? { note } : {}),
  };
  // "upsert allows changed minds" — replace this posting's prior reaction
  // rather than accumulating duplicates for the same posting.
  const reactions = [...previousReactions.filter((r) => r.posting_id !== postingId), entry];
  const extracted = { ...session.extracted, reactions };

  await saveSession(supabase, user.id, { extracted });

  const complete = hasReachedReactionThreshold(reactions);
  if (complete) {
    const receipt = reactionsReceipt(reactions);
    // V3A-1 contract: markModuleComplete returns the updated `modules`
    // jsonb; idempotent across repeated calls once already complete.
    const modules = markModuleComplete(session, "reactions", receipt);
    await saveSession(supabase, user.id, { extracted, modules });

    const profileDoc = await getProfileDoc(supabase, user.id);
    if (profileDoc) {
      // applyModuleToDoc's "reactions" case reads `extracted.reactions` —
      // it expects the array wrapped in an object, not passed bare.
      const updatedDoc = applyModuleToDoc(profileDoc.doc, "reactions", { reactions });
      await upsertProfileDoc(supabase, user.id, updatedDoc);
    }

    await maybeFireCheckpoint(buildCheckpointDeps(), { ...session, extracted, modules }, user);
  }

  return NextResponse.json({ ok: true, reaction_count: reactions.length, complete });
}
