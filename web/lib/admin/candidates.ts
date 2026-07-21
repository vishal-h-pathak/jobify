import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type CandidateBoardsRow = Database["public"]["Tables"]["candidate_boards"]["Row"];

/**
 * HUNT2 P2 S4: admin candidates UI's read/write surface over
 * `candidate_boards` (0017). Every function here takes an already-admin
 * (`createSupabaseAdminClient()`) client — callers gate with
 * `requireAdmin()` first, same contract as every other `lib/admin/*`
 * module.
 */
export interface CandidateBoardView {
  id: string;
  companyName: string;
  evidenceKind: CandidateBoardsRow["evidence_kind"];
  evidenceUrl: string | null;
  proposedAts: string | null;
  proposedSlug: string | null;
  probeResult: Record<string, unknown> | null;
  status: CandidateBoardsRow["status"];
  rejectReason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

function toView(row: CandidateBoardsRow): CandidateBoardView {
  return {
    id: row.id,
    companyName: row.company_name,
    evidenceKind: row.evidence_kind,
    evidenceUrl: row.evidence_url,
    proposedAts: row.proposed_ats,
    proposedSlug: row.proposed_slug,
    probeResult: row.probe_result,
    status: row.status,
    rejectReason: row.reject_reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

/** Every `pending` candidate, most-recently-proposed first — the admin
 * review queue. */
export async function listPendingCandidates(admin: SupabaseClient<Database>): Promise<CandidateBoardView[]> {
  const { data, error } = await admin
    .from("candidate_boards")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toView);
}

/** Most recent `auto_admitted` candidates — read-only visibility into
 * what the discovery loop admitted without a human in the loop. */
export async function listRecentAutoAdmittedCandidates(
  admin: SupabaseClient<Database>,
  limit = 20
): Promise<CandidateBoardView[]> {
  const { data, error } = await admin
    .from("candidate_boards")
    .select("*")
    .eq("status", "auto_admitted")
    .order("decided_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toView);
}

export type ApproveResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "not_pending" }
  | { kind: "missing_board_info" };

/**
 * Approve a pending candidate: writes it into `board_catalog`
 * (`added_by: "admin"`, matching the discovery loop's own `"discovery"`
 * tag so the two admission paths stay distinguishable) and marks the
 * candidate `approved`. `tags` is intentionally `[]` here — the
 * discovery loop's own auto-tag derivation runs server-side (Python)
 * against the probe's live posting titles, which are NOT persisted to
 * `probe_result` (ephemeral by design, see
 * `jobify.hosted.candidates._compact_probe_result`); a human approver
 * has no titles to derive from either, so an empty tag set (which
 * `computeTierPack` already degrades gracefully for — untagged boards
 * still appear in the catalog-order fallback) is the honest default over
 * a fabricated guess.
 */
export async function approveCandidate(admin: SupabaseClient<Database>, candidateId: string): Promise<ApproveResult> {
  const { data: row, error: readError } = await admin
    .from("candidate_boards")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) return { kind: "not_found" };
  if (row.status !== "pending") return { kind: "not_pending" };
  if (!row.proposed_ats || !row.proposed_slug) return { kind: "missing_board_info" };

  const nowIso = new Date().toISOString();
  const { error: catalogError } = await admin.from("board_catalog").upsert(
    {
      ats: row.proposed_ats as "greenhouse" | "ashby" | "lever" | "workday",
      slug: row.proposed_slug,
      company_name: row.company_name,
      tags: [],
      status: "active",
      added_by: "admin",
      verified_at: nowIso,
    },
    { onConflict: "ats,slug" }
  );
  if (catalogError) throw catalogError;

  const { error: updateError } = await admin
    .from("candidate_boards")
    .update({ status: "approved", decided_at: nowIso })
    .eq("id", candidateId);
  if (updateError) throw updateError;
  return { kind: "ok" };
}

export type RejectResult = { kind: "ok" } | { kind: "not_found" } | { kind: "not_pending" };

/** Reject a pending candidate with a reason. Rejected candidates are
 * never re-proposed — `candidate_boards.normalized_name` is UNIQUE and
 * every enqueue path checks it (ANY status) before inserting, so this
 * row itself IS the permanent "don't ask again" record. */
export async function rejectCandidate(
  admin: SupabaseClient<Database>,
  candidateId: string,
  reason: string
): Promise<RejectResult> {
  const { data: row, error: readError } = await admin
    .from("candidate_boards")
    .select("status")
    .eq("id", candidateId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) return { kind: "not_found" };
  if (row.status !== "pending") return { kind: "not_pending" };

  const { error } = await admin
    .from("candidate_boards")
    .update({ status: "rejected", reject_reason: reason || null, decided_at: new Date().toISOString() })
    .eq("id", candidateId);
  if (error) throw error;
  return { kind: "ok" };
}
