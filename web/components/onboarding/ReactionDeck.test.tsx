import { describe, expect, it, vi } from "vitest";
import {
  fetchReactionPostings,
  initialReactionDeckState,
  reactionDeckReducer,
  ReactionCardView,
  submitReaction,
  WhyChipRowView,
  WHY_CHIPS,
  WHY_FREE_TEXT_MAX,
  type PostingSummary,
} from "./ReactionDeck";

const POSTINGS: PostingSummary[] = [
  { id: "p1", title: "Staff Engineer", company: "Acme", location: "Atlanta, GA" },
  { id: "p2", title: "Senior SRE", company: "Globex", location: "Remote" },
  { id: "p3", title: "Backend Lead", company: "Initech", location: "Remote" },
];

function fakeResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("reactionDeckReducer", () => {
  it("postings_loaded lands on the card phase with the sampled postings", () => {
    const state = reactionDeckReducer(initialReactionDeckState, { type: "postings_loaded", postings: POSTINGS });
    expect(state.phase).toBe("card");
    expect(state.postings).toEqual(POSTINGS);
    expect(state.index).toBe(0);
  });

  it("postings_loaded with an empty list finishes immediately (nothing left to react to)", () => {
    const state = reactionDeckReducer(initialReactionDeckState, { type: "postings_loaded", postings: [] });
    expect(state.phase).toBe("finished");
  });

  it("choice_made moves to the why phase and clears any stale note", () => {
    const loaded = reactionDeckReducer(initialReactionDeckState, { type: "postings_loaded", postings: POSTINGS });
    const state = reactionDeckReducer({ ...loaded, note: "stale" }, { type: "choice_made", reaction: "interested" });
    expect(state.phase).toBe("why");
    expect(state.pendingReaction).toBe("interested");
    expect(state.note).toBe("");
  });

  it("note_changed truncates to the 24-char max", () => {
    const state = reactionDeckReducer(initialReactionDeckState, {
      type: "note_changed",
      note: "a".repeat(WHY_FREE_TEXT_MAX + 10),
    });
    expect(state.note).toHaveLength(WHY_FREE_TEXT_MAX);
  });

  it("submit_succeeded then card_advanced moves to the next card when not yet complete", () => {
    let state = reactionDeckReducer(initialReactionDeckState, { type: "postings_loaded", postings: POSTINGS });
    state = reactionDeckReducer(state, { type: "choice_made", reaction: "interested" });
    state = reactionDeckReducer(state, { type: "submit_started" });
    state = reactionDeckReducer(state, { type: "submit_succeeded", reactionCount: 1, complete: false });
    state = reactionDeckReducer(state, { type: "card_advanced" });
    expect(state.index).toBe(1);
    expect(state.phase).toBe("card");
    expect(state.pendingReaction).toBeNull();
  });

  it("self-completes at the server's reported threshold: card_advanced finishes the deck early, even with cards left", () => {
    let state = reactionDeckReducer(initialReactionDeckState, { type: "postings_loaded", postings: POSTINGS });
    state = reactionDeckReducer(state, { type: "choice_made", reaction: "interested" });
    state = reactionDeckReducer(state, { type: "submit_succeeded", reactionCount: 6, complete: true });
    state = reactionDeckReducer(state, { type: "card_advanced" });
    expect(state.phase).toBe("finished");
    expect(state.index).toBe(0); // never advanced past the completing card
  });

  it("card_advanced past the last posting finishes the deck", () => {
    let state = reactionDeckReducer(initialReactionDeckState, { type: "postings_loaded", postings: POSTINGS });
    state = { ...state, index: POSTINGS.length - 1 };
    state = reactionDeckReducer(state, { type: "card_advanced" });
    expect(state.phase).toBe("finished");
  });

  it("submit_failed returns to the why phase without losing the pending choice", () => {
    let state = reactionDeckReducer(initialReactionDeckState, { type: "postings_loaded", postings: POSTINGS });
    state = reactionDeckReducer(state, { type: "choice_made", reaction: "not_interested" });
    state = reactionDeckReducer(state, { type: "submit_started" });
    state = reactionDeckReducer(state, { type: "submit_failed", error: "network down" });
    expect(state.phase).toBe("why");
    expect(state.pendingReaction).toBe("not_interested");
    expect(state.error).toBe("network down");
  });

  it("undo steps back one card and clears the pending choice (POST upsert makes changed minds free)", () => {
    let state = reactionDeckReducer(initialReactionDeckState, { type: "postings_loaded", postings: POSTINGS });
    state = { ...state, index: 2 };
    state = reactionDeckReducer(state, { type: "undo" });
    expect(state.index).toBe(1);
    expect(state.phase).toBe("card");
  });

  it("undo at index 0 is a no-op", () => {
    const loaded = reactionDeckReducer(initialReactionDeckState, { type: "postings_loaded", postings: POSTINGS });
    const state = reactionDeckReducer(loaded, { type: "undo" });
    expect(state.index).toBe(0);
  });
});

