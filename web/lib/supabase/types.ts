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
        Row: {
          user_id: string;
          stage: "resume" | "identity" | "targeting" | "done";
          messages: Array<{ role: "user" | "assistant"; content: string }>;
          extracted: Record<string, unknown>;
          status: "in_progress" | "complete";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          stage?: "resume" | "identity" | "targeting" | "done";
          messages?: Array<{ role: "user" | "assistant"; content: string }>;
          extracted?: Record<string, unknown>;
          status?: "in_progress" | "complete";
        };
        Update: {
          stage?: "resume" | "identity" | "targeting" | "done";
          messages?: Array<{ role: "user" | "assistant"; content: string }>;
          extracted?: Record<string, unknown>;
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
        };
        Update: {
          state?: "new" | "seen" | "saved" | "dismissed" | "applied";
          state_changed_at?: string;
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
