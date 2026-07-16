import { describe, expect, it, vi } from "vitest";
import { handleResumeUpload } from "./ResumeForm";

/**
 * No test file existed for ResumeForm before this task. This repo's vitest
 * config runs in the `node` environment with no jsdom/@testing-library/react
 * (see app/(app)/onboarding/page.test.tsx's header comment) and ResumeForm
 * is a hook-bearing component, so — matching this repo's established
 * convention of extracting business logic into plain, DI'd functions and
 * testing those directly — the PDF-upload logic was pulled out into the
 * exported `handleResumeUpload` (see its doc comment in ResumeForm.tsx).
 * `handleFile` inside the component applies its result via the exact same
 * two `setResumeText`/`setError` lines regardless of extension, so proving
 * both branches return the identical `ResumeUploadResult` shape here is
 * the closest available proof — without a DOM — that extracted PDF text
 * reaches `resumeText`, the same field `submit()` POSTs, exactly as a
 * pasted or .txt-uploaded resume would.
 */

function fakeResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

describe("handleResumeUpload — extension validation", () => {
  it("rejects a disallowed extension without reading it or calling fetch", async () => {
    const file = new File(["binary"], "resume.docx", { type: "application/octet-stream" });
    const textSpy = vi.spyOn(file, "text");
    const fetchMock = vi.fn();
    const result = await handleResumeUpload(file, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, error: "Please upload a .pdf, .txt, or .md file." });
    expect(textSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleResumeUpload — .txt/.md stay client-side, unaffected by the .pdf route", () => {
  it("reads .txt via file.text(), never calling fetch", async () => {
    const fetchMock = vi.fn();
    const file = new File(["plain resume body"], "resume.txt", { type: "text/plain" });
    const result = await handleResumeUpload(file, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, text: "plain resume body" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads .md via file.text(), never calling fetch", async () => {
    const fetchMock = vi.fn();
    const file = new File(["# resume"], "resume.md", { type: "text/markdown" });
    const result = await handleResumeUpload(file, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, text: "# resume" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleResumeUpload — .pdf routes through /api/resume/extract (judgment call #8)", () => {
  it("POSTs the file as multipart FormData under the 'file' field and returns the extracted text", async () => {
    const file = new File(["%PDF-1.4 fake bytes"], "resume.pdf", { type: "application/pdf" });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/resume/extract");
      expect(init?.method).toBe("POST");
      const body = init?.body as FormData;
      expect(body.get("file")).toBe(file);
      return fakeResponse({ ok: true, text: "PDF-extracted resume text" });
    });
    const result = await handleResumeUpload(file, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, text: "PDF-extracted resume text" });
  });

  it("maps a 422 { ok: false, error } response to the same failure shape as an extension rejection", async () => {
    const file = new File(["not really a pdf"], "resume.pdf", { type: "application/pdf" });
    const fetchMock = vi.fn(async () =>
      fakeResponse({ ok: false, error: "Couldn't read text in this PDF — paste it instead." }, false)
    );
    const result = await handleResumeUpload(file, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, error: "Couldn't read text in this PDF — paste it instead." });
  });
});

describe("handleResumeUpload — spy: .pdf and .txt return the identical ok-result shape that feeds the same setResumeText/setError calls in handleFile", () => {
  it("a .pdf upload's extracted text and a .txt upload's read text both resolve to { ok: true, text } — the exact shape ResumeForm's handleFile applies via setResumeText(result.text)", async () => {
    const pdfFile = new File(["%PDF-1.4 fake bytes"], "resume.pdf", { type: "application/pdf" });
    const fetchMock = vi.fn(async () => fakeResponse({ ok: true, text: "same-shape resume body" }));
    const pdfResult = await handleResumeUpload(pdfFile, fetchMock as unknown as typeof fetch);

    const txtFile = new File(["same-shape resume body"], "resume.txt", { type: "text/plain" });
    const txtResult = await handleResumeUpload(txtFile);

    // Both extensions produce the identical { ok: true, text } shape;
    // handleFile in ResumeForm.tsx has exactly one `setResumeText(result.text)`
    // call for the ok branch, shared by every extension — there is no
    // separate persistence path for PDF-derived text.
    expect(pdfResult).toEqual(txtResult);
    expect(pdfResult).toEqual({ ok: true, text: "same-shape resume body" });
  });
});
