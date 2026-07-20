/**
 * Admin reseed: applies the new dream-company slug-probe + tier-pack
 * seeding to an EXISTING user's portals.yml, without redoing onboarding
 * (planning/HUNT2_SOURCES.md §3.2). Service-role, run manually:
 *
 *   npx tsx scripts/reseedPortals.ts --user <uuid>
 *
 * Reads the user's `onboarding_sessions.extracted` (the only durable copy
 * of dream_companies/tiers/disqualifiers today — `profile.yml` never
 * persists dream_companies), probes dream companies, computes a tier pack
 * from `board_catalog`, and merge-not-replaces the result into the user's
 * current `profiles.doc["portals.yml"]`.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import yaml from "js-yaml";
import { createSupabaseAdminClient } from "../lib/supabase/admin";
import { seedPortalsCompanies, type TargetingForPortals } from "../lib/profile/portalsSeed";
import { computeTierPack, type CatalogBoardInput } from "../lib/portals/tierPacks";

interface StoredTargeting {
  tiers?: Array<{ label: string; notes?: string; reference_role?: string }>;
  hard_disqualifiers?: string[];
  soft_concerns?: string[];
  dream_companies?: string[];
}

interface StoredExtracted {
  anchor?: { current_title?: string };
  targeting?: StoredTargeting;
}

function parseArgs(argv: string[]): { userId: string } {
  const idx = argv.indexOf("--user");
  const userId = idx === -1 ? undefined : argv[idx + 1];
  if (!userId) {
    throw new Error("usage: reseedPortals.ts --user <uuid>");
  }
  return { userId };
}

/**
 * No explicit "remote acceptable" field exists on targeting yet (that's
 * P0.7's profile-level concern, a different session) — this is a judgment
 * call, scoped to this script only: infer remote-required from
 * disqualifier/concern text mentioning onsite-only constraints.
 */
function deriveRemoteRequired(hardDisqualifiers: string[], softConcerns: string[]): boolean {
  const text = [...hardDisqualifiers, ...softConcerns].join(" ").toLowerCase();
  return /no remote|fully in-office|onsite only|in-person only/.test(text);
}

async function main() {
  const { userId } = parseArgs(process.argv.slice(2));
  const admin = createSupabaseAdminClient();

  const { data: session, error: sessionError } = await admin
    .from("onboarding_sessions")
    .select("extracted")
    .eq("user_id", userId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) throw new Error(`no onboarding_sessions row for user ${userId}`);

  const extracted = (session.extracted ?? {}) as StoredExtracted;
  const storedTargeting = extracted.targeting ?? {};
  const dreamCompanies = storedTargeting.dream_companies ?? [];

  const targeting: TargetingForPortals = {
    tiers: storedTargeting.tiers ?? [],
    hard_disqualifiers: storedTargeting.hard_disqualifiers,
    dream_companies: dreamCompanies,
  };

  const { data: profileRow, error: profileError } = await admin
    .from("profiles")
    .select("doc")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profileRow) throw new Error(`no profiles row for user ${userId} — run onboarding first`);

  const existingPortalsText = profileRow.doc["portals.yml"] ?? "";
  const existingDoc = existingPortalsText.trim()
    ? (yaml.load(existingPortalsText) as Record<string, unknown>)
    : null;

  const { data: catalogRows, error: catalogError } = await admin
    .from("board_catalog")
    .select("ats, slug, company_name, tags")
    .eq("status", "active");
  if (catalogError) throw catalogError;

  // The slug probe (and this seeding pipeline) only covers Greenhouse/
  // Ashby/Lever this session (Workday fetcher wiring is S3, out of
  // scope) — a catalog row can carry ats='workday' per the DB constraint,
  // but the seed data imported this session never does, and tier packs
  // can't usefully target a platform nothing probes yet.
  const catalog: CatalogBoardInput[] = (catalogRows ?? []).filter(
    (row): row is CatalogBoardInput => row.ats !== "workday"
  );
  const remoteRequired = deriveRemoteRequired(
    storedTargeting.hard_disqualifiers ?? [],
    storedTargeting.soft_concerns ?? []
  );
  const tierPackBoards = computeTierPack({ tiers: targeting.tiers, remoteRequired }, catalog);

  const { portalsYaml, couldntAutoFind } = await seedPortalsCompanies({
    targeting,
    anchorTitle: extracted.anchor?.current_title,
    dreamCompanies,
    tierPackBoards,
    existingDoc,
  });

  const updatedDoc = {
    ...profileRow.doc,
    "portals.yml": portalsYaml,
    "portals.couldnt_auto_find.json": JSON.stringify(couldntAutoFind),
  };

  const { error: updateError } = await admin.from("profiles").update({ doc: updatedDoc }).eq("user_id", userId);
  if (updateError) throw updateError;

  console.log(`reseeded portals.yml for ${userId}`);
  console.log(`  dream companies: ${dreamCompanies.length}, tier pack candidates: ${tierPackBoards.length}`);
  if (couldntAutoFind.length) {
    console.log(`  couldn't auto-find (${couldntAutoFind.length}): ${couldntAutoFind.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
