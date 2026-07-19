// `GET /api/submit/ready` (web/app/api/submit/ready/route.ts, additive, this
// session's other half) returns the user's succeeded tailor runs newest
// first. That route — like `/api/submit/packet`, which this package also
// calls (fill-flow.ts) — authenticates via `createSupabaseServerClient()`,
// i.e. session cookies, not a bearer token; it is off-limits for this
// package to modify ("other api routes" is out of scope). The extension's
// manifest grants `host_permissions` for the app origin only, which is
// exactly what lets a `credentials: "include"` fetch from the background
// worker or a content script carry the app's existing session cookie the
// same way a same-origin request would — so these calls ride the ambient
// browser session rather than an Authorization header. The handoff/refresh
// state machine (auth/handoff.ts) still matters independently: it's the
// extension's own signal for "is someone signed in" (a service worker can't
// read an httpOnly cookie to find out), used to drive the panel's
// signed-out-vs-ready-list state without a network round trip.
export type ReadyPosting = {
  posting_id: string;
  title: string;
  company: string;
  application_url: string;
};

export interface ReadyListDeps {
  fetchImpl: typeof fetch;
  appOrigin: string; // e.g. "https://jobify-swart.vercel.app", no trailing slash
}

export class ReadyListFetchError extends Error {
  constructor(public readonly status: number) {
    super(`GET /api/submit/ready failed with status ${status}`);
  }
}

export async function fetchReadyList(deps: ReadyListDeps): Promise<ReadyPosting[]> {
  const res = await deps.fetchImpl(`${deps.appOrigin}/api/submit/ready`, { credentials: "include" });
  if (!res.ok) throw new ReadyListFetchError(res.status);
  return (await res.json()) as ReadyPosting[];
}

export type ReadyMatch =
  | { kind: "none" }
  | { kind: "match"; posting: ReadyPosting }
  | { kind: "multi_match"; postings: ReadyPosting[] };

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Auto-selects a ready posting by matching the active tab's hostname
 * against each posting's `application_url` hostname. Zero matches -> none
 * (manual pick from the full list); exactly one -> match (auto-select);
 * more than one (e.g. two postings both on the same ATS's shared apply
 * domain) -> multi_match, which the panel renders as a manual-pick list
 * scoped to just those candidates.
 */
export function matchByHostname(postings: ReadyPosting[], activeTabUrl: string): ReadyMatch {
  const activeHost = hostnameOf(activeTabUrl);
  if (!activeHost) return { kind: "none" };

  const matches = postings.filter((p) => hostnameOf(p.application_url) === activeHost);
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "match", posting: matches[0] };
  return { kind: "multi_match", postings: matches };
}
