import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { getProfileDoc } from "@/lib/db/profiles";
import { hasClaimedInvite } from "@/lib/db/invites";
import { isAdmin } from "@/lib/admin/isAdmin";
import { recordOnboardingTurn } from "@/lib/db/ledger";
import { ONBOARDING_MODEL } from "@/lib/anthropic/client";
import { runMetricsExtractionTurn } from "@/lib/anthropic/moduleTurns";
import { filterVerbatim } from "@/lib/onboarding/verbatim";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * V3A-B2 task 5: the pre-marking metrics-extraction step. Sweeps EVERYTHING
 * known about the candidate (cv.md, calibration evidence/range statement,
 * energy answers, anchor free text, and every raw user chat message) into
 * one big text blob for `runMetricsExtractionTurn`, then verbatim-filters
 * the returned claims against that same blob. Does not mark the module
 * complete — that's the sibling marking POST (`../route.ts`), once the
 * human has reviewed these claims.
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
  const profileDoc = await getProfileDoc(supabase, user.id);

  const calibration = session.extracted.calibration as
    | { evidence?: unknown; range_statement?: unknown }
    | undefined;
  const energy = session.extracted.energy as
    | { hours_disappear?: unknown; kept_putting_off?: unknown }
    | undefined;
  const anchor = session.extracted.anchor as
    | { free_text?: unknown; current_title?: unknown; current_company?: unknown }
    | undefined;

  const evidenceLines = Array.isArray(calibration?.evidence)
    ? (calibration?.evidence as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const userMessages = (session.messages ?? [])
    .filter((m) => m.role === "user")
    .map((m) => m.content);

  const parts: string[] = [
    asString(profileDoc?.doc["cv.md"]),
    ...evidenceLines,
    asString(calibration?.range_statement),
    asString(energy?.hours_disappear),
    asString(energy?.kept_putting_off),
    asString(anchor?.free_text),
    asString(anchor?.current_title),
    asString(anchor?.current_company),
    ...userMessages,
  ];

  const searchableText = parts.join("\n");

  const turnResult = await runMetricsExtractionTurn(searchableText);

  await recordOnboardingTurn(createSupabaseAdminClient(), {
    userId: user.id,
    model: ONBOARDING_MODEL,
    inputTokens: turnResult.usage.inputTokens,
    outputTokens: turnResult.usage.outputTokens,
  });

  const filteredClaims = filterVerbatim(turnResult.claims, (claim) => claim.text, searchableText);

  const extracted = { ...session.extracted, metrics: { claims: filteredClaims } };
  await saveSession(supabase, user.id, { extracted });

  return NextResponse.json({ claims: filteredClaims });
}
