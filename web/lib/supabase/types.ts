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
        };
        Update: {
          [key: string]: never;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
