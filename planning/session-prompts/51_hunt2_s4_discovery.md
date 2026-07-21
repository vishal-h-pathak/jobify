# Session 51 — HUNT2-S4: the discovery loop  (worktree `feat/hunt2-s4`)

**Model: Sonnet.** Spec: `planning/HUNT2_SOURCES.md` §4.1-§4.2 — read it
first. This is the leapfrog session: the mechanism by which companies NOBODY
hand-added enter the system. Wave A is merged (matches funnel statuses exist,
board_catalog exists with 51 rows live, TS slug probe exists at
`web/lib/portals/slugProbe.ts`, admin panel exists with isAdmin/requireAdmin).

## Constitutional rules (non-negotiable)
1. `bash scripts/scrub_gate.sh` must PASS. No operator strings; Alex Quinn
   persona in fixtures.
2. You own `jobify/migrations/0017_candidate_boards.sql` — committed, never
   applied. Session 50 (parallel) owns 0016 — do not create or reference it;
   write 0017 to apply cleanly on 0015 (no dependence on 0016 columns).
3. Everything in this session is ZERO-LLM. Tagging of admitted boards is
   heuristic (dominant title/department keywords in the board's own
   postings), never a model call.
4. Commit on `feat/hunt2-s4` only; no push, no merge.

## Collision avoidance (session 50 runs in parallel)
YOURS: new modules `jobify/hunt/sources/slug_probe.py`,
`jobify/hosted/candidates.py` (+ feeder submodules), `jobify/hosted/worker.py`
(adding the post-discovery candidates step), migration 0017, admin candidates
UI (`web/app/**/admin/**`, `web/lib/admin/**`), new API routes under
`/api/admin/`.
NOT YOURS (session 50's): any existing fetcher in `jobify/hunt/sources/`
(greenhouse/ashby/lever/workday/serpapi/jsearch/etc.), `jobify/hosted/discovery.py`,
`jobify/hosted/fanout.py`, the portals jsonschema, `board_catalog_seed.yml`.
Consequences you must design around, not code around:
- The unknown-company routing feeder must NOT hook into fanout inline —
  implement it as a post-pass reading the tables fanout already writes
  (matches rows where status != 'rejected_title' identify title-filter
  survivors; join postings for source/company).
- The SerpAPI dork feeder must NOT edit `serpapi.py` — make the HTTP calls
  from your own module (reuse shared HTTP helpers read-only).

## The work

### 1. Migration 0017 — the candidate queue
`candidate_boards`: id uuid pk, `company_name text not null`,
`normalized_name text not null` (lowercased, punctuation-stripped — dedup
key), `evidence_kind text not null` (check in
('hn_thread','aggregator_match','serpapi_dork','relocation','manual')),
`evidence_url text`, `proposed_ats text`, `proposed_slug text`,
`probe_result jsonb`, `status text not null default 'pending'` (check in
('pending','auto_admitted','approved','rejected')), `reject_reason text`,
`created_at/decided_at timestamptz`, UNIQUE(normalized_name). RLS: service
ALL; no user-facing reads (admin routes use service role server-side).
A REJECTED candidate is never re-proposed — enqueue logic must check the
queue (any status) before inserting. This is the multi-user Skipped ledger.

### 2. Python slug probe — `jobify/hunt/sources/slug_probe.py`
Port of the TS probe (read `web/lib/portals/slugProbe.ts` for the variant
rules), with one REQUIRED improvement over it: for Greenhouse, use the board
metadata endpoint `https://boards-api.greenhouse.io/v1/boards/{slug}` (no
/jobs) which returns the board's authoritative `name` — the TS version falls
back to slug-token overlap for Greenhouse; python should not (cockpit review
note from S2). Ashby: `organizationName` from the posting-api response.
Lever: token-overlap proxy stands (no metadata endpoint). Zero LLM, polite
concurrency, never-throw (degrade to not_found with reason). Mocked tests +
env-gated live smoke.

### 3. Candidates engine — `jobify/hosted/candidates.py`
- `enqueue(company_name, evidence)` — normalize, dedup vs queue (all
  statuses) AND vs board_catalog (by probed ats+slug and by normalized
  company name), insert pending.
- On enqueue (or a batched pass), run the slug probe and store probe_result.
- Auto-admit: probe confidence high (metadata name match) AND
  live_posting_count > 0 → insert into board_catalog
  (added_by='discovery', verified_at=now, status='active') + mark
  'auto_admitted'. Auto-tagging: fetch the board's postings once (the probe
  already did) and derive tags from dominant title keywords via a documented
  keyword→tag map (reuse the vocabulary; no LLM). Ambiguous probes stay
  'pending' for human review.
- Volume rails: cap enqueues per cycle (e.g. 100) and auto-admits per cycle
  (e.g. 25); log drops loudly.

### 4. Three feeders (each small, all called from worker.py as a
post-discovery step — clearly separated from discovery proper)
a. **HN extraction**: from the HN Who-is-hiring source's already-fetched
   comments, extract company names + embedded ATS links
   (greenhouse/lever/ashby URLs parse straight to slugs → highest
   confidence). Enqueue with the comment URL as evidence.
b. **Aggregator-unknown routing**: post-pass over the latest cycle's matches
   (status != 'rejected_title') joined to postings where source is an
   aggregator (remoteok/wwr/remotive/serpapi/jsearch) and the company
   resolves to nothing in board_catalog → enqueue with the posting URL as
   evidence. This is the highest-precision feeder — a real user's filter
   liked a job at a company we don't track.
c. **SerpAPI dorks**: from your own module, queries like
   `site:boards.greenhouse.io "<title kw>"` / `site:jobs.lever.co ...` /
   `site:jobs.ashbyhq.com ...`, title keywords drawn from the union of
   active users' portals title_filter prefer_substrings (read-only). Slugs
   parse directly from result URLs → enqueue. Budget: cap at ~20% of the
   SerpAPI call budget per cycle; skip cleanly when no SERPAPI_KEY.

### 5. Admin candidates UI
A "Candidate boards" card on the existing admin page: pending list
(company, evidence link, probe result summary) with one-click
Approve (→ board_catalog + status 'approved') / Reject (reason text →
status 'rejected'); recent auto-admits listed read-only. Routes under
`/api/admin/candidates*`, gated with the existing requireAdmin, 404 for
non-admin (house rule). Server-validates everything; no client trust.

## Verification
`.venv/bin/pytest` (or `python3 -m pytest`); `cd web && npx tsc --noEmit &&
npx vitest run && npm run build`; scrub gate. Aim ≤~700 non-test lines.

## Report format
Per-workstream status + files + tests; 0017 DDL verbatim; feeder rails
(caps) as implemented; the auto-admit criteria exactly as coded; judgment
calls. Do not begin until the owner confirms.
