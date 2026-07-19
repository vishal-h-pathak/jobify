import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type ReadyPosting = {
  posting_id: string;
  title: string;
  company: string;
  application_url: string;
};

/**
 * Rows this query resolves to. `Database`'s hand-written `Relationships`
 * arrays are all empty (see lib/supabase/types.ts's header comment), so
 * postgrest-js can't infer the embedded `postings(...)` resource's
 * cardinality from the generic `SupabaseClient<Database>` typing — it comes
 * back as `unknown` rather than a typed object/array. Typed by hand here to
 * cover both shapes a Supabase embedded-resource select can take
 * (one-to-many joins come back as an array, one-to-one/FK joins as a single
 * object) and narrowed with `Array.isArray` below.
 */
type ReadyRow = {
  posting_id: string;
  created_at: string;
  postings:
    | { id: string; title: string | null; company: string | null; application_url: string | null }
    | { id: string; title: string | null; company: string | null; application_url: string | null }[]
    | null;
};

export async function buildReadyList(admin: SupabaseClient<Database>, userId: string): Promise<ReadyPosting[]> {
  const { data, error } = await admin
    .from("tailor_runs")
    .select("posting_id, created_at, postings(id, title, company, application_url)")
    .eq("user_id", userId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .returns<ReadyRow[]>();
  if (error) throw error;

  const seen = new Set<string>();
  const result: ReadyPosting[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.posting_id)) continue; // dedupe: keep only the newest succeeded run per posting (rows already newest-first)
    seen.add(row.posting_id);
    const posting = Array.isArray(row.postings) ? row.postings[0] : row.postings;
    if (!posting) continue; // FK guarantees the row exists; skip defensively rather than throw on a shape surprise
    result.push({
      posting_id: row.posting_id,
      title: posting.title ?? "",
      company: posting.company ?? "",
      application_url: posting.application_url ?? "",
    });
  }
  return result;
}
