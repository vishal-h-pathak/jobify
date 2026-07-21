/**
 * Hand-written subset of the Supabase schema this app touches. No live
 * project exists yet (infra decision deferred — see web/README.md), so
 * these aren't `supabase gen types` output; keep them in sync by hand with
 * jobify/migrations/0002_multitenant.sql + 0003_hosted_onboarding.sql.
 *
 * Shape (Row/Insert/Update/Relationships per table, plus the sibling
 * Views/Functions/Enums/CompositeTypes keys) matches what
 * `@supabase/supabase-js`'s `SupabaseClient<Database>` generic expects —
 * omitting any of these makes its type inference silently collapse to
 * `never` on every table method.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          doc: Record<string, string>;
          compiled_rubric: Record<string, unknown> | null;
          validation_status: { status: string; errors: string[] } | null;
          last_hunt_requested_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          doc: Record<string, string>;
          validation_status?: { status: string; errors: string[] } | null;
        };
        Update: {
          doc?: Record<string, string>;
          validation_status?: { status: string; errors: string[] } | null;
          last_hunt_requested_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      invites: {
        Row: {
          code: string;
          created_by: string | null;
          claimed_by: string | null;
          claimed_at: string | null;
          created_at: string;
        };
        Insert: {
          code: string;
          created_by?: string | null;
        };
        Update: {
          claimed_by?: string | null;
          claimed_at?: string | null;
        };
        Relationships: [];
      };
      onboarding_sessions: {
        // ONB-A (2026-07-05): v2 stage machine — anchor -> calibration ->
        // resume (optional) -> targeting -> done (0010_onboarding_stage_v2.sql).
        // The legacy "identity" literal (UX1-B audit, 2026-07-19) was
        // removed from this union: the live DB CHECK constraint never
        // allowed it (migration 0010 remapped every historical row to
        // 'targeting'), so it was dead weight kept only for the pre-B
        // onboarding UI's old literal usages — deleted alongside it.
        // V3A-1 contract (session-prompts/31_v3a_modules.md, pinned block):
        // `modules` anticipates session 30's migration 0011 —
        // { [key: ModuleKey]: { completed_at: string, receipt: string } },
        // widened with a `{ fired_at: string }` variant to match 30's real
        // `moduleRegistry.ts::ModulesState` (`checkpoint_hunt`'s own
        // idempotency marker, not a module completion) after reading it
        // directly from the sibling feat/v3a-spine worktree mid-build.
        // Typed here (additive, optional) so this session's own code
        // typechecks without depending on 30's migration landing first.
        Row: {
          user_id: string;
          stage: "anchor" | "calibration" | "resume" | "targeting" | "done";
          messages: Array<{ role: "user" | "assistant"; content: string }>;
          extracted: Record<string, unknown>;
          // V3A-1 (0011): per-module completion progress, keyed by
          // `moduleRegistry.ts::ModuleKey` plus the checkpoint's own
          // `checkpoint_hunt` marker — see `web/lib/onboarding/moduleRegistry.ts`
          // (`ModulesState`) for the authoritative shape.
          modules: Record<string, { completed_at: string; receipt: string } | { fired_at: string }>;
          status: "in_progress" | "complete";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          stage?: "anchor" | "calibration" | "resume" | "targeting" | "done";
          messages?: Array<{ role: "user" | "assistant"; content: string }>;
          extracted?: Record<string, unknown>;
          modules?: Record<string, { completed_at: string; receipt: string } | { fired_at: string }>;
          status?: "in_progress" | "complete";
        };
        Update: {
          stage?: "anchor" | "calibration" | "resume" | "targeting" | "done";
          messages?: Array<{ role: "user" | "assistant"; content: string }>;
          extracted?: Record<string, unknown>;
          modules?: Record<string, { completed_at: string; receipt: string } | { fired_at: string }>;
          status?: "in_progress" | "complete";
          updated_at?: string;
        };
        Relationships: [];
      };
      budget_ledger: {
        Row: {
          id: number;
          user_id: string;
          event: string;
          model: string | null;
          input_tokens: number;
          output_tokens: number;
          cost_usd: number;
          run_id: string | null;
          byo: boolean;
          created_at: string;
        };
        Insert: {
          user_id: string;
          event: string;
          model?: string | null;
          input_tokens?: number;
          output_tokens?: number;
          cost_usd?: number;
          run_id?: string | null;
          byo?: boolean;
        };
        Update: {
          [key: string]: never;
        };
        Relationships: [];
      };
      // H6 (0006_cost_rails.sql): per-user monthly spend cap, service-role-
      // managed. `authenticated` gets SELECT only — a user can see but not
      // raise their own cap (see 0002_multitenant.sql's header).
      budget_caps: {
        Row: {
          user_id: string;
          monthly_usd_cap: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          monthly_usd_cap?: number;
        };
        Update: {
          [key: string]: never;
        };
        Relationships: [];
      };
      // H6: optional BYO Anthropic key. `encrypted_key` is ciphertext only
      // (see web/lib/crypto/keys.ts) — the settings UI only ever reads
      // `key_last4` back, never `encrypted_key`.
      api_keys: {
        Row: {
          user_id: string;
          provider: string;
          encrypted_key: string;
          key_last4: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          provider?: string;
          encrypted_key: string;
          key_last4?: string | null;
        };
        Update: {
          provider?: string;
          encrypted_key?: string;
          key_last4?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      // H7 (0002_multitenant.sql): global job postings pool, no user_id.
      // Written only by the Python worker (service-role) via upsert — the
      // web app only ever reads this table, so Insert/Update stay minimal.
      postings: {
        Row: {
          id: string;
          title: string | null;
          company: string | null;
          location: string | null;
          remote: boolean | null;
          description: string | null;
          application_url: string | null;
          ats_kind: string | null;
          link_status: string | null;
          source: string | null;
          posted_at: string | null;
          first_seen_at: string;
          last_seen_at: string;
          embedding: number[] | null;
          raw: Record<string, unknown> | null;
        };
        Insert: {
          [key: string]: never;
        };
        Update: {
          [key: string]: never;
        };
        Relationships: [];
      };
      // H7 (0002_multitenant.sql): user_id x posting_id, ladder scores +
      // aggregator state. `state` mirrors jobify/shared/match_state.json's
      // CANONICAL_MATCH_STATES — keep this union in lockstep with that file.
      matches: {
        Row: {
          user_id: string;
          posting_id: string;
          rubric_score: number | null;
          embed_score: number | null;
          llm_score: number | null;
          reason: string | null;
          reason_source: "llm" | "rubric" | null;
          state: "new" | "seen" | "saved" | "dismissed" | "applied";
          state_changed_at: string;
          created_at: string;
          // P0.5/P0.7 (0014_hunt2_funnel.sql, HUNT2 session 47): funnel
          // status (distinct from `state` above, the user's own triage) +
          // the location-fit ranking dimension.
          status: "rejected_title" | "rejected_rubric" | "rejected_rerank" | "rejected_llm" | "surfaced";
          reject_reason: string | null;
          location_tier: 1 | 2 | 3 | null;
        };
        Insert: {
          user_id: string;
          posting_id: string;
          rubric_score?: number | null;
          embed_score?: number | null;
          llm_score?: number | null;
          reason?: string | null;
          reason_source?: "llm" | "rubric" | null;
          state?: "new" | "seen" | "saved" | "dismissed" | "applied";
          status?: "rejected_title" | "rejected_rubric" | "rejected_rerank" | "rejected_llm" | "surfaced";
          reject_reason?: string | null;
          location_tier?: 1 | 2 | 3 | null;
        };
        Update: {
          state?: "new" | "seen" | "saved" | "dismissed" | "applied";
          state_changed_at?: string;
          status?: "rejected_title" | "rejected_rubric" | "rejected_rerank" | "rejected_llm" | "surfaced";
          reject_reason?: string | null;
          location_tier?: 1 | 2 | 3 | null;
        };
        Relationships: [];
      };
      // ADM-2 (0008_hunt_cycles.sql): one row per fanout/discovery
      // invocation, written by the Python worker (service-role) —
      // read-only from the web side, so Insert/Update stay minimal like
      // `postings`'s entry above.
      hunt_cycles: {
        Row: {
          id: number;
          started_at: string;
          finished_at: string | null;
          mode: "full" | "discovery_only" | "single_user";
          triggered_by: "cron" | "dispatch" | "manual" | null;
          users_scored: number;
          postings_fetched: number;
          postings_upserted: number;
          counters: Record<string, number> | null;
          cost_usd: number;
          error: string | null;
        };
        Insert: {
          [key: string]: never;
        };
        Update: {
          [key: string]: never;
        };
        Relationships: [];
      };
      allowed_emails: {
        Row: {
          email: string;
          note: string | null;
          created_at: string;
          consumed_by: string | null;
          consumed_at: string | null;
        };
        Insert: {
          email: string;
          note?: string | null;
        };
        Update: {
          consumed_by?: string | null;
          consumed_at?: string | null;
        };
        Relationships: [];
      };
      // V3A-1 (0011_v3a_modules.sql): reaction calibration — swiping real
      // postings interested/not during onboarding. Own-row select/insert/
      // update RLS (users may change their mind); no delete, so the
      // calibration signal's audit trail stays intact.
      posting_reactions: {
        Row: {
          user_id: string;
          posting_id: string;
          reaction: "interested" | "not_interested";
          note: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          posting_id: string;
          reaction: "interested" | "not_interested";
          note?: string | null;
        };
        Update: {
          reaction?: "interested" | "not_interested";
          note?: string | null;
        };
        Relationships: [];
      };
      // V3B-S2 (0012_v3b_tailor.sql): one row per GHA tailor-worker
      // invocation, keyed by `id` (the `run_id` the workflow_dispatch input
      // carries) — the worker updates this exact row rather than the
      // hunt_cycles pattern of inferring outcome after the fact. RLS: own-row
      // SELECT only (polling); INSERT/UPDATE are service-role only — the web
      // route inserts with the admin client before dispatch, and the worker
      // updates via service role too.
      tailor_runs: {
        Row: {
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
        };
        // Service-role only per the SQL's RLS comment — the web route
        // inserts with the admin client before dispatch; status/progress/etc.
        // all have DB defaults, id/created_at/updated_at are server-generated.
        Insert: {
          user_id: string;
          posting_id: string;
          mode?: "tailor" | "render";
          template?: string | null;
        };
        // Web side (stale-reap + dispatch-failure paths) only ever writes
        // status/error/updated_at; the worker's broader update surface
        // (progress/dropped_count/cost_usd/...) is Python's concern, still
        // typed here since Database is shared.
        Update: {
          status?: "queued" | "running" | "succeeded" | "failed";
          mode?: "tailor" | "render";
          template?: string | null;
          feedback?: string | null;
          progress?: Array<{ step: string; label: string; at: string }>;
          doc_sha256?: string | null;
          dropped_count?: number | null;
          error?: string | null;
          cost_usd?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      // V3c P0 (0013_v3c_submit.sql): one row per user — the submitter's
      // contact/EEO/work-auth answers etc., stored as `encrypted_payload`
      // ciphertext in the keycrypt `v1:...` wire format. Service-role only
      // per the SQL's RLS comment (no `authenticated` policy at all) — the
      // web route authenticates the user, then reads/writes via the
      // service-role admin client, encrypting/decrypting server-side.
      application_profiles: {
        Row: {
          user_id: string;
          encrypted_payload: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          encrypted_payload: string;
          updated_at?: string;
        };
        Update: {
          encrypted_payload?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // V3c P0 (0013_v3c_submit.sql): per-attempt kit/extension submit
      // telemetry. `field_outcomes` is labels/layer/outcome only — NEVER
      // the filled field value. RLS: own-row SELECT; INSERT/UPDATE/DELETE
      // are service-role only. Nothing in this plan writes this table yet
      // — Row is typed here for schema completeness, Insert/Update are
      // left as `never` shapes until a later phase writes to it.
      submit_events: {
        Row: {
          id: string;
          user_id: string;
          posting_id: string;
          source: "kit" | "extension";
          final_state: string | null;
          pages: number | null;
          field_outcomes: Array<{ label: string; layer: string; outcome: string }>;
          walls: Record<string, unknown> | null;
          advance_agreement: Record<string, unknown> | null;
          cost_usd: number | null;
          created_at: string;
        };
        Insert: { [key: string]: never };
        Update: { [key: string]: never };
        Relationships: [];
      };
      // V3c P0 (0013_v3c_submit.sql): shared, structure-only field-mapping
      // cache keyed by `(hostname, field_signature)`. `mapping` is
      // structure only (selectors/labels) — NEVER values. Service-role
      // only (no `authenticated` policy) — served via a read API in E3.
      // Nothing in this plan reads or writes this table yet — Row is typed
      // here for schema completeness, Insert/Update are left as `never`
      // shapes until a later phase writes to it.
      learned_field_maps: {
        Row: {
          id: string;
          hostname: string;
          ats_kind: string | null;
          field_signature: string;
          mapping: Record<string, unknown>;
          verified_count: number;
          last_verified_at: string | null;
        };
        Insert: { [key: string]: never };
        Update: { [key: string]: never };
        Relationships: [];
      };
      // HUNT2 P1 S2 (0015_board_catalog.sql): global curated ATS-board
      // catalog, no user_id — seeded from jobify/data/board_catalog_seed.yml
      // by web/scripts/importBoardCatalog.ts. RLS: authenticated SELECT
      // (tier-pack computation reads this client-reachable), service-role
      // ALL (only the import script and, later, S4's candidate-queue
      // admission flow write here).
      board_catalog: {
        Row: {
          id: string;
          ats: "greenhouse" | "ashby" | "lever" | "workday";
          slug: string;
          company_name: string;
          tags: string[];
          status: string;
          added_by: string;
          verified_at: string | null;
        };
        Insert: {
          id?: string;
          ats: "greenhouse" | "ashby" | "lever" | "workday";
          slug: string;
          company_name: string;
          tags?: string[];
          status?: string;
          added_by?: string;
          verified_at?: string | null;
        };
        Update: {
          tags?: string[];
          status?: string;
          verified_at?: string | null;
        };
        Relationships: [];
      };
      // HUNT2 P2 S4 (0017_candidate_boards.sql): the global candidate-board
      // discovery-loop queue — three feeders enqueue, jobify.hosted.candidates
      // probes + maybe auto-admits into board_catalog, the admin candidates
      // UI (web/app/(app)/admin/CandidatesCard.tsx) approves/rejects whatever
      // stays pending. RLS: service-role ALL only — no `authenticated`
      // policy, unlike board_catalog; every read/write here goes through
      // requireAdmin()-gated server routes.
      candidate_boards: {
        Row: {
          id: string;
          company_name: string;
          normalized_name: string;
          evidence_kind: "hn_thread" | "aggregator_match" | "serpapi_dork" | "relocation" | "manual";
          evidence_url: string | null;
          proposed_ats: string | null;
          proposed_slug: string | null;
          probe_result: Record<string, unknown> | null;
          status: "pending" | "auto_admitted" | "approved" | "rejected";
          reject_reason: string | null;
          created_at: string;
          decided_at: string | null;
        };
        Insert: {
          id?: string;
          company_name: string;
          normalized_name: string;
          evidence_kind: "hn_thread" | "aggregator_match" | "serpapi_dork" | "relocation" | "manual";
          evidence_url?: string | null;
          proposed_ats?: string | null;
          proposed_slug?: string | null;
          probe_result?: Record<string, unknown> | null;
          status?: "pending" | "auto_admitted" | "approved" | "rejected";
          reject_reason?: string | null;
          decided_at?: string | null;
        };
        Update: {
          status?: "pending" | "auto_admitted" | "approved" | "rejected";
          reject_reason?: string | null;
          decided_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // migration 0005 — SECURITY DEFINER invite claim (see lib/db/invites.ts)
      claim_invite: {
        Args: { invite_code: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
