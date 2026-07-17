import { describe, expect, it } from "vitest";
import { deriveStages } from "./TailorViewer";

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
