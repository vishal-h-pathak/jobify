import { describe, expect, it, vi } from "vitest";
import { fetchReadyList, matchByHostname, ReadyListFetchError, type ReadyPosting } from "./readyList";

function posting(overrides: Partial<ReadyPosting>): ReadyPosting {
  return {
    posting_id: "p1",
    title: "Staff Engineer",
    company: "Acme",
    application_url: "https://boards.greenhouse.io/acme/jobs/1",
    ...overrides,
  };
}

describe("fetchReadyList", () => {
  it("GETs /api/submit/ready with credentials included and returns the parsed list", async () => {
    const list = [posting({ posting_id: "p1" })];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(list), { status: 200 }));

    const result = await fetchReadyList({ fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" });

    expect(fetchImpl).toHaveBeenCalledWith("https://app.example.com/api/submit/ready", { credentials: "include" });
    expect(result).toEqual(list);
  });

  it("throws ReadyListFetchError with the status on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));

    await expect(
      fetchReadyList({ fetchImpl: fetchImpl as unknown as typeof fetch, appOrigin: "https://app.example.com" })
    ).rejects.toThrow(ReadyListFetchError);
  });
});

describe("matchByHostname", () => {
  const gh1 = posting({ posting_id: "gh1", application_url: "https://boards.greenhouse.io/acme/jobs/1" });
  const gh2 = posting({ posting_id: "gh2", application_url: "https://boards.greenhouse.io/other/jobs/2" });
  const lever = posting({ posting_id: "lv1", application_url: "https://jobs.lever.co/widgetco/abc" });

  it("returns match when exactly one posting shares the active tab's hostname", () => {
    expect(matchByHostname([gh1, lever], "https://jobs.lever.co/widgetco/abc")).toEqual({ kind: "match", posting: lever });
  });

  it("returns multi_match when more than one posting shares the hostname", () => {
    expect(matchByHostname([gh1, gh2, lever], "https://boards.greenhouse.io/acme/jobs/1")).toEqual({
      kind: "multi_match",
      postings: [gh1, gh2],
    });
  });

  it("returns none when no posting matches the active tab's hostname", () => {
    expect(matchByHostname([gh1, lever], "https://myworkdayjobs.com/foo")).toEqual({ kind: "none" });
  });

  it("returns none when the active tab URL is unparseable", () => {
    expect(matchByHostname([gh1], "not-a-url")).toEqual({ kind: "none" });
  });

  it("returns none for an empty ready list", () => {
    expect(matchByHostname([], "https://boards.greenhouse.io/acme/jobs/1")).toEqual({ kind: "none" });
  });
});
