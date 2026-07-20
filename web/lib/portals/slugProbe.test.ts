import { describe, expect, it, vi } from "vitest";
import { generateSlugCandidates, probeCompanySlug } from "./slugProbe";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("generateSlugCandidates", () => {
  it("produces hyphenated, concatenated, and first-word variants for a multi-word name", () => {
    expect(generateSlugCandidates("Acme Corp")).toEqual([
      { slug: "acme-corp", kind: "hyphenated" },
      { slug: "acmecorp", kind: "concatenated" },
      { slug: "acme", kind: "first-word" },
    ]);
  });

  it("strips punctuation before slugifying", () => {
    expect(generateSlugCandidates("Acme, Corp.")).toEqual([
      { slug: "acme-corp", kind: "hyphenated" },
      { slug: "acmecorp", kind: "concatenated" },
      { slug: "acme", kind: "first-word" },
    ]);
  });

  it("collapses to a single candidate for a single-word name", () => {
    expect(generateSlugCandidates("Stripe")).toEqual([{ slug: "stripe", kind: "hyphenated" }]);
  });

  it("returns no candidates for an empty name", () => {
    expect(generateSlugCandidates("   ")).toEqual([]);
  });
});

describe("probeCompanySlug", () => {
  it("returns a high-confidence Greenhouse hit when the exact slug has live postings", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("boards-api.greenhouse.io/v1/boards/acme-corp/jobs")) {
        return jsonResponse({ jobs: [{ id: 1 }, { id: 2 }] });
      }
      return jsonResponse({}, 404);
    });

    const result = await probeCompanySlug("Acme Corp", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.ats).toBe("greenhouse");
      expect(result.slug).toBe("acme-corp");
      expect(result.livePostingCount).toBe(2);
      // no independent metadata on this endpoint -> discounted slug-implied confidence
      expect(result.confidence).toBeCloseTo(0.9, 5);
    }
  });

  it("trusts Ashby's organizationName as authoritative and yields full confidence on an exact match", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("api.ashbyhq.com/posting-api/job-board/acme")) {
        return jsonResponse({ organizationName: "Acme Corp", jobs: [{ id: 1 }] });
      }
      return jsonResponse({}, 404);
    });

    const result = await probeCompanySlug("Acme Corp", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.ats).toBe("ashby");
      expect(result.confidence).toBe(1);
    }
  });

  it("penalizes an impostor board whose Ashby metadata name doesn't match", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("api.ashbyhq.com/posting-api/job-board/acme")) {
        return jsonResponse({ organizationName: "Acme Trucking Inc", jobs: [{ id: 1 }] });
      }
      return jsonResponse({}, 404);
    });

    const result = await probeCompanySlug("Acme Corp", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.found).toBe(true);
    if (result.found) {
      // "acme corp" vs "acme trucking inc": 1 shared token / 3 max tokens
      expect(result.confidence).toBeCloseTo(1 / 3, 2);
    }
  });

  it("parses Lever's bare-array response shape", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      if (String(url).includes("api.lever.co/v0/postings/acme-corp")) {
        return jsonResponse([{ id: "a" }, { id: "b" }, { id: "c" }]);
      }
      return jsonResponse({}, 404);
    });

    const result = await probeCompanySlug("Acme Corp", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.ats).toBe("lever");
      expect(result.livePostingCount).toBe(3);
    }
  });

  it("returns not_found with a reason when every ATS 404s", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404));

    const result = await probeCompanySlug("Nonexistent Startup", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toBeTruthy();
    }
  });

  it("degrades to not_found instead of throwing on network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(
      probeCompanySlug("Acme Corp", { fetchImpl: fetchImpl as unknown as typeof fetch })
    ).resolves.toEqual({ found: false, reason: expect.any(String) });
  });

  it("never exceeds the configured concurrency cap", async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return jsonResponse({}, 404);
    });

    await probeCompanySlug("Acme Corp", { fetchImpl: fetchImpl as unknown as typeof fetch, maxConcurrent: 3 });

    expect(maxObserved).toBeLessThanOrEqual(3);
  });

  it("returns not_found for an empty company name without probing", async () => {
    const fetchImpl = vi.fn();

    const result = await probeCompanySlug("   ", { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result).toEqual({ found: false, reason: "empty company name" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.SLUG_PROBE_LIVE)("probeCompanySlug (live smoke test)", () => {
  it("probes a real company against live ATS APIs", async () => {
    const result = await probeCompanySlug("Stripe");
    expect(typeof result.found).toBe("boolean");
    if (result.found) {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});
