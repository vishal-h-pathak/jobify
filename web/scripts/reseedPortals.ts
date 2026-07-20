/**
 * Admin reseed: applies the new dream-company slug-probe + tier-pack
 * seeding to an EXISTING user's portals.yml, without redoing onboarding
 * (planning/HUNT2_SOURCES.md §3.2). Service-role, run manually:
 *
 *   npx tsx scripts/reseedPortals.ts --user <uuid>
 *
 * Thin CLI wrapper (ADM-3 Part 0) — the actual logic lives in
 * `lib/profile/seedUserPortals.ts`, which also runs inline once
 * onboarding completes (see `lib/onboarding/handleTurn.ts`).
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createSupabaseAdminClient } from "../lib/supabase/admin";
import { seedUserPortals } from "../lib/profile/seedUserPortals";

function parseArgs(argv: string[]): { userId: string } {
  const idx = argv.indexOf("--user");
  const userId = idx === -1 ? undefined : argv[idx + 1];
  if (!userId) {
    throw new Error("usage: reseedPortals.ts --user <uuid>");
  }
  return { userId };
}

async function main() {
  const { userId } = parseArgs(process.argv.slice(2));
  const admin = createSupabaseAdminClient();

  const result = await seedUserPortals(admin, userId);

  console.log(`reseeded portals.yml for ${userId}`);
  console.log(
    `  dream companies: ${result.dreamCompaniesCount}, tier pack candidates: ${result.tierPackCount}, ` +
      `remoteRequired: ${result.remoteRequired} (${result.remoteRequiredSource})`
  );
  if (result.couldntAutoFind.length) {
    console.log(`  couldn't auto-find (${result.couldntAutoFind.length}): ${result.couldntAutoFind.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
