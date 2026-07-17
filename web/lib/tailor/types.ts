/**
 * Shared `tailor_runs` shape for the dispatch/poll/materials code, so those
 * modules don't need to import the raw Supabase `Database` type (and its
 * Row/Insert/Update/Relationships wrapper) just to describe a run. Mirrors
 * `web/lib/supabase/types.ts`'s `Database["public"]["Tables"]["tailor_runs"]["Row"]`
 * exactly — keep the two in sync by hand.
 */
export interface TailorRun {
  id: string;
  user_id: string;
  posting_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  mode: "tailor" | "render";
  template: string | null;
  feedback: string | null;
  progress: Array<{ step: string; label: string; at: string }>;
  doc_sha256: string | null;
  dropped_count: number | null;
  error: string | null;
  cost_usd: number | null;
  created_at: string;
  updated_at: string;
}
