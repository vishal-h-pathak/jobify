# Session 50 — HUNT2-S3: fetcher fleet + metadata retention  (worktree `feat/hunt2-s3`)

**Model: Sonnet.** Spec: `planning/HUNT2_SOURCES.md` §3.4-§3.5 — read it first,
plus §2 to understand what wave A already landed (P0 is merged: fetchers are
location-agnostic, remote tri-state exists, matches carries
status/reject_reason/location_tier). Scope: Lever wiring, Workday CXS
fetcher, metadata retention + two pre-LLM filters, catalog curation to 150+.

## Constitutional rules (non-negotiable)
1. `bash scripts/scrub_gate.sh` must PASS. No operator strings; Alex Quinn
   persona in fixtures.
2. You own `jobify/migrations/0016_posting_metadata.sql` — committed, never
   applied. Session 51 (parallel) owns 0017 — do not create or reference it.
   Write 0016 to apply cleanly on 0015.
3. No LLM calls. Discovery stays zero-LLM.
4. Commit on `feat/hunt2-s3` only; no push, no merge.

## Collision avoidance (session 51 runs in parallel)
YOURS: `jobify/hunt/sources/**` (fetchers), `jobify/hosted/discovery.py`,
`jobify/hosted/fanout.py`, migration 0016, `jobify/data/board_catalog_seed.yml`,
the portals jsonschema (onboarding validation) + its web mirror if one exists.
NOT YOURS (session 51's): `jobify/hosted/worker.py`, any new
`jobify/hosted/candidates*.py` / feeder modules, `jobify/hunt/sources/slug_probe.py`
(51 creates it), migration 0017, `web/app/**/admin/**`, `web/lib/admin/**`.
If you believe you must touch one of theirs, STOP and flag in your report.

## The work

### 1. Lever — finish the wiring
The Lever fetcher exists (P0 touched it). Verify end-to-end for hosted
discovery: a `lever:` section in a user's portals doc is read, fetched
(`api.lever.co/v0/postings/{slug}?mode=json`), remote-inferred, and pooled.
Fix whatever gaps exist (section iteration, dedup keys, tests with a mocked
Lever payload).

### 2. Workday CXS — new fetcher
- Endpoint pattern: `https://{tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`
  (POST, JSON, paginated). VERIFY the real request/response shape against
  2-3 live public tenants by actually fetching them (you have network) before
  generalizing — record which tenants you validated in the report.
- Portals schema: a Workday board needs `tenant / wd_instance / site`, not a
  bare slug. Extend the portals jsonschema with an optional structured
  `workday:` section (keep `companies: []` default valid so existing docs
  don't break), and update the golden example + any web-side schema mirror.
- Fetcher: polite pagination cap, remote inference via the shared helper,
  graceful degradation on tenant errors (log + skip, never crash the cycle).
- Tests: mocked payloads; one live smoke behind an env flag, excluded by
  default.

### 3. Metadata retention (0016) + two pre-LLM filters
- 0016: `postings` gains `raw jsonb`, `posted_at timestamptz`,
  `department text`, `employment_type text`, `comp_min numeric`,
  `comp_max numeric`, `comp_currency text` (all nullable; idempotent DDL).
- Every fetcher persists its full source payload into `raw` and extracts the
  first-class fields where its API provides them (Ashby publishes structured
  compensation — stop discarding it; Greenhouse/Lever/JSearch partially).
- Fanout ladder gains two cheap filters BEFORE the embed/LLM stages:
  comp floor (only when the user's profile states one AND the posting
  publishes comp) and max posting age (default generous, e.g. 60 days, only
  when `posted_at` is known). BOTH PASS ON NULL — absent data never
  disqualifies. Rejections write matches rows with status `rejected_rubric`
  and a reject_reason distinguishing them (`comp_below_floor`, `stale_posting`).
- Tests: extraction per fetcher; both filters' null-pass semantics; ladder
  ordering unchanged otherwise.

### 4. Catalog curation to 150+
Extend `jobify/data/board_catalog_seed.yml` from 51 to ≥150 boards, adding
Greenhouse/Ashby AND Lever AND Workday entries. Discipline (this is the
moat — job-pipeline's rules apply):
- VERIFY EVERY ADDED BOARD LIVE before including it: fetch the public API
  endpoint, confirm HTTP 200 + the metadata/company name matches. No
  unverified slugs. Note per-board verification in a `# verified: <date>`
  comment or report table.
- Spread coverage deliberately: keep the data-ai/infra depth but add real
  breadth — product SaaS, fintech, devtools, enterprise (Workday tenants
  especially: large employers with Atlanta-area or hybrid presence), and
  remote-first companies. Tag with the existing 9-tag vocabulary.
- Update `web/scripts/importBoardCatalog.ts` only if the YAML shape needs
  the workday fields; the cockpit re-runs the import after merge.

## Verification
`.venv/bin/pytest` (or `python3 -m pytest`); `cd web && npx tsc --noEmit &&
npx vitest run && npm run build` (schema mirror/type changes); scrub gate.
Aim ≤~700 non-test lines (the seed YAML doesn't count).

## Report format
Per-workstream status + files + tests; 0016 DDL verbatim; Workday tenants
validated live; catalog stats (boards per ATS, tag distribution, all-verified
confirmation); judgment calls. Do not begin until the owner confirms.
