import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { getProfileDoc, upsertProfileDoc } from "@/lib/db/profiles";
import { hasAccess } from "@/lib/db/access";
import { recordOnboardingTurn } from "@/lib/db/ledger";
import { ONBOARDING_MODEL } from "@/lib/anthropic/client";
import { runDeckGenerationTurn, type DeckScenario } from "@/lib/anthropic/moduleTurns";
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

// INT2-B (session-prompts/56_int2_deck.md): the profile-conditioned reaction
// deck — a one-shot, metered LLM call replaces "real live postings" as the
// module's default card source, with the pre-existing live-postings
// sampling below kept as the failure fallback (never blocks the module).
const DECK_SIZE = 8;
const MIN_PROBE_DIMENSIONS = 4;
const DECK_GENERATION_ATTEMPTS = 2; // one shot + one regen on a dimension-spread/shape failure
const CV_EXCERPT_MAX_CHARS = 6000;

interface DeckCard {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  org_flavor?: string;
  gist?: string;
}

/**
 * Anchor + resume + stated direction only — same "assemble whatever's
 * populated, nothing is required" style as the mirror route's
 * buildExtractedSummary, since reactions runs early in phase 1 and most of
 * these fields (especially trajectory, a phase-2 module) are often absent.
 */
function buildDeckProfileSummary(extracted: Record<string, unknown>): string {
  const sections: string[] = [];

  const anchor = extracted.anchor as { current_title?: unknown; current_company?: unknown; free_text?: unknown } | undefined;
  if (anchor && typeof anchor === "object") {
    const parts: string[] = [];
    if (typeof anchor.current_title === "string" && anchor.current_title.trim()) parts.push(`title: ${anchor.current_title.trim()}`);
    if (typeof anchor.current_company === "string" && anchor.current_company.trim()) parts.push(`company: ${anchor.current_company.trim()}`);
    if (typeof anchor.free_text === "string" && anchor.free_text.trim()) parts.push(`notes: ${anchor.free_text.trim()}`);
    if (parts.length) sections.push(`Candidate's current anchor — ${parts.join("; ")}`);
  }

  const resume = extracted.resume as { cv_markdown?: unknown } | undefined;
  if (resume && typeof resume.cv_markdown === "string" && resume.cv_markdown.trim()) {
    sections.push(`Resume (excerpt):\n${resume.cv_markdown.trim().slice(0, CV_EXCERPT_MAX_CHARS)}`);
  }

  const trajectory = extracted.trajectory as { direction?: unknown } | undefined;
  if (trajectory && typeof trajectory === "object" && typeof trajectory.direction === "string" && trajectory.direction.trim()) {
    sections.push(`Stated direction: ${trajectory.direction.trim()}`);
  }

  return sections.join("\n\n");
}

function distinctProbeDimensions(scenarios: DeckScenario[]): number {
  return new Set(scenarios.map((s) => s.probe.trim().toLowerCase()).filter(Boolean)).size;
}

/**
 * Mirror-incident lesson (see mirror/generate/route.ts's draftIsEmpty): a
 * deck that's short of cards or clustered on <4 probe dimensions is a
 * FAILED generation, not a usable one — it must never be persisted or
 * served as if real.
 */
function deckIsUsable(scenarios: DeckScenario[]): boolean {
  return scenarios.length === DECK_SIZE && distinctProbeDimensions(scenarios) >= MIN_PROBE_DIMENSIONS;
}

function scenarioToCard(scenario: DeckScenario): DeckCard {
  return { id: scenario.id, title: scenario.title, company: null, location: null, org_flavor: scenario.org_flavor, gist: scenario.gist };
}

/**
 * One metered `deck_gen` call, regenerated once on a dimension-spread/shape
 * failure, then given up on — the caller falls back to the static
 * (live-postings) deck rather than blocking the module. Never returns a
 * deck that fails `deckIsUsable`.
 */
async function generateReactionDeck(userId: string, extracted: Record<string, unknown>): Promise<DeckScenario[] | null> {
  const profileSummary = buildDeckProfileSummary(extracted);
  const admin = createSupabaseAdminClient();

  for (let attempt = 1; attempt <= DECK_GENERATION_ATTEMPTS; attempt++) {
    const turnResult = await runDeckGenerationTurn({ profileSummary });
    await recordOnboardingTurn(admin, {
      userId,
      model: ONBOARDING_MODEL,
      inputTokens: turnResult.usage.inputTokens,
      outputTokens: turnResult.usage.outputTokens,
      event: "deck_gen",
    });
    if (deckIsUsable(turnResult.scenarios)) return turnResult.scenarios;
  }

  console.error(
    `[reactions] deck generation failed the shape/dimension-spread check after ${DECK_GENERATION_ATTEMPTS} attempts for user ${userId} — falling back to the static deck`
  );
  return null;
}

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
 * INT2-B: serves the profile-conditioned reaction deck for the swipe
 * calibration step — generated once per session (metered `deck_gen` call)
 * and stored on `extracted.reaction_deck`, then served as-is on every
 * subsequent call until an admin reset clears it. Falls back to the ONB
 * (V3a task 3) live-postings sample — 6-8 real postings near the user's
 * anchor, also the direct supervised signal for the ranker — if generation
 * fails twice; that fallback never blocks the module.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { user, response } = await requireCaller(supabase);
  if (!user) return response;

  const session = await getOrCreateSession(supabase, user.id);

  const existingDeck = session.extracted.reaction_deck as DeckScenario[] | undefined;
  if (existingDeck && existingDeck.length) {
    return NextResponse.json({ postings: existingDeck.map(scenarioToCard) });
  }

  const generatedDeck = await generateReactionDeck(user.id, session.extracted);
  if (generatedDeck) {
    await saveSession(supabase, user.id, { extracted: { ...session.extracted, reaction_deck: generatedDeck } });
    return NextResponse.json({ postings: generatedDeck.map(scenarioToCard) });
  }

  // Static-deck fallback: generation failed twice (or the module never had
  // enough to generate from) — never blocks the module, serve today's real
  // live-postings sample instead.
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

  const session = await getOrCreateSession(supabase, user.id);

  // INT2-B: deck cards are fictional scenarios with no row in `postings` —
  // `posting_reactions.posting_id` has a hard FK to `postings.id` (migration
  // 0011), so a deck-card reaction skips that table entirely and writes only
  // to `extracted.reactions`, which is already the sole source the
  // receipt/doc-writer/checkpoint logic below reads.
  const deck = session.extracted.reaction_deck as DeckScenario[] | undefined;
  const deckCard = deck?.find((card) => card.id === postingId);

  let entry: ReactionEntry;
  if (deckCard) {
    entry = {
      posting_id: postingId,
      title: deckCard.title,
      company: deckCard.org_flavor,
      reaction,
      ...(note ? { note } : {}),
    };
  } else {
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

    entry = {
      posting_id: postingId,
      title: posting.title ?? "",
      company: posting.company,
      reaction,
      ...(note ? { note } : {}),
    };
  }

  const previousReactions = (session.extracted.reactions as ReactionEntry[] | undefined) ?? [];
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
