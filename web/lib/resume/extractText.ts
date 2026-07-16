// Server-only: never imported by a client component. The only caller is
// POST /api/resume/extract (see web/app/api/resume/extract/route.ts) — this
// module is a pure function, not an HTTP handler.

export type ExtractResult = { ok: true; text: string } | { ok: false; error: string };

const MAX_BYTES = 5 * 1024 * 1024; // ~5MB, per owner decision
const MIN_EXTRACTED_CHARS = 20; // heuristic floor for "this PDF has no real text layer"

const UNKNOWN_EXTENSION_ERROR = "Please upload a .pdf, .txt, or .md file.";
const TOO_LARGE_ERROR = "That PDF is too large (max 5MB).";
const NO_TEXT_ERROR = "Couldn't read text in this PDF — paste it instead.";

/**
 * Extracts plain text from an uploaded resume file's raw bytes, dispatching
 * on the filename's extension. `.txt`/`.md` are decoded directly (no PDF
 * library involved); `.pdf` runs through the PDF library below. Any other
 * extension is rejected. The caller (the route) is the only place bytes
 * are read off the wire — this function never touches `Request`/`FormData`.
 */
export async function extractText(filename: string, bytes: Uint8Array): Promise<ExtractResult> {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return { ok: true, text: new TextDecoder("utf-8").decode(bytes) };
  }

  if (!lower.endsWith(".pdf")) {
    return { ok: false, error: UNKNOWN_EXTENSION_ERROR };
  }

  // Checked before touching the PDF library — don't spend CPU parsing an
  // oversized file just to reject it.
  if (bytes.length > MAX_BYTES) {
    return { ok: false, error: TOO_LARGE_ERROR };
  }

  // Judgment call #7 (global-constraints.md): `unpdf` over `pdf-parse` — it's
  // pure-JS with no `fs`/canvas dependency (the optional `@napi-rs/canvas`
  // peer is only needed for its image-rendering helpers, which we don't
  // use), purpose-built for serverless/edge Node runtimes, and actively
  // maintained. Verified against a real generated PDF: `extractText` takes
  // raw bytes directly (no separate `getDocumentProxy` call needed), throws
  // `InvalidPDFException` on corrupt/encrypted input, and returns an empty
  // string (not a throw) for a valid PDF with no text layer.
  const { extractText: extractPdfText } = await import("unpdf");

  let text: string;
  try {
    const result = await extractPdfText(bytes, { mergePages: true });
    text = result.text;
  } catch {
    // Encrypted or corrupt PDF — never leak the underlying library error,
    // just the friendly copy per the owner decision.
    return { ok: false, error: NO_TEXT_ERROR };
  }

  if (text.trim().length < MIN_EXTRACTED_CHARS) {
    // No thrown error, just an empty/near-empty text layer — the
    // image-only-PDF case.
    return { ok: false, error: NO_TEXT_ERROR };
  }

  return { ok: true, text };
}
