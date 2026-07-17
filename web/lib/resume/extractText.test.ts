import { describe, expect, it } from "vitest";
import { extractText } from "./extractText";

/**
 * Hand-built minimal single-page PDF (PDF 1.4, one Type1/Helvetica font, one
 * content stream with a `Tj` text-show operator) — no binary fixture is ever
 * committed to the repo (scrub_gate.sh forbids tracked `.pdf`s outside
 * resume_templates/onboarding examples); this is generated in-memory at
 * test-run time instead. Verified against the real `unpdf` library during
 * implementation (see extractText.ts's header comment).
 */
function buildTextPdf(text: string): Uint8Array {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objs = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  ];
  return assemblePdf(objs);
}

/** Same page structure, but an empty content stream — a valid PDF with no
 * text layer at all, standing in for an image-only/vector-only page without
 * needing to construct a real embedded image XObject. */
function buildBlankPdf(): Uint8Array {
  const objs = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n`,
  ];
  return assemblePdf(objs);
}

function assemblePdf(objs: string[]): Uint8Array {
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objs) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

describe("extractText — .txt/.md pass-through (unaffected by the PDF branch)", () => {
  it("decodes .txt bytes as UTF-8 and returns them verbatim, case-insensitive extension", async () => {
    const bytes = new TextEncoder().encode("Alex Quinn\nSenior PM — 8 years");
    const result = await extractText("resume.TXT", bytes);
    expect(result).toEqual({ ok: true, text: "Alex Quinn\nSenior PM — 8 years" });
  });

  it("decodes .md bytes as UTF-8 and returns them verbatim", async () => {
    const bytes = new TextEncoder().encode("# Alex Quinn\n\n- Did things");
    const result = await extractText("resume.md", bytes);
    expect(result).toEqual({ ok: true, text: "# Alex Quinn\n\n- Did things" });
  });
});

describe("extractText — unknown extension", () => {
  it("rejects a .docx (or any non pdf/txt/md) filename without touching the bytes", async () => {
    const result = await extractText("resume.docx", new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ ok: false, error: "Please upload a .pdf, .txt, or .md file." });
  });
});

describe("extractText — .pdf oversize rejection", () => {
  it("rejects bytes longer than MAX_BYTES before ever touching the PDF library — no real PDF needed, any oversized buffer with a .pdf name is enough", async () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    const result = await extractText("resume.pdf", oversized);
    expect(result).toEqual({ ok: false, error: "That PDF is too large (max 5MB)." });
  });

  it("does not reject a small ordinary PDF on size grounds — the size check must not false-positive on real uploads", async () => {
    // A real, small text PDF well under the size cap, with text comfortably
    // above MIN_EXTRACTED_CHARS too — proves the boundary check doesn't
    // itself misfire on ordinary uploads.
    const bytes = buildTextPdf("Well under the five megabyte cap");
    const result = await extractText("resume.pdf", bytes);
    expect(result.ok).toBe(true);
  });
});

describe("extractText — .pdf happy path (real generated PDF with a genuine text layer)", () => {
  it("extracts the embedded text via unpdf", async () => {
    const bytes = buildTextPdf("Alex Quinn — Senior Product Manager with eight years of experience");
    const result = await extractText("resume.pdf", bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Comfortably above MIN_EXTRACTED_CHARS (20) — this is the case the
      // image-only heuristic must NOT false-positive on.
      expect(result.text.length).toBeGreaterThan(20);
      expect(result.text).toContain("Alex Quinn");
      expect(result.text).toContain("Senior Product Manager");
    }
  });
});

describe("extractText — .pdf image-only / no-text-layer rejection", () => {
  it("rejects a valid PDF whose content stream has no text (the image-only case) with the friendly copy, not a thrown error", async () => {
    const bytes = buildBlankPdf();
    const result = await extractText("resume.pdf", bytes);
    expect(result).toEqual({ ok: false, error: "Couldn't read text in this PDF — paste it instead." });
  });
});

describe("extractText — .pdf corrupt/encrypted rejection", () => {
  it("catches a thrown parse error and returns the same friendly copy, never the underlying library error", async () => {
    const garbage = new TextEncoder().encode("%PDF-1.4\nthis is not a real pdf body at all, just garbage bytes");
    const result = await extractText("resume.pdf", garbage);
    expect(result).toEqual({ ok: false, error: "Couldn't read text in this PDF — paste it instead." });
  });
});
