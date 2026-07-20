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

interface StoredLocationComp {
  base?: string;
  remote_acceptable?: boolean;
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
 * FALLBACK ONLY (see below). Cockpit hotfix 2026-07-20: this regex
 * misfired on live data — "Prefers remote; onsite only acceptable if
 * based in Atlanta" matched /onsite only/ and concluded remote-REQUIRED,
 * the opposite of the stated preference, emptying the tier pack (the
 * data-ai ∩ remote-first intersection is empty). profile.yml's
 * location_and_compensation is authoritative when present; this text
 * heuristic remains only for profiles that predate that section.
 */
function deriveRemoteRequired(hardDisqualifiers: string[], softConcerns: string[]): boolean {
  const text = [...hardDisqualifiers, ...softConcerns].join(" ").toLowerCase();
  return /no remote|fully in-office|onsite only|in-person only/.test(text);
}

function parseLocationComp(profileYamlText: string): StoredLocationComp | null {
  if (!profileYamlText.trim()) return null;
  try {
    const parsed = yaml.load(profileYamlText) as Record<string, unknown> | null;
    const section = parsed?.["location_and_compensation"];
    return section && typeof section === "object" ? (section as StoredLocationComp) : null;
  } catch {
    return null;
  }
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

  // Cockpit hotfix 2026-07-20: prefer profile.yml's authoritative
  // location_and_compensation over the text-regex heuristic. Semantics:
  // "remote required" (pack restricted to remote-first boards) is true
  // only when the user accepts remote AND has no base metro to take
  // onsite work in. A user with a base (e.g. "Atlanta, GA") can take
  // onsite there — restricting their pack to remote-first boards is
  // wrong. Regex fallback only when profile.yml lacks the section.
  const locComp = parseLocationComp(profileRow.doc["profile.yml"] ?? "");
  const remoteRequired = locComp
    ? locComp.remote_acceptable === true && !locComp.base
    : deriveRemoteRequired(storedTargeting.hard_disqualifiers ?? [], storedTargeting.soft_concerns ?? []);
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
  console.log(
    `  dream companies: ${dreamCompanies.length}, tier pack candidates: ${tierPackBoards.length}, remoteRequired: ${remoteRequired} (${locComp ? "profile.yml" : "regex fallback"})`
  );
  if (couldntAutoFind.length) {
    console.log(`  couldn't auto-find (${couldntAutoFind.length}): ${couldntAutoFind.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
