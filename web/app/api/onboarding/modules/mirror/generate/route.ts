import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { recordOnboardingTurn } from "@/lib/db/ledger";
import { ONBOARDING_MODEL } from "@/lib/anthropic/client";
import { runMirrorGenerationTurn } from "@/lib/anthropic/moduleTurns";
import { filterVerbatim } from "@/lib/onboarding/verbatim";

const REGENERATION_BUDGET = 2;

interface MirrorDraft {
  paragraphs: [string, string];
  quoted_phrases: string[];
}

/**
 * Cockpit fix 2026-07-20 (live incident, two users): a draft whose
 * paragraphs are both blank is a FAILED generation, not a draft. It must
 * never be persisted over the session, never satisfy the budget
 * short-circuit, and never be returned as a 200 success — the old behavior
 * persisted ["", ""] as if real, then served it stale forever once the
 * budget was spent, wedging the user on an empty mirror page with a
 * "Try again" that did nothing.
 */
function draftIsEmpty(draft: MirrorDraft | null | undefined): boolean {
  if (!draft || !Array.isArray(draft.paragraphs)) return true;
  const [p1, p2] = draft.paragraphs;
  return !(p1 ?? "").trim() && !(p2 ?? "").trim();
}

/**
 * Builds the mirror-generation prompt input from whatever's populated in
 * `session.extracted` so far — plain labeled sections, not an error if a
 * piece is missing (most fields here are optional per the module-progress
 * model; a candidate can reach the mirror moment without having filled
 * every phase-2 module).
 */
