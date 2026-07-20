/**
 * Given a company name, probes Greenhouse/Ashby/Lever public job-board APIs
 * for a matching ATS slug. Zero-LLM: candidate slugs are generated
 * deterministically and confidence comes from comparing the requested name
 * against each ATS's own board metadata where the endpoint exposes one
 * (Ashby's `organizationName`); Greenhouse's `/jobs` endpoint and Lever's
 * postings endpoint don't expose a company-name field, so their confidence
 * falls back to a token-overlap proxy against the candidate slug itself,
 * discounted for being unverified against independent metadata.
 */

export type SlugProbeAts = "greenhouse" | "ashby" | "lever";

const ATS_ORDER: SlugProbeAts[] = ["greenhouse", "ashby", "lever"];

export interface SlugProbeHit {
  found: true;
  ats: SlugProbeAts;
  slug: string;
  confidence: number;
  livePostingCount: number;
}

export interface SlugProbeMiss {
  found: false;
  reason: string;
}

export type SlugProbeResult = SlugProbeHit | SlugProbeMiss;

export interface SlugCandidate {
  slug: string;
  kind: "hyphenated" | "concatenated" | "first-word";
}

function normalizeWords(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

export function generateSlugCandidates(companyName: string): SlugCandidate[] {
  const words = normalizeWords(companyName);
  if (!words.length) return [];
  const candidates: SlugCandidate[] = [{ slug: words.join("-"), kind: "hyphenated" }];
  const concatenated = words.join("");
  if (concatenated !== candidates[0].slug) {
    candidates.push({ slug: concatenated, kind: "concatenated" });
  }
  if (words.length > 1 && !candidates.some((c) => c.slug === words[0])) {
    candidates.push({ slug: words[0], kind: "first-word" });
  }
  return candidates;
}

function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const overlap = a.filter((t) => setB.has(t)).length;
  return overlap / Math.max(a.length, b.length);
}

function buildUrl(ats: SlugProbeAts, slug: string): string {
  switch (ats) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
    case "lever":
      return `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  }
}

interface ParsedBoard {
  livePostingCount: number;
  metadataName?: string;
}

function parseBoard(ats: SlugProbeAts, body: unknown): ParsedBoard | null {
  if (ats === "lever") {
    return Array.isArray(body) ? { livePostingCount: body.length } : null;
  }
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const jobs = Array.isArray(obj.jobs) ? obj.jobs : null;
  if (!jobs) return null;
  if (ats === "ashby") {
    const metadataName = typeof obj.organizationName === "string" ? obj.organizationName : undefined;
    return { livePostingCount: jobs.length, metadataName };
  }
  return { livePostingCount: jobs.length };
}

async function probeOne(
  companyWords: string[],
  ats: SlugProbeAts,
  candidate: SlugCandidate,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<SlugProbeHit | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(buildUrl(ats, candidate.slug), { signal: controller.signal });
    if (!res.ok) return null;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return null;
    }
    const parsed = parseBoard(ats, body);
    if (!parsed) return null;
    const slugImplied = tokenOverlap(companyWords, normalizeWords(candidate.slug));
    const confidence = parsed.metadataName
      ? tokenOverlap(companyWords, normalizeWords(parsed.metadataName))
      : slugImplied * 0.9;
    return {
      found: true,
      ats,
      slug: candidate.slug,
      confidence: Math.round(confidence * 1000) / 1000,
      livePostingCount: parsed.livePostingCount,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export interface SlugProbeDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxConcurrent?: number;
}

export async function probeCompanySlug(companyName: string, deps: SlugProbeDeps = {}): Promise<SlugProbeResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 5000;
  const maxConcurrent = deps.maxConcurrent ?? 3;

  const companyWords = normalizeWords(companyName);
  const candidates = generateSlugCandidates(companyName);
  if (!candidates.length) {
    return { found: false, reason: "empty company name" };
  }

  const tasks: Array<() => Promise<SlugProbeHit | null>> = [];
  for (const ats of ATS_ORDER) {
    for (const candidate of candidates) {
      tasks.push(() => probeOne(companyWords, ats, candidate, fetchImpl, timeoutMs));
    }
  }

  const results = await runWithConcurrency(tasks, maxConcurrent);
  const hits = results.filter((r): r is SlugProbeHit => r !== null);
  if (!hits.length) {
    return { found: false, reason: "no matching board found on any ATS" };
  }

  hits.sort((a, b) => b.confidence - a.confidence);
  return hits[0];
}
