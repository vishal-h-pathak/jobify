/**
 * Imports jobify/data/board_catalog_seed.yml into the `board_catalog`
 * table (idempotent upsert on `(ats, slug)`). Service-role, run manually
 * after migration 0015 is applied live:
 *
 *   npx tsx scripts/importBoardCatalog.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { createSupabaseAdminClient } from "../lib/supabase/admin";

interface SeedBoard {
  ats: "greenhouse" | "ashby" | "lever" | "workday";
  slug: string;
  company_name: string;
  tags: string[];
}

export function loadSeed(seedPath: string): SeedBoard[] {
  const raw = fs.readFileSync(seedPath, "utf8");
  const parsed = yaml.load(raw) as { boards?: SeedBoard[] } | undefined;
  if (!parsed?.boards?.length) throw new Error(`no boards found in ${seedPath}`);
  return parsed.boards;
}

async function main() {
  const seedPath = path.resolve(__dirname, "../../jobify/data/board_catalog_seed.yml");
  const boards = loadSeed(seedPath);
  const admin = createSupabaseAdminClient();

  const { error } = await admin.from("board_catalog").upsert(
    boards.map((b) => ({
      ats: b.ats,
      slug: b.slug,
      company_name: b.company_name,
      tags: b.tags,
      status: "active",
      added_by: "import",
    })),
    { onConflict: "ats,slug" }
  );
  if (error) throw error;

  console.log(`imported ${boards.length} boards into board_catalog`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
