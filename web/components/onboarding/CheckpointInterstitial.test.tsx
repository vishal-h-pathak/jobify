import { describe, expect, it, vi } from "vitest";
import { CheckpointInterstitial } from "./CheckpointInterstitial";

describe("CheckpointInterstitial — honest branching on checkpoint_fired", () => {
  it("fired + matches: claims the hunt left and shows the match-count chip", () => {
    const view = CheckpointInterstitial({ fired: true, matchCount: 4, onContinue: vi.fn() });
    const [heading, body, chipRow, actions] = view.props.children;
    expect(heading.props.children).toBe("Your first hunt just left.");
    expect(body.props.children).toContain("Phase one is enough to hunt with, so we sent it.");
    expect(chipRow.props.children.props.children).toEqual([4, " matches waiting"]);
    expect(actions.props.children.props.children).toBe("Keep going — Depth, about 10 minutes.");
  });

  it("fired but zero matches yet: no chip rendered (never claim a count that isn't true)", () => {
    const view = CheckpointInterstitial({ fired: true, matchCount: 0, onContinue: vi.fn() });
    const [, , chipRow] = view.props.children;
    expect(chipRow).toBeFalsy();
  });

  it("not fired: honest copy, no hunt claim, still no chip even with a stale matchCount", () => {
    const view = CheckpointInterstitial({ fired: false, matchCount: 3, onContinue: vi.fn() });
    const [heading, body, chipRow] = view.props.children;
    expect(heading.props.children).toBe("Phase one done.");
    expect(body.props.children).toBe("Depth next — about 10 minutes.");
    expect(body.props.children).not.toContain("hunt");
    expect(chipRow).toBeFalsy();
  });

  it("the continue button fires onContinue", () => {
    const onContinue = vi.fn();
    const view = CheckpointInterstitial({ fired: true, matchCount: 0, onContinue });
    const [, , , actions] = view.props.children;
    actions.props.children.props.onClick();
    expect(onContinue).toHaveBeenCalled();
  });
});
