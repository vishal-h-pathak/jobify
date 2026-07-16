import { describe, expect, it, vi } from "vitest";
import {
  acceptMirror,
  canTryAgain,
  generateMirror,
  highlightQuotedPhrases,
  initialMirrorState,
  MirrorReflectionView,
  mirrorReducer,
} from "./MirrorPanel";

function noop() {
  /* unused callback slot */
}

const PARAGRAPHS: [string, string] = [
  "You move fast and you're allergic to busywork.",
  "You want the room to trust you with ambiguity.",
];

describe("mirrorReducer", () => {
  it("draft_loaded lands on ready with the generated paragraphs + quoted phrases", () => {
    const state = mirrorReducer(initialMirrorState(), {
      type: "draft_loaded",
      paragraphs: PARAGRAPHS,
      quotedPhrases: ["allergic to busywork"],
    });
    expect(state.phase).toBe("ready");
    expect(state.paragraphs).toEqual(PARAGRAPHS);
    expect(state.quotedPhrases).toEqual(["allergic to busywork"]);
  });

  it("generate_failed moves to error", () => {
    const state = mirrorReducer(initialMirrorState(), { type: "generate_failed", error: "model overloaded" });
    expect(state.phase).toBe("error");
    expect(state.error).toBe("model overloaded");
  });

  it("edit_started copies the accepted paragraphs into the draft", () => {
    let state = mirrorReducer(initialMirrorState(), { type: "draft_loaded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    state = mirrorReducer(state, { type: "edit_started" });
    expect(state.phase).toBe("editing");
    expect(state.draftParagraphs).toEqual(PARAGRAPHS);
  });

  it("edit_paragraph_changed updates only the targeted index", () => {
    let state = mirrorReducer(initialMirrorState(), { type: "draft_loaded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    state = mirrorReducer(state, { type: "edit_started" });
    state = mirrorReducer(state, { type: "edit_paragraph_changed", index: 1, value: "edited second paragraph" });
    expect(state.draftParagraphs).toEqual([PARAGRAPHS[0], "edited second paragraph"]);
  });

  it("regenerate_started marks regenUsed true immediately, before the network call resolves", () => {
    let state = mirrorReducer(initialMirrorState(), { type: "draft_loaded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    state = mirrorReducer(state, { type: "regenerate_started" });
    expect(state.regenUsed).toBe(true);
    expect(state.phase).toBe("regenerating");
  });

  it("regenerate_succeeded replaces the displayed paragraphs and returns to ready", () => {
    let state = mirrorReducer(initialMirrorState(), { type: "draft_loaded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    state = mirrorReducer(state, { type: "regenerate_started" });
    const newParagraphs: [string, string] = ["a fresh first paragraph.", "a fresh second paragraph."];
    state = mirrorReducer(state, { type: "regenerate_succeeded", paragraphs: newParagraphs, quotedPhrases: ["fresh"] });
    expect(state.phase).toBe("ready");
    expect(state.paragraphs).toEqual(newParagraphs);
    expect(state.regenUsed).toBe(true);
  });

  it("regenerate_failed keeps the stale paragraphs but surfaces the error", () => {
    let state = mirrorReducer(initialMirrorState(), { type: "draft_loaded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    state = mirrorReducer(state, { type: "regenerate_started" });
    state = mirrorReducer(state, { type: "regenerate_failed", error: "network down" });
    expect(state.phase).toBe("ready");
    expect(state.paragraphs).toEqual(PARAGRAPHS);
    expect(state.error).toBe("network down");
    expect(state.regenUsed).toBe(true);
  });

  it("accept_started commits whichever paragraphs were passed (edited or not) and moves to submitting", () => {
    let state = mirrorReducer(initialMirrorState(), { type: "draft_loaded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    const edited: [string, string] = ["edited first.", "edited second."];
    state = mirrorReducer(state, { type: "accept_started", paragraphs: edited });
    expect(state.phase).toBe("submitting");
    expect(state.paragraphs).toEqual(edited);
  });

  it("accept_succeeded moves to finished", () => {
    const state = mirrorReducer(initialMirrorState(), { type: "accept_succeeded" });
    expect(state.phase).toBe("finished");
  });

  it("accept_failed returns to ready with the error surfaced", () => {
    let state = mirrorReducer(initialMirrorState(), { type: "accept_started", paragraphs: PARAGRAPHS });
    state = mirrorReducer(state, { type: "accept_failed", error: "network down" });
    expect(state.phase).toBe("ready");
    expect(state.error).toBe("network down");
  });
});

describe("canTryAgain", () => {
  it("true once a draft is ready and the regen budget hasn't been used", () => {
    const state = mirrorReducer(initialMirrorState(), { type: "draft_loaded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    expect(canTryAgain(state)).toBe(true);
  });

  it("false after one regen click, even before the network call resolves", () => {
    let state = mirrorReducer(initialMirrorState(), { type: "draft_loaded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    state = mirrorReducer(state, { type: "regenerate_started" });
    expect(canTryAgain(state)).toBe(false);
  });

  it("stays false after the regen resolves back to ready", () => {
    let state = mirrorReducer(initialMirrorState(), { type: "draft_loaded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    state = mirrorReducer(state, { type: "regenerate_started" });
    state = mirrorReducer(state, { type: "regenerate_succeeded", paragraphs: PARAGRAPHS, quotedPhrases: [] });
    expect(canTryAgain(state)).toBe(false);
  });

  it("false while generating/editing/submitting", () => {
    expect(canTryAgain(initialMirrorState())).toBe(false);
  });
});

describe("generateMirror", () => {
  it("POSTs with no body and returns the parsed draft", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ paragraphs: PARAGRAPHS, quoted_phrases: ["a"] }) }));
    const draft = await generateMirror(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/api/onboarding/modules/mirror/generate", { method: "POST" });
    expect(draft).toEqual({ paragraphs: PARAGRAPHS, quoted_phrases: ["a"] });
  });

  it("rejects on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    await expect(generateMirror(fetchImpl as unknown as typeof fetch)).rejects.toThrow("failed to generate the mirror draft");
  });
});

describe("acceptMirror", () => {
  it("POSTs {paragraphs}", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, key: "mirror", receipt: "mirror accepted" }) }));
    await acceptMirror(PARAGRAPHS, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/mirror/accept",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ paragraphs: PARAGRAPHS }) })
    );
  });

  it("rejects on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    await expect(acceptMirror(PARAGRAPHS, fetchImpl as unknown as typeof fetch)).rejects.toThrow("failed to accept the mirror draft");
  });
});

describe("highlightQuotedPhrases", () => {
  it("returns the plain text unchanged when there are no quoted phrases", () => {
    expect(highlightQuotedPhrases("plain text", [])).toBe("plain text");
  });

  it("wraps each occurrence of a quoted phrase in an underlined span", () => {
    const result = highlightQuotedPhrases("You are allergic to busywork, truly.", ["allergic to busywork"]) as unknown[];
    const spans = result.filter((part): part is { props: { className: string; children: string } } => {
      return typeof part === "object" && part !== null && "props" in part;
    });
    const highlighted = spans.find((s) => s.props.className?.includes("decoration-amber"));
    expect(highlighted).toBeTruthy();
    expect(highlighted?.props.children).toBe("allergic to busywork");
  });

  it("prefers the longer phrase when one phrase is a substring of another (avoids a partial-match split)", () => {
    // With "short" tried before "shorter", the alternation would match just
    // the first 5 characters of "shorter" and leave a stray "er" span.
    // Sorting longest-first keeps "shorter" intact as one highlighted span.
    const result = highlightQuotedPhrases("the shorter path", ["short", "shorter"]) as { props: { className?: string; children: string } }[];
    const highlightedTexts = result.filter((p) => p.props?.className?.includes("decoration-amber")).map((p) => p.props.children);
    expect(highlightedTexts).toEqual(["shorter"]);
  });
});

describe("MirrorReflectionView — Try again disabled after one use, edit-in-place", () => {
  it("Try again is enabled when canTryAgain is true", () => {
    const view = MirrorReflectionView({
      phase: "ready",
      paragraphs: PARAGRAPHS,
      quotedPhrases: [],
      draftParagraphs: PARAGRAPHS,
      canTryAgain: true,
      error: null,
      onAccept: noop,
      onEditStart: noop,
      onEditChange: noop,
      onRegenerate: noop,
    });
    const actionsRow = view.props.children[view.props.children.length - 1];
    const [, , tryAgainButton] = actionsRow.props.children;
    expect(tryAgainButton.props.disabled).toBe(false);
  });

  it("Try again is disabled (non-functional) once canTryAgain is false", () => {
    const view = MirrorReflectionView({
      phase: "ready",
      paragraphs: PARAGRAPHS,
      quotedPhrases: [],
      draftParagraphs: PARAGRAPHS,
      canTryAgain: false,
      error: null,
      onAccept: noop,
      onEditStart: noop,
      onEditChange: noop,
      onRegenerate: noop,
    });
    const actionsRow = view.props.children[view.props.children.length - 1];
    const [, , tryAgainButton] = actionsRow.props.children;
    expect(tryAgainButton.props.disabled).toBe(true);
  });

  it("editing phase swaps each paragraph into a TextArea bound to the draft, hides Edit it", () => {
    const draft: [string, string] = ["draft one", "draft two"];
    const view = MirrorReflectionView({
      phase: "editing",
      paragraphs: PARAGRAPHS,
      quotedPhrases: [],
      draftParagraphs: draft,
      canTryAgain: true,
      error: null,
      onAccept: noop,
      onEditStart: noop,
      onEditChange: noop,
      onRegenerate: noop,
    });
    const paragraphList = view.props.children[1];
    const wrappers = paragraphList.props.children as { props: { children: { type: string; props: { value: string } } } }[];
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0].props.children.props.value).toBe("draft one");
    expect(wrappers[1].props.children.props.value).toBe("draft two");

    const actionsRow = view.props.children[view.props.children.length - 1];
    // "Edit it" is omitted while already editing — its slot renders falsy.
    const [, editSlot] = actionsRow.props.children;
    expect(editSlot).toBeFalsy();
  });

  it("ready phase renders the accepted paragraphs as plain highlighted text, not textareas", () => {
    const view = MirrorReflectionView({
      phase: "ready",
      paragraphs: PARAGRAPHS,
      quotedPhrases: [],
      draftParagraphs: PARAGRAPHS,
      canTryAgain: true,
      error: null,
      onAccept: noop,
      onEditStart: noop,
      onEditChange: noop,
      onRegenerate: noop,
    });
    const paragraphList = view.props.children[1];
    const wrappers = paragraphList.props.children as { props: { children: { type: string } } }[];
    expect(wrappers[0].props.children.type).toBe("p");
  });
});
