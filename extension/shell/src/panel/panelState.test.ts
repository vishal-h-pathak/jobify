import { describe, expect, it } from "vitest";
import { derivePanelView } from "./panelState";
import type { ReadyPosting } from "../ready/readyList";

const gh1: ReadyPosting = { posting_id: "gh1", title: "Staff Eng", company: "Acme", application_url: "https://boards.greenhouse.io/acme/1" };
const gh2: ReadyPosting = { posting_id: "gh2", title: "Sr Eng", company: "Widget", application_url: "https://boards.greenhouse.io/widget/2" };
const lever: ReadyPosting = { posting_id: "lv1", title: "Eng", company: "Co", application_url: "https://jobs.lever.co/co/abc" };

describe("derivePanelView", () => {
  it("signed_out when not signed in, regardless of ready list", () => {
    expect(derivePanelView({ kind: "signed_out" }, [gh1], "https://boards.greenhouse.io/acme/1", null)).toEqual({ kind: "signed_out" });
  });

  it("loading when signed in but the ready list hasn't been fetched yet", () => {
    expect(derivePanelView({ kind: "signed_in", session: { access_token: "a", refresh_token: "r" } }, null, "https://x.com", null)).toEqual({
      kind: "loading",
    });
  });

  it("treats refreshing as still signed-in for view purposes (no flicker to signed-out)", () => {
    expect(
      derivePanelView({ kind: "refreshing", session: { access_token: "a", refresh_token: "r" } }, [gh1], "https://boards.greenhouse.io/acme/1", null)
    ).toEqual({ kind: "ready_list", postings: [gh1], highlighted: [gh1] });
  });

  const signedIn = { kind: "signed_in" as const, session: { access_token: "a", refresh_token: "r" } };

  it("ready_list with a single highlighted auto-match", () => {
    expect(derivePanelView(signedIn, [gh1, lever], "https://boards.greenhouse.io/acme/1", null)).toEqual({
      kind: "ready_list",
      postings: [gh1, lever],
      highlighted: [gh1],
    });
  });

  it("ready_list with multiple highlighted candidates when the hostname is ambiguous", () => {
    expect(derivePanelView(signedIn, [gh1, gh2], "https://boards.greenhouse.io/acme/1", null)).toEqual({
      kind: "ready_list",
      postings: [gh1, gh2],
      highlighted: [gh1, gh2],
    });
  });

  it("ready_list with no highlights when nothing matches the active tab", () => {
    expect(derivePanelView(signedIn, [gh1], "https://myworkdayjobs.com/foo", null)).toEqual({
      kind: "ready_list",
      postings: [gh1],
      highlighted: [],
    });
  });

  it("selected when selectedPostingId names a posting present in the ready list", () => {
    expect(derivePanelView(signedIn, [gh1, lever], "https://myworkdayjobs.com/foo", "lv1")).toEqual({ kind: "selected", posting: lever });
  });

  it("falls back to ready_list when selectedPostingId names a posting no longer in the list", () => {
    expect(derivePanelView(signedIn, [gh1], "https://boards.greenhouse.io/acme/1", "stale-id")).toEqual({
      kind: "ready_list",
      postings: [gh1],
      highlighted: [gh1],
    });
  });
});
