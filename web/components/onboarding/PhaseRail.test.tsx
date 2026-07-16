import { describe, expect, it } from "vitest";
import type { ModulesState } from "@/lib/onboarding/moduleRegistry";
import { PhaseRail } from "./PhaseRail";

function completion(receipt: string, completedAt = "2026-07-16T00:00:00.000Z") {
  return { completed_at: completedAt, receipt };
}

describe("PhaseRail — rendered tree", () => {
  it("a brand-new session: three segments at 0, 0% fill, no receipt line", () => {
    const view = PhaseRail({ modules: {}, stage: "anchor" });
    const [segmentRow, progressTrack, receiptLine] = view.props.children;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const segmentNodes = segmentRow.props.children as any[];
    expect(segmentNodes.map((n) => n.props.children[0].props.children)).toEqual([
      ["01", " ", "Ground truth"],
      ["02", " ", "Depth"],
      ["03", " ", "Mirror"],
    ]);
    expect(segmentNodes.map((n) => n.props.children[1].props.children)).toEqual([
      [0, "/", 4],
      [0, "/", 7],
      [0, "/", 1],
    ]);

    const progressFill = progressTrack.props.children[0];
    expect(progressFill.props.style.width).toBe("0%");
    expect(receiptLine).toBeFalsy();
  });

  it("phase 1 complete: Ground truth 4/4, 4/12 fill, receipt from the latest completion", () => {
    const modules: ModulesState = {
      anchor: completion("Engineer · Acme", "2026-07-16T00:00:00.000Z"),
      reactions: completion("6 reactions (4 interested)", "2026-07-16T00:01:00.000Z"),
      values: completion("7 trade-offs answered", "2026-07-16T00:02:00.000Z"),
      dealbreakers: completion("2 dealbreakers", "2026-07-16T00:03:00.000Z"),
    };
    const view = PhaseRail({ modules, stage: "calibration" });
    const [segmentRow, progressTrack, receiptLine] = view.props.children;

    const groundTruthFraction = segmentRow.props.children[0].props.children[1].props.children;
    expect(groundTruthFraction).toEqual([4, "/", 4]);

    const progressFill = progressTrack.props.children[0];
    expect(progressFill.props.style.width).toBe(`${(4 / 12) * 100}%`);
    expect(receiptLine.props.children).toBe("2 dealbreakers");
  });

  it("resumability: stage-derived range/evidence completion counts toward the Depth fraction without a real modules entry", () => {
    const view = PhaseRail({ modules: {}, stage: "targeting" });
    const [segmentRow] = view.props.children;
    const depthFraction = segmentRow.props.children[1].props.children[1].props.children;
    expect(depthFraction).toEqual([2, "/", 7]); // range + evidence derived complete
  });

  it("full completion: 12/12 fill, Mirror 1/1", () => {
    const modules = Object.fromEntries(
      [
        "anchor",
        "reactions",
        "values",
        "dealbreakers",
        "energy",
        "environment",
        "trajectory",
        "range",
        "evidence",
        "voice",
        "metrics",
        "mirror",
      ].map((key, i) => [key, completion(key, `2026-07-16T00:${String(i).padStart(2, "0")}:00.000Z`)])
    ) as ModulesState;
    const view = PhaseRail({ modules, stage: "done" });
    const [segmentRow, progressTrack] = view.props.children;
    const mirrorFraction = segmentRow.props.children[2].props.children[1].props.children;
    expect(mirrorFraction).toEqual([1, "/", 1]);
    const progressFill = progressTrack.props.children[0];
    expect(progressFill.props.style.width).toBe("100%");
  });

  it("does not render the sweep overlay by default", () => {
    const view = PhaseRail({ modules: {}, stage: "anchor" });
    const [, progressTrack] = view.props.children;
    expect(progressTrack.props.children[1]).toBeFalsy();
  });

  it("renders the one-shot sweep overlay when sweeping=true (checkpoint interstitial beat)", () => {
    const view = PhaseRail({ modules: {}, stage: "anchor", sweeping: true });
    const [, progressTrack] = view.props.children;
    const sweepOverlay = progressTrack.props.children[1];
    expect(sweepOverlay.props.className).toContain("rail-sweep");
  });
});
