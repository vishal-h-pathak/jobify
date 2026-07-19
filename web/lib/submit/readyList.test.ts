import { describe, expect, it } from "vitest";
import { buildReadyList } from "./readyList";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Minimal fake of supabase-js's chainable, thenable query builder — mirrors
 * `web/lib/db/matches.test.ts`'s `fakeSupabase` pattern, scoped to the
 * `.from/.select/.eq/.order` chain `buildReadyList` actually calls.
 */
function fakeSupabase(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "returns"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return { from: () => chain } as unknown as SupabaseClient<Database>;
}

function row(overrides: {
  posting_id: string;
  created_at: string;
  postings: { id: string; title: string | null; company: string | null; application_url: string | null } | null;
}) {
  return overrides;
}

describe("buildReadyList", () => {
  it("maps rows to the ReadyPosting shape", async () => {
    const supabase = fakeSupabase({
      data: [
        row({
          posting_id: "posting-1",
          created_at: "2026-07-19T00:00:00Z",
          postings: { id: "posting-1", title: "Engineer", company: "Acme", application_url: "https://acme.example/apply" },
        }),
      ],
      error: null,
    });

    const result = await buildReadyList(supabase, "user-1");

    expect(result).toEqual([
      { posting_id: "posting-1", title: "Engineer", company: "Acme", application_url: "https://acme.example/apply" },
    ]);
  });

  it("dedupes to the newest row per posting_id when multiple succeeded runs exist for the same posting", async () => {
    // Rows arrive newest-first (order by created_at desc); the second
    // occurrence of posting-1 (an older, superseded run) should be dropped.
    const supabase = fakeSupabase({
      data: [
        row({
          posting_id: "posting-1",
          created_at: "2026-07-19T00:00:00Z",
          postings: { id: "posting-1", title: "Newest Title", company: "Acme", application_url: "https://acme.example/apply" },
        }),
        row({
          posting_id: "posting-1",
          created_at: "2026-07-01T00:00:00Z",
          postings: { id: "posting-1", title: "Older Title", company: "Acme", application_url: "https://acme.example/apply" },
        }),
        row({
          posting_id: "posting-2",
          created_at: "2026-07-10T00:00:00Z",
          postings: { id: "posting-2", title: "Other Role", company: "Globex", application_url: "https://globex.example/apply" },
        }),
      ],
      error: null,
    });

    const result = await buildReadyList(supabase, "user-1");

    expect(result).toEqual([
      { posting_id: "posting-1", title: "Newest Title", company: "Acme", application_url: "https://acme.example/apply" },
      { posting_id: "posting-2", title: "Other Role", company: "Globex", application_url: "https://globex.example/apply" },
    ]);
  });

  it("returns [] when no rows", async () => {
    const supabase = fakeSupabase({ data: [], error: null });
    const result = await buildReadyList(supabase, "user-1");
    expect(result).toEqual([]);
  });

  it("returns [] when data is null", async () => {
    const supabase = fakeSupabase({ data: null, error: null });
    const result = await buildReadyList(supabase, "user-1");
    expect(result).toEqual([]);
  });

  it("propagates the Supabase error if the query errors", async () => {
    const supabase = fakeSupabase({ data: null, error: new Error("boom") });
    await expect(buildReadyList(supabase, "user-1")).rejects.toThrow("boom");
  });

  it("skips defensively (rather than throwing) if a row's postings join comes back null", async () => {
    const supabase = fakeSupabase({
      data: [row({ posting_id: "posting-1", created_at: "2026-07-19T00:00:00Z", postings: null })],
      error: null,
    });
    const result = await buildReadyList(supabase, "user-1");
    expect(result).toEqual([]);
  });
});
