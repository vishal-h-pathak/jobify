import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getProfileDoc } from "@/lib/db/profiles";
import { signMaterials } from "@/lib/materials/signMaterials";
import { loadApplicationProfile } from "./applicationProfile";
import { detectAtsKind } from "./atsDetect";
import { buildIdentity } from "./identity";
import type { SubmitPacket } from "./types";

// Same bucket literal as `signMaterials.ts` — this repo has no shared-const
// convention for it yet (see that file's own comment); repeated here rather
// than exporting it from `signMaterials.ts`, which this plan reuses
// unmodified.
const BUCKET = "job-materials";

// "Short-lived" per the tailor materials route's precedent
// (`app/api/tailor/materials/[runId]/route.ts`): 5 minutes.
const SIGNED_URL_EXPIRY_SECONDS = 300;

export type BuildSubmitPacketResult =
  | { ok: true; packet: SubmitPacket }
  | { ok: false; status: 409; error: "no_application_profile" }
  | { ok: false; status: 404; error: "no_materials" };

/**
 * Assembles the full submit packet for `postingId` on behalf of `userId`.
 * Every step is a separate `await`, in the exact order below, so the 409
 * check always happens before the `tailor_runs` query even runs.
 *
 * The `tailor_runs` lookup is scoped by both `user_id` and `posting_id` (plus
 * `status = "succeeded"`) in one query — mirrors the tailor materials route's
 * refusal-matrix shape: "no succeeded run yet" and "a succeeded run belongs
 * to someone else" collapse to the identical 404, so neither leaks a
 * user-enumeration signal.
 */
export async function buildSubmitPacket(
  admin: SupabaseClient<Database>,
  userId: string,
  authEmail: string,
  postingId: string
): Promise<BuildSubmitPacketResult> {
  // 1. No application profile at all -> 409 before any other query runs.
  const applicationProfile = await loadApplicationProfile(admin, userId);
  if (!applicationProfile) {
    return { ok: false, status: 409, error: "no_application_profile" };
  }

  // 2. Scoped tailor_runs lookup — collapses "no run" and "someone else's
  // run" into the same 404.
  const { data: run, error: runError } = await admin
    .from("tailor_runs")
    .select("id, posting_id, doc_sha256, status")
    .eq("user_id", userId)
    .eq("posting_id", postingId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;
  if (!run) {
    return { ok: false, status: 404, error: "no_materials" };
  }

  // 3. postings row — must exist via FK from tailor_runs; don't swallow.
  const { data: posting, error: postingError } = await admin
    .from("postings")
    .select("id, title, company, application_url")
    .eq("id", postingId)
    .maybeSingle();
  if (postingError) throw postingError;
  if (!posting) {
    throw new Error(`postings row missing for posting_id ${postingId} referenced by tailor_runs`);
  }

  // 4. profiles.doc for the identity block.
  const profileDocRow = await getProfileDoc(admin, userId);

  // 5. Canonical identity accessor.
  const identity = buildIdentity(profileDocRow?.doc ?? null, applicationProfile, authEmail);

  // 6. Signed URLs for whatever materials the run actually produced.
  const urls = await signMaterials(admin, userId, postingId, SIGNED_URL_EXPIRY_SECONDS);

  // 7. Cover-letter plain text (separate from the signed PDF URL).
  const { data: coverLetterFile, error: coverLetterError } = await admin.storage
    .from(BUCKET)
    .download(`${userId}/${postingId}/cover_letter.txt`);
  const coverLetterText = coverLetterError || !coverLetterFile ? "" : await coverLetterFile.text();

  // 8. ATS classification.
  const atsKind = detectAtsKind(posting.application_url ?? "");

  // 9. Assemble.
  const packet: SubmitPacket = {
    posting: {
      id: posting.id,
      title: posting.title ?? "",
      company: posting.company ?? "",
      application_url: posting.application_url ?? "",
      ats_kind: atsKind,
    },
    identity,
    materials: {
      resume_pdf_url: urls["resume.pdf"] ?? "",
      cover_letter_pdf_url: urls["cover_letter.pdf"] ?? "",
      cover_letter_text: coverLetterText,
    },
    authorization: applicationProfile.authorization ?? {},
    logistics: applicationProfile.logistics ?? {},
    self_id: applicationProfile.self_id ?? {},
    meta: {
      tailor_run_id: run.id,
      doc_sha256: run.doc_sha256,
      generated_at: new Date().toISOString(),
    },
  };

  return { ok: true, packet };
}
