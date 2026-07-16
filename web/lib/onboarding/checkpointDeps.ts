import { createSupabaseAdminClient } from "../supabase/admin";
import { dispatchHunt } from "../hunt/dispatchHunt";

const DEFAULT_COOLDOWN_HOURS = 6;

/**
 * V3A-1 contract: `maybeFireCheckpoint`'s `CheckpointDeps` (session 30,
 * `checkpoint.ts`) injects `dispatchHunt` + its config rather than importing
 * it directly, so this builds the same dependency bundle
 * `POST /api/hunt/run` constructs inline — kept in one place since every
 * structured-module route calls the checkpoint after a completion.
 */
export function buildCheckpointDeps() {
  return {
    admin: createSupabaseAdminClient(),
    dispatchHunt,
    cooldownHours: Number(process.env.HUNT_COOLDOWN_HOURS ?? DEFAULT_COOLDOWN_HOURS),
    githubRepo: process.env.GITHUB_REPO,
    githubToken: process.env.GITHUB_DISPATCH_TOKEN,
    fetchImpl: fetch,
    now: () => new Date(),
  };
}
