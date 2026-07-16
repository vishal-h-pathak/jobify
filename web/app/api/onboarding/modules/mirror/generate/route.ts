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

  // Budget already spent (two manual clicks, or one manual click plus one
  // auto-retry) — a "Try again" click after that returns the stale draft
  // unchanged rather than calling the model a third time. Not a 409.
  if (startingCount >= REGENERATION_BUDGET) {
    const existingDraft = (session.extracted.mirror_draft as MirrorDraft | undefined) ?? {
      paragraphs: ["", ""],
      quoted_phrases: [],
    };
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

  if (quotedPhrases.length < 2 && count < REGENERATION_BUDGET) {
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
  const extracted = {
    ...session.extracted,
    mirror_draft: mirrorDraft,
    mirror_generation_count: count,
  };
  await saveSession(supabase, user.id, { extracted });

  return NextResponse.json(mirrorDraft);
}
