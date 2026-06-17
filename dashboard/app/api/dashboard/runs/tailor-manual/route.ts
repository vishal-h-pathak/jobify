import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { dispatchWorkflow } from "@/app/lib/github-dispatch";

/**
 * POST /api/dashboard/runs/tailor-manual  (PR-tailor-manual-url)
 *
 * Paste-a-URL entry point: the user drops a posting URL into the manual
 * tailor panel; this route validates it, inserts a public.runs row
 * (kind='tailor_manual', args={url}), and dispatches the new
 * .github/workflows/tailor-manual.yml in the pipeline repo with
 * the row id as `run_id` and the URL as `url`. The GHA job runs
 * `jobpipe-tailor-one <url> --run-id <run_id>` which:
 *
 *   - scrapes per-ATS (Greenhouse / Lever / Ashby) or via the
 *     generic Playwright fallback,
 *   - upserts the jobs row (status='approved' on high confidence,
 *     'discovered' on low — Amendment 1, 2026-05-22),
 *   - on high confidence calls process_one_approved_job inline,
 *   - on low confidence skips the tailor and routes the user to
 *     /dashboard/review/{job_id} so the existing review surface
 *     verifies title + company before the per-row Tailor button
 *     picks the row up,
 *   - writes runs.result with { job_id, status, confidence,
 *     review_url|materials_url, ... } so the form here can poll
 *     and surface the outcome.
 *
 * Sibling of runs/tailor/route.ts — NOT an overload. The existing
 * tailor route's "job_id must already exist with status='approved'"
 * invariant is load-bearing for the per-card Tailor button; the
 * manual flow has only a URL until the GHA scrapes one.
 *
 * Body: { url: string }
 *   url must parse as a URL with http/https scheme. 400 otherwise.
 *
 * Schema notes (verified against the configured Supabase project on
 * 2026-06-06):
 *   - runs.kind CHECK admits 'tailor_manual' as of migration 009
 *     (jobpipe/tailor/scripts/009_runs_tailor_manual.sql).
 *   - runs.result jsonb is the polling target for the form.
 *
 * Auth: protected by proxy.ts (dashboard_auth cookie).
 */

const MAX_URL_LENGTH = 2048;

function isValidPostingUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server misconfigured (missing Supabase env vars)" },
      { status: 500 },
    );
  }

  // ── Parse + validate body ─────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const url = (body as { url?: unknown })?.url;
  if (!isValidPostingUrl(url)) {
    return NextResponse.json(
      {
        error:
          "Invalid url: expected an http(s) URL string under " +
          `${MAX_URL_LENGTH} chars.`,
      },
      { status: 400 },
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Insert runs row ───────────────────────────────────────────────
  const { data: inserted, error: insertErr } = await admin
    .from("runs")
    .insert({
      kind: "tailor_manual",
      status: "pending",
      triggered_by: "dashboard",
      args: { url },
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to insert runs row" },
      { status: 500 },
    );
  }

  const runId = inserted.id as string;

  // ── Dispatch tailor-manual.yml ────────────────────────────────────
  const dispatch = await dispatchWorkflow("tailor-manual.yml", {
    run_id: runId,
    url,
  });

  if (!dispatch.ok) {
    await admin
      .from("runs")
      .update({
        status: "failed",
        ended_at: new Date().toISOString(),
        failure_reason: dispatch.errorMessage,
      })
      .eq("id", runId);
    return NextResponse.json(
      { error: dispatch.errorMessage, run_id: runId },
      { status: dispatch.status === 500 ? 500 : 502 },
    );
  }

  return NextResponse.json({ ok: true, run_id: runId });
}
