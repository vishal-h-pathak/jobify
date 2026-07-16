import { describe, expect, it, vi } from "vitest";
import {
  initialValuePairsState,
  submitValuePairs,
  ValuePairCardsView,
  valuePairsReducer,
  VALUE_PAIRS_FRAME_COPY,
  VALUE_PAIRS_MIN_ANSWERS,
  type ValuePairDef,
} from "./ValuePairsPanel";

const PAIRS: ValuePairDef[] = [
  { pair_id: "mission_prestige", a: "Mission-driven work", b: "Prestige / brand name" },
  { pair_id: "hours_equity", a: "Predictable 40 hours", b: "Variable 50 + equity upside" },
  { pair_id: "specialist_generalist", a: "Deep specialist", b: "Broad generalist" },
  { pair_id: "autonomy_mentorship", a: "High autonomy", b: "Structured mentorship" },
  { pair_id: "stability_upside", a: "Stability", b: "Upside risk" },
  { pair_id: "ic_leadership", a: "Individual-contributor track", b: "Leadership track" },
  { pair_id: "remote_in_person", a: "Remote energy", b: "In-person energy" },
];

function reduce(state: ReturnType<typeof initialValuePairsState>, action: Parameters<typeof valuePairsReducer>[1]) {
  return valuePairsReducer(state, action, PAIRS.length);
}

describe("valuePairsReducer", () => {
  it("choice_made flashes the chosen side and records the choice", () => {
    const state = reduce(initialValuePairsState(), { type: "choice_made", pairId: "mission_prestige", choice: "a" });
    expect(state.phase).toBe("flashing");
    expect(state.flashing).toBe("a");
    expect(state.choices).toEqual([{ pair_id: "mission_prestige", choice: "a" }]);
  });

  it("flash_settled advances to the next pair, mid-deck", () => {
    let state = reduce(initialValuePairsState(), { type: "choice_made", pairId: "mission_prestige", choice: "a" });
    state = reduce(state, { type: "flash_settled" });
    expect(state.index).toBe(1);
    expect(state.phase).toBe("choosing");
    expect(state.flashing).toBeNull();
  });

  it("flash_settled on the last pair moves to submitting", () => {
    let state = { ...initialValuePairsState(), index: PAIRS.length - 1 };
    state = reduce(state, { type: "choice_made", pairId: "remote_in_person", choice: "b" });
    state = reduce(state, { type: "flash_settled" });
    expect(state.phase).toBe("submitting");
  });

  it("skip_pressed is usable once: advances without recording a choice, then hides itself", () => {
    let state = reduce(initialValuePairsState(), { type: "skip_pressed" });
    expect(state.index).toBe(1);
    expect(state.skipUsed).toBe(true);
    expect(state.choices).toEqual([]);

    // a second skip attempt is a no-op — the panel already hides the button,
    // but the reducer itself must also refuse to skip twice.
    const before = state;
    state = reduce(state, { type: "skip_pressed" });
    expect(state).toBe(before);
  });

  it("skipping the final pair still moves to submitting", () => {
    let state = { ...initialValuePairsState(), index: PAIRS.length - 1 };
    state = reduce(state, { type: "skip_pressed" });
    expect(state.phase).toBe("submitting");
  });

  it("submit_succeeded finishes; submit_failed surfaces the error", () => {
    const succeeded = reduce({ ...initialValuePairsState(), phase: "submitting" }, { type: "submit_succeeded" });
    expect(succeeded.phase).toBe("finished");

    const failed = reduce({ ...initialValuePairsState(), phase: "submitting" }, { type: "submit_failed", error: "network down" });
    expect(failed.phase).toBe("error");
    expect(failed.error).toBe("network down");
  });

  it("choice_made is ignored once already flashing (no double-submit on rapid taps)", () => {
    let state = reduce(initialValuePairsState(), { type: "choice_made", pairId: "mission_prestige", choice: "a" });
    const beforeSecondTap = state;
    state = reduce(state, { type: "choice_made", pairId: "mission_prestige", choice: "b" });
    expect(state).toBe(beforeSecondTap);
  });
});

describe("submitValuePairs", () => {
  it("POSTs the choices array directly as the body", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "values", receipt: "7 trade-offs answered" }) }));
    const choices = [{ pair_id: "mission_prestige", choice: "a" as const }];
    await submitValuePairs(choices, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/values",
      expect.objectContaining({ method: "POST", body: JSON.stringify(choices) })
    );
  });
});

describe("ValuePairCardsView — rendered tree", () => {
  it("renders the fixed 'Same pay either way' framing and both option labels", () => {
    const view = ValuePairCardsView({
      pair: PAIRS[0],
      flashing: null,
      skipAvailable: true,
      onChoose: vi.fn(),
      onSkip: vi.fn(),
    });
    const [frameCopy, optionsRow, skipButton] = view.props.children;
    expect(frameCopy.props.children).toBe(VALUE_PAIRS_FRAME_COPY);
    const [optionA, optionB] = optionsRow.props.children;
    expect(optionA.props.children).toBe("Mission-driven work");
    expect(optionB.props.children).toBe("Prestige / brand name");
    expect(skipButton).toBeTruthy();
  });

  it("hides the skip link once already used", () => {
    const view = ValuePairCardsView({
      pair: PAIRS[0],
      flashing: null,
      skipAvailable: false,
      onChoose: vi.fn(),
      onSkip: vi.fn(),
    });
    expect(view.props.children[2]).toBeFalsy();
  });

  it("flashes the chosen side's border amber", () => {
    const view = ValuePairCardsView({ pair: PAIRS[0], flashing: "b", skipAvailable: true, onChoose: vi.fn(), onSkip: vi.fn() });
    const [, optionsRow] = view.props.children;
    const [optionA, optionB] = optionsRow.props.children;
    expect(optionA.props.className).toContain("border-line");
    expect(optionB.props.className).toContain("border-amber");
  });

  it("tapping an option calls onChoose with that side", () => {
    const onChoose = vi.fn();
    const view = ValuePairCardsView({ pair: PAIRS[0], flashing: null, skipAvailable: true, onChoose, onSkip: vi.fn() });
    const [, optionsRow] = view.props.children;
    optionsRow.props.children[1].props.onClick();
    expect(onChoose).toHaveBeenCalledWith("b");
  });
});

describe("server minimum sanity", () => {
  it("7 pairs with one skip meets the 6-answer minimum", () => {
    expect(PAIRS.length - 1).toBe(VALUE_PAIRS_MIN_ANSWERS);
  });
});
