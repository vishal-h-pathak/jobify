import { describe, expect, it } from "vitest";
import { deriveStages, applyUserEdit, resolveMaterialUrls } from "./TailorViewer";
import type { ClaimUnit } from "@/components/tailor/types";

describe("deriveStages", () => {
  it("no progress yet — the first stage is current, the rest pending", () => {
    const stages = deriveStages([]);
    expect(stages[0]).toEqual({ step: "profile", label: "reading your profile", state: "current" });
    expect(stages[1].state).toBe("pending");
    expect(stages.every((s, i) => (i === 0 ? s.state === "current" : s.state === "pending"))).toBe(true);
  });

  it("completed steps are done, the next unseen step is current, later ones pending", () => {
    const stages = deriveStages([
      { step: "profile", label: "reading your profile", at: "2026-07-17T10:00:00Z" },
      { step: "frame", label: "choosing the frame", at: "2026-07-17T10:00:05Z" },
    ]);
    expect(stages[0].state).toBe("done");
    expect(stages[0].at).toBe("2026-07-17T10:00:00Z");
    expect(stages[1].state).toBe("done");
    expect(stages[2].state).toBe("current");
    expect(stages[3].state).toBe("pending");
    expect(stages[5].state).toBe("pending");
  });

  it("all 6 steps done — none current or pending", () => {
    const progress = ["profile", "frame", "resume", "cover_letter", "verify", "render"].map((step) => ({
      step,
      label: step,
      at: "2026-07-17T10:00:00Z",
    }));
    const stages = deriveStages(progress);
    expect(stages.every((s) => s.state === "done")).toBe(true);
  });
});

describe("resolveMaterialUrls", () => {
  it("picks out the 4 signed URLs the viewer needs, by their storage key", () => {
    const urls = {
      "resume.pdf": "https://sign/resume.pdf",
      "cover_letter.pdf": "https://sign/cover_letter.pdf",
      "cover_letter.txt": "https://sign/cover_letter.txt",
      "claims.json": "https://sign/claims.json",
      "tailored.json": "https://sign/tailored.json",
      "render_meta.json": "https://sign/render_meta.json",
    };
    expect(resolveMaterialUrls(urls)).toEqual({
      claimsUrl: "https://sign/claims.json",
      coverLetterTextUrl: "https://sign/cover_letter.txt",
      resumePdfUrl: "https://sign/resume.pdf",
      coverLetterPdfUrl: "https://sign/cover_letter.pdf",
    });
  });

  it("leaves a field undefined when its artifact wasn't in the signed set (e.g. a partial upload)", () => {
    expect(resolveMaterialUrls({ "claims.json": "https://sign/claims.json" })).toEqual({
      claimsUrl: "https://sign/claims.json",
      coverLetterTextUrl: undefined,
      resumePdfUrl: undefined,
      coverLetterPdfUrl: undefined,
    });
  });
});

describe("applyUserEdit", () => {
  const units: ClaimUnit[] = [
    {
      id: "r.exp0.b0",
      surface: "resume",
      kind: "bullet",
      text: "original",
      sources: [{ file: "cv.md", quote: "original" }],
      numbers: [{ token: "5", basis: "confirmed_metric" }],
      status: "verified",
    },
    { id: "r.exp0.b1", surface: "resume", kind: "bullet", text: "untouched", status: "verified" },
  ];

  it("replaces the text and marks only the targeted unit user_edited", () => {
    const result = applyUserEdit(units, "r.exp0.b0", "edited text");
    expect(result[0]).toEqual({
      id: "r.exp0.b0",
      surface: "resume",
      kind: "bullet",
      text: "edited text",
      status: "user_edited",
    });
    expect(result[1]).toBe(units[1]);
  });

  it("clears sources and numbers on edit — a user-authored unit is exempt from sourcing, not falsely still-sourced", () => {
    const result = applyUserEdit(units, "r.exp0.b0", "edited text");
    expect(result[0].sources).toBeUndefined();
    expect(result[0].numbers).toBeUndefined();
  });

  it("an id that matches nothing leaves the list unchanged", () => {
    expect(applyUserEdit(units, "no-such-id", "x")).toEqual(units);
  });
});