describe("fetchReactionPostings / submitReaction", () => {
  it("GETs the reactions module route and returns its postings", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ postings: POSTINGS }));
    const postings = await fetchReactionPostings(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/api/onboarding/modules/reactions");
    expect(postings).toEqual(POSTINGS);
  });

  it("POSTs posting_id, reaction, and note when present", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ ok: true, reaction_count: 3, complete: false }));
    await submitReaction("p1", "interested", "comp", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/reactions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ posting_id: "p1", reaction: "interested", note: "comp" }),
      })
    );
  });

  it("omits note entirely when empty (optional field)", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ ok: true, reaction_count: 1, complete: false }));
    await submitReaction("p1", "not_interested", "", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/onboarding/modules/reactions",
      expect.objectContaining({ body: JSON.stringify({ posting_id: "p1", reaction: "not_interested" }) })
    );
  });
});

describe("ReactionCardView — rendered tree", () => {
  it("renders the current card's title/company/location and progress", () => {
    const view = ReactionCardView({
      posting: POSTINGS[0],
      nextPosting: POSTINGS[1],
      position: 1,
      total: 3,
      canUndo: false,
      onPass: vi.fn(),
      onInterested: vi.fn(),
      onUndo: vi.fn(),
    });
    const [progressRow, deck, actions] = view.props.children;
    const progressLabel = progressRow.props.children[1];
    expect(progressLabel.props.children).toEqual([1, " of ", 3]);

    // next card peeks behind the current one
    const [peekWrapper, currentWrapper] = deck.props.children;
    expect(peekWrapper.props.className).toContain("opacity-60");
    const currentCard = currentWrapper.props.children;
    expect(currentCard.props.children[0].props.children).toBe("Staff Engineer");

    const [passBtn, interestedBtn] = actions.props.children;
    expect(passBtn.props.variant).toBe("ghost");
    expect(interestedBtn.props.variant).toBe("primary");
  });

  it("hides the back-arrow when canUndo is false, shows it when true", () => {
    const withoutUndo = ReactionCardView({
      posting: POSTINGS[0],
      nextPosting: undefined,
      position: 1,
      total: 3,
      canUndo: false,
      onPass: vi.fn(),
      onInterested: vi.fn(),
      onUndo: vi.fn(),
    });
    const [progressRowA] = withoutUndo.props.children;
    expect(progressRowA.props.children[0].type).toBe("span");

    const withUndo = ReactionCardView({
      posting: POSTINGS[1],
      nextPosting: undefined,
      position: 2,
      total: 3,
      canUndo: true,
      onPass: vi.fn(),
      onInterested: vi.fn(),
      onUndo: vi.fn(),
    });
    const [progressRowB] = withUndo.props.children;
    expect(progressRowB.props.children[0].type).toBe("button");
  });
});

describe("WhyChipRowView — rendered tree", () => {
  it("renders all six canned chips plus the free-text field", () => {
    const view = WhyChipRowView({ note: "", onChipSelect: vi.fn(), onNoteChange: vi.fn(), onSubmitNow: vi.fn() });
    const [chipRow, input] = view.props.children;
    const chipLabels = chipRow.props.children.map((c: { props: { children: string } }) => c.props.children);
    expect(chipLabels).toEqual([...WHY_CHIPS]);
    expect(input.props.maxLength).toBe(WHY_FREE_TEXT_MAX);
  });

  it("clicking a chip calls onChipSelect with that chip", () => {
    const onChipSelect = vi.fn();
    const view = WhyChipRowView({ note: "", onChipSelect, onNoteChange: vi.fn(), onSubmitNow: vi.fn() });
    const [chipRow] = view.props.children;
    chipRow.props.children[0].props.onClick();
    expect(onChipSelect).toHaveBeenCalledWith("comp");
  });
});
