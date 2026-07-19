import type { EngineFiles, SubmitPacket } from "../engineTypes";

/**
 * Fetches the packet's two PDF materials from their short-lived signed
 * Storage URLs and turns them into `File`s the engine's file driver can
 * hand to a real `<input type="file">`. These fetches are the one
 * constitution-carved-out exception to "no fetch to any non-app origin" —
 * Supabase Storage signed URLs are a different origin than the app by
 * design. No `credentials` option here: a signed URL authorizes via its own
 * token in the query string, not cookies.
 */
export async function fetchMaterialFiles(fetchImpl: typeof fetch, packet: SubmitPacket): Promise<EngineFiles> {
  const files: EngineFiles = {};

  if (packet.materials.resume_pdf_url) {
    const res = await fetchImpl(packet.materials.resume_pdf_url);
    if (res.ok) files.resume = new File([await res.blob()], "resume.pdf", { type: "application/pdf" });
  }
  if (packet.materials.cover_letter_pdf_url) {
    const res = await fetchImpl(packet.materials.cover_letter_pdf_url);
    if (res.ok) files.cover_letter = new File([await res.blob()], "cover_letter.pdf", { type: "application/pdf" });
  }

  return files;
}

/**
 * True when the packet promised a material (a non-empty signed URL) but
 * `fetchMaterialFiles` didn't come back with the corresponding `File` — the
 * signature of a signed URL that expired between packet assembly and the
 * fetch above. The caller's response: refetch the packet once for fresh
 * URLs (packets are cheap; signed URLs are 5-minute short-lived per
 * `web/lib/submit/packet.ts`), then retry.
 */
export function materialsIncomplete(files: EngineFiles, packet: SubmitPacket): boolean {
  const missingResume = Boolean(packet.materials.resume_pdf_url) && !files.resume;
  const missingCoverLetter = Boolean(packet.materials.cover_letter_pdf_url) && !files.cover_letter;
  return missingResume || missingCoverLetter;
}
