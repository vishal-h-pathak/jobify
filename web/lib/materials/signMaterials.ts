import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/types";

/**
 * Same bucket as `jobify/shared/storage.py::BUCKET` (:33) — this repo has
 * no cross-referenced Python/TS constants convention yet (checked: no
 * `"job-materials"` literal anywhere under `web/lib/` before this file), so
 * this hardcodes the matching literal rather than inventing a shared-const
 * mechanism for a single call site.
 */
const BUCKET = "job-materials";

/**
 * The full artifact set a tailor run can produce, per `V3B_DESIGN.md`
 * §1.4's storage layout at `job-materials/{user_id}/{posting_id}/`. Not
 * every run leaves every file behind (e.g. a `mode: "render"` run has no
 * cover letter) — `signMaterials` only signs whatever `.list()` actually
 * finds among this set, per the session prompt's "no signed URL for
 * anything the run didn't produce."
 */
const KNOWN_ARTIFACTS = [
  "resume.pdf",
  "cover_letter.pdf",
  "cover_letter.txt",
  "tailored.json",
  "claims.json",
  "render_meta.json",
] as const;

/**
 * Lists the objects actually present at `job-materials/{userId}/{postingId}/`
 * and returns short-lived signed URLs for each, keyed by filename. Only
 * `KNOWN_ARTIFACTS` that `.list()` reports as present get signed — an
 * empty `.list()` result (or one containing only unrecognized filenames)
 * returns `{}` without ever calling `createSignedUrls`.
 *
 * `createSignedUrls` is called once, batched over every present filename,
 * rather than once per file — a single round trip regardless of how many
 * of the (up to 6) artifacts exist.
 */
export async function signMaterials(
  admin: SupabaseClient<Database>,
  userId: string,
  postingId: string,
  expiresInSeconds: number
): Promise<Record<string, string>> {
  const prefix = `${userId}/${postingId}`;
  const storage = admin.storage.from(BUCKET);

  const { data: listing, error: listError } = await storage.list(prefix);
  if (listError) throw listError;

  const present = new Set((listing ?? []).map((entry) => entry.name));
  const filenames = KNOWN_ARTIFACTS.filter((name) => present.has(name));
  if (filenames.length === 0) {
    return {};
  }

  const { data: signed, error: signError } = await storage.createSignedUrls(
    filenames.map((name) => `${prefix}/${name}`),
    expiresInSeconds
  );
  if (signError) throw signError;

  const urls: Record<string, string> = {};
  for (const entry of signed ?? []) {
    if (!entry.path || !entry.signedUrl) continue;
    const filename = entry.path.slice(prefix.length + 1);
    urls[filename] = entry.signedUrl;
  }
  return urls;
}
