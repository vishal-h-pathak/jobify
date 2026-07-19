import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/types";
import type { ChatMessage, InterviewStage } from "../lib/anthropic/interview";
import type { ModulesState } from "../lib/onboarding/moduleRegistry";

/**
 * A fully in-memory stand-in for the Supabase clients `handleOnboardingTurn`
 * and `maybeGenerateCalibrationPrompts` are injected with. It does NOT try
 * to be a general Supabase mock — it implements exactly the three call
 * shapes those two real functions (`saveSession`, `upsertProfileDoc`,
 * `recordOnboardingTurn`) make, nothing more, so the sim can run the real
 * db-layer code against real in-memory state instead of a hand-rolled
 * double that could silently drift from what those functions actually do.
 *
 * The "never touch a real database" guarantee (session-prompt 45, task 1)
 * comes from this file alone: nothing here performs I/O of any kind.
 */

export interface FakeSessionRow {
  user_id: string;
  stage: InterviewStage;
  messages: ChatMessage[];
  extracted: Record<string, unknown>;
  modules: ModulesState;
  status: "in_progress" | "complete";
  updated_at?: string;
}

export interface FakeProfileRow {
  user_id: string;
  doc: Record<string, string>;
  validation_status: { status: string; errors: string[] } | null;
}

export interface FakeLedgerRow {
  user_id: string;
  event: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface FakeSupabase {
  /** Cast to `SupabaseClient<Database>` — real db-layer functions call `.from(...)` on this. */
  client: SupabaseClient<Database>;
  seedSessionRow(row: FakeSessionRow): void;
  getSessionRow(userId: string): FakeSessionRow | undefined;
  getProfileRow(userId: string): FakeProfileRow | undefined;
  getLedgerRows(): FakeLedgerRow[];
  /** Number of `saveSession` (onboarding_sessions update) calls for `userId` — the "spot saved" counter. */
  sessionUpdateCount(userId: string): number;
}

export function createFakeSupabase(): FakeSupabase {
  const sessions = new Map<string, FakeSessionRow>();
  const profiles = new Map<string, FakeProfileRow>();
  const ledger: FakeLedgerRow[] = [];
  const updateCounts = new Map<string, number>();

  function from(table: string) {
    return {
      update(patch: Record<string, unknown>) {
        return {
          eq(column: string, value: unknown) {
            if (table === "onboarding_sessions" && column === "user_id") {
              const userId = String(value);
              const existing = sessions.get(userId);
              if (existing) {
                sessions.set(userId, { ...existing, ...patch } as FakeSessionRow);
                updateCounts.set(userId, (updateCounts.get(userId) ?? 0) + 1);
              }
            }
            return Promise.resolve({ error: null });
          },
        };
      },
      upsert(row: Record<string, unknown>) {
        if (table === "profiles") {
          const userId = String(row.user_id);
          profiles.set(userId, {
            user_id: userId,
            doc: row.doc as Record<string, string>,
            validation_status: (row.validation_status as FakeProfileRow["validation_status"]) ?? null,
          });
        }
        return Promise.resolve({ error: null });
      },
      insert(row: Record<string, unknown>) {
        if (table === "budget_ledger") {
          ledger.push({
            user_id: String(row.user_id),
            event: String(row.event),
            model: (row.model as string) ?? null,
            input_tokens: Number(row.input_tokens ?? 0),
            output_tokens: Number(row.output_tokens ?? 0),
            cost_usd: Number(row.cost_usd ?? 0),
          });
        }
        return Promise.resolve({ error: null });
      },
    };
  }

  return {
    // Only `.from(...)` is ever called by the real code paths the sim
    // exercises (saveSession / upsertProfileDoc / recordOnboardingTurn) —
    // the cast is intentional, not a full SupabaseClient implementation.
    client: { from } as unknown as SupabaseClient<Database>,
    seedSessionRow(row) {
      sessions.set(row.user_id, { ...row });
    },
    getSessionRow(userId) {
      return sessions.get(userId);
    },
    getProfileRow(userId) {
      return profiles.get(userId);
    },
    getLedgerRows() {
      return [...ledger];
    },
    sessionUpdateCount(userId) {
      return updateCounts.get(userId) ?? 0;
    },
  };
}
