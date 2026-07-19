import type { AuthState } from "../auth/handoff";
import { matchByHostname, type ReadyPosting } from "../ready/readyList";

export type PanelView =
  | { kind: "signed_out" }
  | { kind: "loading" } // signed in, ready list not fetched yet
  | { kind: "ready_list"; postings: ReadyPosting[]; highlighted: ReadyPosting[] } // highlighted = active-tab auto-match(es)
  | { kind: "selected"; posting: ReadyPosting };

/**
 * Pure view derivation for the panel's top-level state (build step 4's
 * signed-out / ready-list / selected states) — everything here is a
 * snapshot of already-known state, no I/O. `panel.ts` re-derives this
 * whenever any input changes (auth broadcast, ready list refetch, active
 * tab change, user pick) and re-renders.
 */
export function derivePanelView(
  authState: AuthState,
  readyList: ReadyPosting[] | null,
  activeTabUrl: string,
  selectedPostingId: string | null
): PanelView {
  // "refreshing" still carries a valid last-known session — don't flash the
  // signed-out CTA during a background token refresh.
  if (authState.kind !== "signed_in" && authState.kind !== "refreshing") return { kind: "signed_out" };
  if (readyList === null) return { kind: "loading" };

  if (selectedPostingId) {
    const posting = readyList.find((p) => p.posting_id === selectedPostingId);
    if (posting) return { kind: "selected", posting };
  }

  const match = matchByHostname(readyList, activeTabUrl);
  const highlighted = match.kind === "match" ? [match.posting] : match.kind === "multi_match" ? match.postings : [];
  return { kind: "ready_list", postings: readyList, highlighted };
}