function buildExtractedSummary(extracted: Record<string, unknown>): string {
  const sections: string[] = [];

  const anchor = extracted.anchor as Record<string, unknown> | undefined;
  if (anchor && typeof anchor === "object" && Object.keys(anchor).length > 0) {
    sections.push(`Anchor: ${JSON.stringify(anchor)}`);
  }

  const values = extracted.values;
  const hasValues =
    (Array.isArray(values) && values.length > 0) ||
    (values && typeof values === "object" && !Array.isArray(values) && Object.keys(values).length > 0);
  if (hasValues) {
    sections.push(`Values choices: ${JSON.stringify(values)}`);
  }

  const energy = extracted.energy as Record<string, unknown> | undefined;
  if (energy && typeof energy === "object" && Object.keys(energy).length > 0) {
    sections.push(`Energy answers: ${JSON.stringify(energy)}`);
  }

  const environment = extracted.environment;
  const hasEnvironment =
    (Array.isArray(environment) && environment.length > 0) ||
    (environment && typeof environment === "object" && !Array.isArray(environment) && Object.keys(environment).length > 0);
  if (hasEnvironment) {
    sections.push(`Environment choices: ${JSON.stringify(environment)}`);
  }

  const trajectory = extracted.trajectory as Record<string, unknown> | undefined;
  if (trajectory && typeof trajectory === "object" && Object.keys(trajectory).length > 0) {
    sections.push(`Trajectory: ${JSON.stringify(trajectory)}`);
  }

  const calibration = extracted.calibration as { evidence?: unknown; range_statement?: unknown } | undefined;
  if (calibration) {
    const evidence = Array.isArray(calibration.evidence)
      ? (calibration.evidence as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    if (evidence.length > 0) {
      sections.push(`Calibration evidence: ${evidence.join("; ")}`);
    }
    if (typeof calibration.range_statement === "string" && calibration.range_statement.trim()) {
      sections.push(`Range statement: ${calibration.range_statement.trim()}`);
    }
  }

  const targeting = extracted.targeting as { thesis_summary?: unknown } | undefined;
  if (targeting && typeof targeting.thesis_summary === "string" && targeting.thesis_summary.trim()) {
    sections.push(`Targeting thesis summary: ${targeting.thesis_summary.trim()}`);
  }

  return sections.join("\n\n");
}

function userMessagesText(session: { messages: Array<{ role: string; content: string }> }): string {
  return (session.messages ?? [])
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

/**
 * V3A-B2 task 5: the mirror-generation POST. `mirror_generation_count`
 * (stored on `session.extracted`) is the single shared budget for BOTH the
 * design's "regenerate once on a low-quote failure" and the UI's "Try
 * again (one regen max)" — every `runMirrorGenerationTurn` call this route
 * makes increments the same counter regardless of what triggered it, capped
 * at `REGENERATION_BUDGET` (2) total calls per session.
 *
 * Cockpit fix 2026-07-20: the budget short-circuit only applies when a REAL
 * (non-empty) draft exists — a session whose budget was consumed by failed
 * generations self-heals on the next click instead of being wedged forever.
 * Spend stays bounded per click (≤2 calls, both ledgered) and visible in
 * budget_ledger; a failed result returns 502 with an error body instead of
 * persisting an empty draft as success.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!isAdmin(user) && !(await hasClaimedInvite(supabase))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const session = await getOrCreateSession(supabase, user.id);
  const startingCount =
    typeof session.extracted.mirror_generation_count === "number" ? session.extracted.mirror_generation_count : 0;
  const existingDraft = session.extracted.mirror_draft as MirrorDraft | undefined;

  // Budget already spent AND we actually have a draft to show — return it
  // unchanged rather than calling the model again. Not a 409. (If the
  // stored draft is empty, the budget was consumed by failures — fall
  // through and regenerate; see the cockpit-fix note above.)
  if (startingCount >= REGENERATION_BUDGET && !draftIsEmpty(existingDraft)) {
    return NextResponse.json(existingDraft);
  }

  const extractedSummary = buildExtractedSummary(session.extracted);
  const corpus = userMessagesText(session);
  const admin = createSupabaseAdminClient();

  let count = startingCount;
  let turnResult = await runMirrorGenerationTurn({ extractedSummary });
  await recordOnboardingTurn(admin, {
    userId: user.id,
    model: ONBOARDING_MODEL,
    inputTokens: turnResult.usage.inputTokens,
    outputTokens: turnResult.usage.outputTokens,
  });
  count += 1;
  let quotedPhrases = filterVerbatim(turnResult.quoted_phrases, (phrase) => phrase, corpus);

  // Normal path keeps the original session-total cap (REGENERATION_BUDGET);
  // only a wedged session (budget already spent on failures, empty draft)
  // gets a fresh per-click allowance for the self-heal regeneration.
  const allowedTotal =
    startingCount >= REGENERATION_BUDGET ? startingCount + REGENERATION_BUDGET : REGENERATION_BUDGET;
  if ((quotedPhrases.length < 2 || draftIsEmpty({ paragraphs: turnResult.paragraphs, quoted_phrases: quotedPhrases }))
      && count < allowedTotal) {
    turnResult = await runMirrorGenerationTurn({ extractedSummary });
    await recordOnboardingTurn(admin, {
      userId: user.id,
      model: ONBOARDING_MODEL,
      inputTokens: turnResult.usage.inputTokens,
      outputTokens: turnResult.usage.outputTokens,
    });
    count += 1;
    quotedPhrases = filterVerbatim(turnResult.quoted_phrases, (phrase) => phrase, corpus);
  }

  const mirrorDraft: MirrorDraft = { paragraphs: turnResult.paragraphs, quoted_phrases: quotedPhrases };

  if (draftIsEmpty(mirrorDraft)) {
    // Failed generation: record the spend (count), but never persist the
    // empty draft — keep whatever draft existed before (possibly none) so
    // the next click regenerates instead of serving emptiness as success.
    console.error(
      `[mirror/generate] generation returned empty paragraphs for user ${user.id} (count now ${count}) — not persisting`
    );
    await saveSession(supabase, user.id, {
      extracted: { ...session.extracted, mirror_generation_count: count },
    });
    return NextResponse.json(
      { error: "mirror generation returned empty output — please try again" },
      { status: 502 }
    );
  }

  const extracted = {
    ...session.extracted,
    mirror_draft: mirrorDraft,
    mirror_generation_count: count,
  };
  await saveSession(supabase, user.id, { extracted });

  return NextResponse.json(mirrorDraft);
}
