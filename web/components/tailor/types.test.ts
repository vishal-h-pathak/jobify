import { describe, expect, it } from "vitest";
import { deriveTailorState, TAILOR_STAGES, TEMPLATE_OPTIONS } from "./types";

describe("deriveTailorState", () => {
  it("no runs → tailorable", () => {
    expect(deriveTailorState([])).toEqual({ kind: "tailorable" });
  });

  it("only failed runs → tailorable (retry is just a fresh tailor)", () => {
    expect(deriveTailorState([{ id: "r1", status: "failed" }])).toEqual({ kind: "tailorable" });
  });

  it("a queued run → generating, with its id", () => {
    expect(deriveTailorState([{ id: "r1", status: "queued" }])).toEqual({
      kind: "generating",
      runId: "r1",
    });
  });

  it("a running run → generating, with its id", () => {
    expect(deriveTailorState([{ id: "r1", status: "running" }])).toEqual({
      kind: "generating",
      runId: "r1",
    });
  });

  it("an active run always wins over an older succeeded one", () => {
    expect(
      deriveTailorState([
        { id: "new", status: "running" },
        { id: "old", status: "succeeded" },
      ])
    ).toEqual({ kind: "generating", runId: "new" });
  });

  it("only succeeded runs → materials, latest (first in the desc-ordered list) wins", () => {
    expect(
      deriveTailorState([
        { id: "latest", status: "succeeded" },
        { id: "earlier", status: "succeeded" },
      ])
    ).toEqual({ kind: "materials", runId: "latest" });
  });

  it("a failed run does not block an older succeeded one from showing materials", () => {
    expect(
      deriveTailorState([
        { id: "retry-failed", status: "failed" },
        { id: "old-success", status: "succeeded" },
      ])
    ).toEqual({ kind: "materials", runId: "old-success" });
  });
});

describe("TAILOR_STAGES", () => {
  it("has the 6 worker-emitted steps in worker order", () => {
    expect(TAILOR_STAGES.map((s) => s.step)).toEqual([
      "profile",
      "frame",
      "resume",
      "cover_letter",
      "verify",
      "render",
    ]);
  });
});

describe("TEMPLATE_OPTIONS", () => {
  it("has the 5 resume template ids", () => {
    expect(TEMPLATE_OPTIONS.map((t) => t.id)).toEqual(["classic", "modern", "compact", "accent", "executive"]);
  });
});
