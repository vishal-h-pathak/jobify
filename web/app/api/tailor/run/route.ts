import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasAccess } from "@/lib/db/access";
import { getApiKeyInfo } from "@/lib/db/keys";
import { getBudgetCap, getMonthToDateSpend } from "@/lib/db/ledger";
import { dispatchTailor } from "@/lib/tailor/dispatchTailor";

const DAILY_LIMIT = 5;

/**
 * "Tailor this posting": dispatches `hosted-tailor.yml --posting <id>` for
 * the signed-in user's own posting via the GitHub Actions REST API. Same
 * auth pattern as `POST /api/hunt/run` (getUser -> invite-or-admin gate);
 * unlike hunt, there's no admin "run for user" override here — the caller
 * always targets themselves.
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

  const body = await request.json().catch(() => null);
  const postingId = typeof body?.posting_id === "string" ? body.posting_id : null;
  if (!postingId) {
    return NextResponse.json({ error: "posting_id is required" }, { status: 400 });
  }

  const mode = body?.mode === undefined ? "tailor" : body.mode;
  if (mode !== "tailor" && mode !== "render") {
    return NextResponse.json({ error: 'mode must be "tailor" or "render"' }, { status: 400 });
  }

  const template = typeof body?.template === "string" ? body.template : null;

  const [isByo, monthToDateSpend, budgetCap] = await Promise.all([
    getApiKeyInfo(supabase, user.id).then((info) => info !== null),
    getMonthToDateSpend(supabase, user.id),
    getBudgetCap(supabase, user.id),
  ]);

  const result = await dispatchTailor({
    admin: createSupabaseAdminClient(),
    targetUserId: user.id,
    postingId,
    mode,
    template,
    isByo,
    monthToDateSpend,
    budgetCap,
    dailyLimit: DAILY_LIMIT,
    githubRepo: process.env.GITHUB_REPO,
    githubToken: process.env.GITHUB_DISPATCH_TOKEN,
    fetchImpl: fetch,
    now: () => new Date(),
  });

  switch (result.kind) {
    case "not_configured":
      // Log, never throw — a missing env var is an ops problem, not a
      // 500. Only the fact that config is missing is logged, never a
      // secret value (there's nothing to log here anyway).
      console.error("POST /api/tailor/run: GITHUB_REPO or GITHUB_DISPATCH_TOKEN is not set");
      return NextResponse.json({ error: "tailor dispatch is not configured" }, { status: 503 });
    case "budget_exceeded":
      return NextResponse.json({ error: "budget_exceeded" }, { status: 429 });
    case "daily_limit":
      return NextResponse.json({ error: "daily_limit", count: result.count }, { status: 429 });
    case "cooldown":
      return NextResponse.json({ error: "cooldown" }, { status: 429 });
    case "dispatch_failed":
      console.error("POST /api/tailor/run: GitHub dispatch failed with status", result.status);
      return NextResponse.json({ error: "dispatch failed" }, { status: 502 });
    case "ok":
      return NextResponse.json({ ok: true, run_id: result.runId });
  }
}
