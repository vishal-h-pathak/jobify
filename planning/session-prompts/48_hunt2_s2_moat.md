# Session 48 — HUNT2-S2: port the moat, part 1  (worktree `feat/hunt2-s2`)

**Model: Sonnet.** The spec is `planning/HUNT2_SOURCES.md` §3.1-§3.3 — read it
FIRST, in full. Scope: slug probe/verify service, dream_companies→seed
plumbing, `board_catalog` + initial import + minimal tier packs. NOT in scope:
Lever/Workday fetchers, metadata retention (§3.4-3.5 = session S3), the
candidate queue (§4 = S4), P0 items (session 47, running in parallel — see
"collision avoidance" below).

## Constitutional rules (verbatim, non-negotiable)
1. `bash scripts/scrub_gate.sh` must PASS before your final commit. No
   operator strings. Fixtures/tests use the Alex Quinn persona.
2. Migration files are COMMITTED, never applied. You own
   `jobify/migrations/0015_board_catalog.sql`. Session 47 owns 0014 — do NOT
   create, edit, or depend on 0014. Write 0015 so it applies cleanly on top
   of 0013 regardless of whether 0014 exists yet (no references to 0014
   objects).
3. No LLM calls anywhere in this session's code paths (probing and seeding
   are zero-LLM by design). Board tags are assigned by heuristic/curation,
   not by model.
4. Per-user portals docs use the object format `- slug: x / name: Y` and must
   pass the existing jsonschema validation. Do not change the schema this
   session.
5. Commit on `feat/hunt2-s2` only. Do NOT push, do NOT merge, do NOT deploy.

## Collision avoidance (parallel with session 47)
Session 47 is editing: hunt fetchers, `hosted/discovery.py`, `hosted/fanout.py`,
the rubric compile path, and web `matches` read sites. You must NOT touch any
of those. Your surface: `web/lib/portals/**`, `web/lib/onboarding/buildDoc.ts`
(the dream_companies handoff ONLY — lines ~224-234 region), new files, 0015,
and `jobify/data/**`. If you believe you must edit a session-47 file, STOP and
flag it in your report instead.

## The work

### 1. Slug probe/verify service — TypeScript, `web/lib/portals/slugProbe.ts`
DELIBERATE DEVIATION from spec §3.1 (record it in your report): the spec says
python module + API route, but the only P1 consumer is onboarding-completion
seeding, which runs server-side in Next.js — so S2 implements the probe in TS;
S4 ports it to python when the candidate queue needs it.
- Given a company name: generate candidate slugs (lowercase; strip
  punctuation; hyphenated, concatenated, and first-word variants).
- Probe, in order: `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs`,
  `https://api.ashbyhq.com/posting-api/job-board/{slug}`,
  `https://api.lever.co/v0/postings/{slug}?mode=json`.
- Confidence = normalized-name match between requested company and the
  board's own metadata name (this is job-pipeline's impostor check, promoted
  to a service). Return `{ats, slug, confidence, livePostingCount}` or
  `not_found`. Timeouts + polite concurrency (≤3 in flight); never throw on
  network errors — degrade to `not_found` with a reason.
- Tests: mock fetch (no live HTTP in vitest). One OPTIONAL live smoke test
  gated behind `SLUG_PROBE_LIVE=1`, excluded from the default run.

### 2. dream_companies → seed plumbing
- `web/lib/onboarding/buildDoc.ts` (~224-234): pass `dream_companies` through
  to the portals seed instead of dead-ending it.
- `web/lib/portals/portalsSeed.ts` (~58-66): replace the unconditional
  `companies: []` — seed = high-confidence dream-company probe hits + the
  user's tier pack (below). Probe failures/low-confidence go into a
  `couldnt_auto_find` list persisted alongside the doc (jsonb column on the
  portals row or adjacent — your call; no UI this session).
- Seeding must be MERGE-NOT-REPLACE: if a user already has companies in a
  section, union by slug (existing entries win). This protects the owner's
  16 hand-seeded boards.
- Admin reseed path: `web/scripts/reseedPortals.ts --user <uuid>` (service
  role, run manually) so the owner can apply the new seeding to his existing
  profile without redoing onboarding.

### 3. `board_catalog` — migration 0015 + seed data + import
- `0015_board_catalog.sql`: table `board_catalog(id uuid pk default
  gen_random_uuid(), ats text not null check (ats in
  ('greenhouse','ashby','lever','workday')), slug text not null, company_name
  text not null, tags text[] not null default '{}', status text not null
  default 'active', added_by text not null default 'import', verified_at
  timestamptz, unique(ats, slug))`. RLS enabled: authenticated SELECT,
  service-role ALL.
- Seed data file `jobify/data/board_catalog_seed.yml`. Source: read EXACTLY
  ONE file from the owner's sibling repo —
  `~/dev/jarvis/job-pipeline/jobpipe/hunt/profile/portals.yml` — and copy
  ONLY the ats/slug/name triples (the 51 verified boards: 19 Greenhouse,
  32 Ashby). Do not read anything else in that repo; do not copy title
  filters or any other content from it.
- Tag each board at import with coarse tags from your own knowledge of the
  company (choose from: `infra`, `devtools`, `product`, `fintech`, `data-ai`,
  `enterprise`, `growth-startup`, `big-tech-adjacent`, `remote-first`).
  Judgment calls are fine; note uncertain ones in the report.
- Import script `web/scripts/importBoardCatalog.ts` (service role, idempotent
  upsert on `(ats, slug)`), reading the YAML. Committed but NOT run — the
  cockpit runs it after 0015 is applied live.

### 4. Minimal tier packs — `web/lib/portals/tierPacks.ts`
Map a user's targeting (tier titles/keywords + remote acceptance) to catalog
tag queries via a documented keyword heuristic (e.g. infra/platform/SRE
keywords → `infra ∪ devtools`; remote-required → intersect `remote-first`).
Pack = up to **40** catalog boards, merged into the seed (dream hits first,
pack fills remainder). Pure function + unit tests against fixture profiles;
no LLM.

## Verification (all must pass)
`cd web && npx tsc --noEmit && npx vitest run && npm run build`; `pytest` at
root only if you touched python (you shouldn't need to); `bash
scripts/scrub_gate.sh`. Budget: aim ≤~600 changed lines excluding tests and
the seed YAML.

## Report format
Per-workstream (probe / plumbing / catalog / packs): done/partial + files +
test names. Then: 0015 DDL verbatim, seed-file stats (boards per ATS, tag
distribution), the recorded TS-not-python deviation, suite results verbatim,
scrub result, and any judgment calls (tags, couldnt_auto_find storage shape).
Do not begin until the owner confirms.
