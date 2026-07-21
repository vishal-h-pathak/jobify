import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrCreateSession, saveSession } from "@/lib/db/onboardingSession";
import { getProfileDoc, upsertProfileDoc } from "@/lib/db/profiles";
import { hasAccess } from "@/lib/db/access";
import { MODULE_REGISTRY, markModuleComplete } from "@/lib/onboarding/moduleRegistry";
import {
  applyMetricsToDoc,
  splitMetricClaims,
  type MetricClaim,
  type MetricMark,
} from "@/lib/onboarding/moduleWriters/metrics";

interface MetricsMarkRequestBody {
  marks?: unknown;
}

function parseMarks(value: unknown): MetricMark[] | null {
  if (!Array.isArray(value)) return null;
  const marks: MetricMark[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const id = (entry as { id?: unknown }).id;
    const confident = (entry as { confident?: unknown }).confident;
    if (typeof id !== "string" || !id.trim()) return null;
    if (typeof confident !== "boolean") return null;
    marks.push({ id, confident });
  }
  return marks;
}

/**
 * V3A-B2 task 5: the metrics marking POST — zero-LLM. Reads the claims the
 * sibling `extract/route.ts` already extracted and verbatim-filtered, and
 * requires the human to have marked every single one (no unknown ids, no
 * missing ids) before this module can be marked complete, matching the
 * strict-validation style of `moduleWriters/dealbreakers.ts::parseDealbreakersBody`.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!(await hasAccess(supabase, user))) {
    return NextResponse.json({ error: "invite required" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as MetricsMarkRequestBody | null;
  const marks = parseMarks(body?.marks);
  if (marks === null) {
    return NextResponse.json(
      { error: "marks must be an array of {id: string, confident: boolean}" },
      { status: 400 }
    );
  }

  const session = await getOrCreateSession(supabase, user.id);
  const pending = session.extracted.metrics as { claims?: unknown } | undefined;
  const claims = Array.isArray(pending?.claims) ? (pending?.claims as MetricClaim[]) : null;
  if (claims === null) {
    return NextResponse.json(
      { error: "no extracted claims to mark — run metrics/extract first" },
      { status: 400 }
    );
  }

  const claimIds = new Set(claims.map((c) => c.id));
  const markIds = marks.map((m) => m.id);
  const markIdSet = new Set(markIds);
  const hasDuplicate = markIds.length !== markIdSet.size;
  const hasUnknownId = markIds.some((id) => !claimIds.has(id));
  const hasMissingId = claims.some((c) => !markIdSet.has(c.id));
  if (hasDuplicate || hasUnknownId || hasMissingId) {
    return NextResponse.json(
      { error: "marks must cover every extracted claim id exactly once, with no unknown ids" },
      { status: 400 }
    );
  }

  const { confirmed, neverUse } = splitMetricClaims(claims, marks);

  const extracted = {
    ...session.extracted,
    metrics: { claims, confirmed, never_use: neverUse },
  };
  const receipt = MODULE_REGISTRY.metrics.receipt({ metrics: { confirmed, never_use: neverUse } }) ?? "";
  const modules = markModuleComplete(session, "metrics", receipt);

  await saveSession(supabase, user.id, { extracted, modules });

  const profileDoc = await getProfileDoc(supabase, user.id);
  if (profileDoc) {
    const updatedDoc = applyMetricsToDoc(profileDoc.doc, claims, marks);
    await upsertProfileDoc(supabase, user.id, updatedDoc);
  }

  return NextResponse.json({ ok: true, key: "metrics", receipt });
}
