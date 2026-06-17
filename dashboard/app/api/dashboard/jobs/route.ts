import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, MISCONFIGURED_MSG } from "@/app/lib/supabase-admin";

/**
 * GET /api/dashboard/jobs?view=list|review-queue&q=search
 *
 * Server-side jobs reads for the dashboard (RLS lockdown). The browser
 * used to query Supabase directly with the anon key; jobs now has RLS
 * enabled with no anon policies, so all reads go through here on the
 * service role, gated by the dashboard_auth middleware.
 *
 * Views:
 *   - list (default): the /dashboard browse+swipe list. Narrow column
 *     set — jobs rows carry large jsonb (form_answers, submission_log,
 *     match_chat) and a full description that the list never renders,
 *     so they are deliberately excluded from the payload. Includes the
 *     scalar fields the review surface needs since it's opened from
 *     list rows.
 *   - review-queue: /dashboard/review. Full rows — the queue renders
 *     submission_log packet details, and this surface is the documented
 *     "keep the full fetch" exception.
 *
 * `q` (list view only): server-side free-text search over title+company
 * (case-insensitive substring). The dashboard toolbar debounces input
 * before hitting this.
 *
 * `degree_gated` is feature-detected: the list query first includes the
 * column, and on Postgres 42703 (column does not exist) retries without
 * it. The response carries `degree_gated_supported` so the client knows
 * whether to render the gate pill + filter. Absent column == not gated.
 *
 * Auth: protected by proxy.ts (dashboard_auth cookie).
 */

// Columns the /dashboard list view (and the review surface it opens
// from list rows) actually reads. If you render a new job field on the
// list, add it here.
const LIST_COLUMNS = [
  "id",
  "title",
  "company",
  "location",
  "score",
  "tier",
  "reasoning",
  "url",
  "source",
  "status",
  "created_at",
  "status_updated_at",
  "ats_kind",
  "applied_at",
  "failure_reason",
  "confidence",
  "legitimacy",
  "legitimacy_reasoning",
  "archetype",
  "archetype_confidence",
  "application_url",
  "application_notes",
  "link_status",
  "resume_path",
  "cover_letter_path",
  "resume_pdf_path",
  "cover_letter_pdf_path",
].join(", ");

// PostgREST surfaces missing columns as Postgres 42703.
const UNDEFINED_COLUMN = "42703";

// `or=` filter values are comma/paren-delimited in PostgREST syntax, so
// strip those plus wildcards from user input before interpolating.
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: MISCONFIGURED_MSG }, { status: 500 });
  }

  const view = req.nextUrl.searchParams.get("view") ?? "list";

  if (view === "list") {
    const qRaw = req.nextUrl.searchParams.get("q") ?? "";
    const q = sanitizeSearch(qRaw);

    const buildQuery = (withDegreeGated: boolean) => {
      const columns = withDegreeGated
        ? `${LIST_COLUMNS}, degree_gated`
        : LIST_COLUMNS;
      let query = admin
        .from("jobs")
        .select(columns)
        .order("score", { ascending: false });
      if (q) {
        query = query.or(`title.ilike.%${q}%,company.ilike.%${q}%`);
      }
      return query;
    };

    let degreeGatedSupported = true;
    let { data, error } = await buildQuery(true);
    if (error && error.code === UNDEFINED_COLUMN) {
      degreeGatedSupported = false;
      ({ data, error } = await buildQuery(false));
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      jobs: data ?? [],
      degree_gated_supported: degreeGatedSupported,
    });
  }

  let query;
  switch (view) {
    case "review-queue":
      // Submit lane: rows the human still owns — tailored-and-waiting
      // (ready_for_review) plus staged-locally-and-waiting-to-submit
      // (awaiting_human_submit). Most-recently-updated first.
      query = admin
        .from("jobs")
        .select("*")
        .in("status", ["ready_for_review", "awaiting_human_submit"])
        .order("status_updated_at", { ascending: false });
      break;
    default:
      return NextResponse.json(
        { error: `Unknown view: ${view}` },
        { status: 400 },
      );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ jobs: data ?? [] });
}
