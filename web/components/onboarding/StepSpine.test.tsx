import { describe, expect, it } from "vitest";
import { deriveSpineSteps, StepSpine } from "./StepSpine";

describe("deriveSpineSteps — stage -> 4-label spine mapping", () => {
  it("anchor stage: Role current, nothing complete, no receipts even if supplied", () => {
    const steps = deriveSpineSteps("anchor", { anchor: "should not show yet" });
    expect(steps.map((s) => s.status)).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    expect(steps[0].receipt).toBeUndefined();
    expect(steps[0].index).toBe("01");
    expect(steps.map((s) => s.label)).toEqual(["Role", "Range", "Resume (optional)", "What you want"]);
  });

  it("calibration stage: Role complete with its receipt, Range current", () => {
    const steps = deriveSpineSteps("calibration", { anchor: "Staff Engineer · Acme" });
    expect(steps.map((s) => s.status)).toEqual(["complete", "current", "upcoming", "upcoming"]);
    expect(steps[0].receipt).toBe("Staff Engineer · Acme");
    expect(steps[1].receipt).toBeUndefined();
  });

  it("resume stage: Role + Range complete, Resume current", () => {
    const steps = deriveSpineSteps("resume", { anchor: "PM · Foo", calibration: "4 answers" });
    expect(steps.map((s) => s.status)).toEqual(["complete", "complete", "current", "upcoming"]);
    expect(steps[1].receipt).toBe("4 answers");
  });

  it("targeting stage: first three complete, What you want current, resume receipt attached", () => {
    const steps = deriveSpineSteps("targeting", {
      anchor: "PM · Foo",
      calibration: "4 answers",
      resume: "resume added",
    });
    expect(steps.map((s) => s.status)).toEqual(["complete", "complete", "complete", "current"]);
    expect(steps[2].receipt).toBe("resume added");
    // The final step never gets a receipt — no receipt key maps to it.
    expect(steps[3].receipt).toBeUndefined();
  });

  it("legacy identity stage folds into the same position as targeting (defensive, v2 never produces it)", () => {
    const steps = deriveSpineSteps("identity", { anchor: "a", calibration: "4 answers", resume: "skipped — built from your answers" });
    expect(steps.map((s) => s.status)).toEqual(["complete", "complete", "complete", "current"]);
  });

  it("done stage: every step complete", () => {
    const steps = deriveSpineSteps("done", { anchor: "a", calibration: "4 answers", resume: "resume added" });
    expect(steps.map((s) => s.status)).toEqual(["complete", "complete", "complete", "complete"]);
    expect(steps[3].receipt).toBeUndefined();
  });

  it("resumed session with no locally-observed receipts: complete steps render with no receipt text", () => {
    const steps = deriveSpineSteps("targeting", {});
    expect(steps.map((s) => s.status)).toEqual(["complete", "complete", "complete", "current"]);
    expect(steps.every((s) => s.receipt === undefined)).toBe(true);
  });
});

describe("StepSpine — rendered tree", () => {
  it("renders a checkmark for complete steps and the index number for current/upcoming", () => {
    const steps = deriveSpineSteps("resume", { anchor: "PM · Foo", calibration: "4 answers" });
    const view = StepSpine({ steps });
    const [row] = view.props.children;
    const stepNodes = row.props.children;

    const [roleNode, , resumeNode, targetingNode] = stepNodes;
    const roleMark = roleNode.props.children[0].props.children[0];
    expect(roleMark.props.children).toBe("✓");
    const resumeMark = resumeNode.props.children[0].props.children[0];
    expect(resumeMark.props.children).toBe("03");
    const targetingMark = targetingNode.props.children[0].props.children[0];
    expect(targetingMark.props.children).toBe("04");
  });

  it("renders the receipt line only for completed steps that have one", () => {
    const steps = deriveSpineSteps("resume", { anchor: "PM · Foo", calibration: "4 answers" });
    const view = StepSpine({ steps });
    const [row] = view.props.children;
    const [roleNode, rangeNode, resumeNode] = row.props.children;

    expect(roleNode.props.children[1].props.children).toBe("PM · Foo");
    expect(rangeNode.props.children[1].props.children).toBe("4 answers");
    // Resume is current, not complete — no receipt rendered at all.
    expect(resumeNode.props.children[1]).toBeFalsy();
  });

  it("progress bar width reflects completed-plus-current segments", () => {
    const steps = deriveSpineSteps("calibration");
    const view = StepSpine({ steps });
    const [, progressTrack] = view.props.children;
    const progressFill = progressTrack.props.children;
    // anchor complete + calibration current = 2 of 4 segments filled.
    expect(progressFill.props.style.width).toBe("50%");
  });

  it("progress bar fills fully once done", () => {
    const steps = deriveSpineSteps("done");
    const view = StepSpine({ steps });
    const [, progressTrack] = view.props.children;
    const progressFill = progressTrack.props.children;
    expect(progressFill.props.style.width).toBe("100%");
  });
});
