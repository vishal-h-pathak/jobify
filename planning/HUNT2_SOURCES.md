# HUNT2: Source Expansion & Repair Plan

**Status:** planning · **Scope:** jobify discovery/sources layer · **Inputs:** Agent A (job-pipeline source inventory), Agent B (jobify source audit, file:line confirmed), Agent C (adversarial critique of job-pipeline), Agent D (synthesis — this document)

**Provenance:** produced 2026-07-20 by the four-agent source-analysis chain the owner requested after cycle 24 (371 pooled → 356 scored → 2 mediocre matches) while job-pipeline surfaced visibly better listings the same day. Key upstream verdicts: Agent A — "the moat is portals.yml, not the code — a curated watchlist wearing a job-search costume." Agent C — "a precision machine bolted to a recall dead-end… the fix is not more scoring — it is a company-discovery loop and per-source outcome telemetry."

---

## 1. Diagnosis

Yesterday's hunt (cycle 24: 371 pooled → 356 scored → 2 mediocre matches, $0.056) failed for three compounding reasons, in causal order:

**Location policy (owner directive, binding on all phases).** Discovery is location-agnostic — the pool contains everything, because pool-time geo filtering starves other users and silently deletes remote roles. Location preference is enforced entirely per-user at scoring/ranking time (P0.7): the owner's Atlanta-based and remote positions must surface first and foremost, ahead of everything else, with out-of-metro onsite roles ranked bottom or disqualified per his dealbreakers. Removing the legacy hardcoded Atlanta filter (P0.1) without landing P0.7 in the same session is a regression, not a fix.

**Bugs — inherited plumbing broken in the port.** The shared pool was ~100% aggregator + paid-keyword noise because seeded portal boards ship empty (`web/lib/portals/portalsSeed.ts:58-66`) and hosted discovery silently skips empty boards (`discovery.py:184-185`). The only ATS postings in the pool came from 16 boards the owner hand-seeded via SQL. On top of the starved pool: a legacy Atlanta location filter still trims some sources pre-pool, no fetcher ever emits `remote` (JSearch discards `job_is_remote`, `jsearch.py:148-156`), and `dealbreakers` never reach the rubric compiler. So scoring ran on a small, biased, remote-blind pool with a lobotomized rubric — 2 weak matches is the *expected* output.

**Gaps — job-pipeline strengths never ported.** job-pipeline's actual moat is its 51 hand-verified ATS boards plus its hygiene machinery (impostor slug check, skipped ledger, liveness gates). jobify has the fetcher code but no mechanism to give any user a real portals.yml: `dream_companies` from onboarding dead-ends at `buildDoc.ts:224-234`. The moat was left behind.

**Structural — weaknesses jobify can leapfrog.** Even a perfect port only reproduces job-pipeline's ceiling: a static watchlist with no discovery loop, fossilized keyword queries, silent slug drift, and zero outcome attribution (Agent C, C1-C3, C6, C8). Because jobify is multi-user with a shared pool, discovery investment amortizes across all users — jobify can exceed job-pipeline here, not just match it.

Plan: **P0** fix the bugs, **P1** port the moat, **P2** build the discovery loop job-pipeline never had, **P3** make it self-monitoring.

---

## 2. P0 — Stop the bleeding (1 session)

Restore inherited behavior and unblock diagnosis. All Python changes in `jobify/hunt/`; keep discovery zero-LLM.

| # | Defect (ref) | Fix sketch | Acceptance test |
|---|---|---|---|
| P0.1 | Legacy Atlanta filter inside hosted fetchers (B#5) | Delete/bypass hardcoded geo filtering in affected fetchers; location preference belongs exclusively to per-user scoring. Grep all fetchers for inherited location constants. | Discovery run produces pool postings with non-Atlanta locations from every previously-filtered source; unit test asserts no fetcher references a location constant. |
| P0.2 | `remote:null` starvation (B#3) | (a) Plumb `job_is_remote` through JSearch (`jsearch.py:148-156`); (b) add shared `infer_remote(location_str, raw)` helper for Greenhouse/Ashby/RemoteOK/WWR/Remotive — pattern-match "Remote", "Anywhere", "Distributed", plus per-source structured fields where present (RemoteOK/WWR/Remotive are remote-only by definition: hardcode `remote=true`). Tri-state: `true/false/null`. | ≥70% of pool rows have non-null `remote` after one discovery run; scorer test shows a remote-only user's rubric penalizes `remote=false` and treats `null` as uncertain, not as fail. |
| P0.3 | Dealbreakers severed (B#6) | Restore `dealbreakers → hard_disqualifiers` mapping in the profile→rubric compile path. | Compiled rubric for a test profile contains its dealbreakers; a synthetic posting violating one is disqualified before LLM stage. |
| P0.4 | Silent empty-board skip (B#2, `discovery.py:184-185`) | Minimal fix now: WARN log + counter (`boards_total / boards_fetched / boards_skipped_empty`) emitted in run summary. Full telemetry in P3. | Discovery run against a user with empty sections prints the skip count; count lands in run summary artifact. |
| P0.5 | Invisible funnel (B#7) | Write a matches row for *every* scored posting with `status ∈ {surfaced, rejected_title, rejected_rubric, rejected_rerank, rejected_llm}` and a short `reject_reason`. Keep surfaced-only as the default UI view. | After a hunt, `select status, count(*)` reconstructs the full funnel (371→356→…→2 shape); UI unchanged for end users. |
| P0.6 | Fossilized queries, interim (B#4) | No LLM yet: replace the 4 hardcoded strings with a template expansion per user — `{profile.target_titles[:3]} × {remote? "remote" : profile.location}` — deduped across users before spending paid-API calls (shared-pool dedup of identical queries). Cap total paid queries per discovery run. | Two users with different titles/locations generate different query sets; owner's queries no longer contain "atlanta" unless profile says so; paid-call count ≤ cap. |
| P0.7 | Location fit not a ranking dimension (owner directive 2026-07-20) | Per-user scoring must treat location fit as a **first-class ranking dimension**, derived from the profile (preferred metros + remote acceptability). Three tiers: **top** = posting in a preferred metro OR `remote=true` when the user accepts remote; **middle** = `remote=null` / ambiguous location; **bottom or disqualified** = onsite/hybrid outside preferred metros (disqualified only if the user's dealbreakers say so). Surfaced matches are ordered location-tier-first, then score. This REPLACES the deleted discovery-time filter — P0.1 must never ship without P0.7 in the same session. | For the owner's profile (Atlanta metro + remote-acceptable): every Atlanta-based or remote match ranks above every non-Atlanta onsite match regardless of raw score; unit test with synthetic postings asserts the tier ordering; `remote=null` postings appear but never above tier-1. |

---

## 3. P1 — Port the moat (2 sessions)

Goal: every onboarded user gets a real, verified portals.yml, and the fetcher fleet covers the ATS platforms where the jobs actually are.

### 3.1 Slug probe/verify service (generalize the impostor check)

A Python module `hunt/sources/slug_probe.py` + thin API route, used by onboarding, the starter-pack seeder, and (P2) the candidate queue:

- Probe endpoints per ATS: `boards-api.greenhouse.io/v1/boards/{slug}/jobs`, `api.ashbyhq.com/posting-api/job-board/{slug}`, `api.lever.co/v0/postings/{slug}?mode=json`, Workday CXS (below).
- Given a company name, generate candidate slugs (lowercase, strip punctuation, hyphen/concat variants), probe each ATS, and score matches by comparing board metadata company name to the requested name (the existing impostor check, promoted from add-time-only to a callable service).
- Returns `{ats, slug, confidence, live_posting_count}` or `not_found`. Zero LLM.

### 3.2 dream_companies → seed plumbing

Fix `buildDoc.ts:224-234` to pass `dream_companies` into the seed, and replace `portalsSeed.ts:58-66`'s unconditional `companies: []`:

- On onboarding completion, run each dream company through the slug probe (server-side, async, seconds per company). High-confidence hits are written into the user's portals doc (`- slug: x / name: Y`, passing existing jsonschema). Misses land in a "couldn't auto-find" list shown to the user, and (after P2) into the candidate queue.

### 3.3 Curated starter catalog + tier packs

New table `board_catalog` (global, shared): `id, ats, slug, company_name, tags[], added_by, verified_at, status`. Seed it initially from job-pipeline's 51 verified boards plus a curated expansion pass (target 150-250 boards, tagged: `big-tech-adjacent`, `growth-startup`, `enterprise`, `remote-first`, `fintech`, `infra`, etc. — tags assigned at curation time).

Tier mapping: onboarding's targeting tiers map to tag queries — e.g. a "senior IC at product startups, remote" user gets `growth-startup ∩ remote-first` packs. Each user's portals doc = dream-company hits + their tier pack (30-60 boards), user-editable afterward. Because discovery unions all users' portals, catalog boards enter the shared pool as soon as one user (or the system default set) references them; per-user relevance is enforced by the existing scoring ladder, which is exactly the intended cost design.

**Verify:** whether per-user portal membership currently affects scoring confidence (the aggregator-verification gate analog). If so, seeded boards must count as "verified" for their subscribers.

### 3.4 Fetcher fleet: Lever + Workday CXS

- **Lever** (`api.lever.co/v0/postings/{slug}?mode=json`): fetcher exists but empty (C4 calls this inexcusable — easiest API in the class). Wire it fully, add Lever companies to the catalog.
- **Workday CXS**: new fetcher. Most public Workday sites expose unauthenticated JSON at `https://{tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` (POST, paginated) — per Agent C; **verify** request shape and pagination on 2-3 real tenants before generalizing. Board entry needs `tenant/wd_instance/site` rather than a bare slug — extend the portals jsonschema with an optional `workday:` object. This unlocks enterprise employers structurally excluded from Greenhouse/Ashby (C1) — the likely source of "types of jobs" dissatisfaction for hybrid/enterprise-leaning users.
- SmartRecruiters/Recruitee/Personio: remain dormant, but document that decision in the catalog README (C4).

### 3.5 Metadata retention (C5 + B#3 completion)

Add `raw jsonb` column to `postings`; every fetcher persists the full source payload (schema-on-read). Extract into first-class columns now: `posted_at` (age → ghost-job filter + urgency signal), `department`, `employment_type`, `comp_min/comp_max/comp_currency` (Ashby publishes compensation; Greenhouse sometimes; JSearch sometimes). Wire two cheap pre-LLM filters into the fanout ladder: comp floor (if user sets one and posting publishes comp) and max posting age. Both filters must *pass* on null — absence of data is never a disqualifier.

---

## 4. P2 — Discovery loop (2 sessions)

The leapfrog: mechanisms by which companies nobody hand-added enter the system. Multi-user changes the design — discovery grows the **global catalog**, not any one user's list.

### 4.1 The global/per-user split

| Concern | Global (shared) | Per-user |
|---|---|---|
| Candidate intake | `candidate_boards` queue: `{company_name, evidence_url, evidence_kind, proposed_ats, proposed_slug, probe_result, status}` | — |
| Verification | Slug probe (P1 service) runs automatically on enqueue | — |
| Admission | **Auto-admit** to `board_catalog` when probe confidence is high (metadata name match + live postings > 0). Ambiguous probes go to an owner/admin review page for one-keystroke approve/reject (the multi-user version of job-pipeline's Skipped ledger — rejections are recorded with reasons and never re-proposed). | — |
| Fetching | All catalog boards with `status=active` are fetched into the shared pool (public APIs, free — pool growth costs bandwidth, not dollars). | — |
| Relevance | Auto-tag new boards from their own postings (dominant departments/title keywords → tags; zero-LLM heuristic). | Existing scoring ladder is the relevance filter; users can additionally pin boards (provenance boost) or mute boards. Tier-pack refresh suggests new catalog boards matching a user's tags. |

Rationale: since per-user LLM cost is already capped by the fanout ladder, the only real risk of a big pool is title-filter throughput — cheap. So admission can be liberal; *scoring* stays strict.

### 4.2 Feeders (each ~50 lines against the shared queue back-end)

1. **HN "Who is hiring?" company extraction** (C, ranked #1): the existing HN scraper already parses comments for postings — additionally extract company names and embedded ATS links, enqueue as candidates with the comment URL as evidence. Trivial, clean ToS, high yield.
2. **Aggregator-unknown-company routing** (C9, ranked #3): when an aggregator posting survives a user's title filter but the company is not in `board_catalog`, enqueue the company. This converts the "low-confidence aggregator post" penalty into the system's highest-precision discovery signal — it is literally "a real user's filter liked a job at a company we don't track."
3. **SerpAPI ATS-site dorks** (C6, ranked #2): repurpose a fixed slice (~20%) of the SerpAPI budget for queries like `site:boards.greenhouse.io "staff engineer" remote`, generated from the union of active users' title keywords. Results parse directly into slugs (the slug is in the URL) — enqueue.
4. Deferred (backlog, not this wave): YC Work at a Startup, Getro VC portfolio boards, funding-event RSS, hiring.cafe, Common Crawl — each needs per-source ToS/stability verification (C7); revisit after the queue back-end proves out.

### 4.3 Per-user query generation (the permanent B#4 fix)

Replace P0.6 templates with rubric-derived queries: one metered LLM call per user per month (and on profile change) generates ≤10 queries from the compiled rubric — title synonyms × seniority × location/remote (C6). Stored on the profile; discovery consumes stored queries only (stays zero-LLM at run time). Cost: ~1 small call/user/month, written to `budget_ledger` with kind `query_gen`; bounded at ≤$0.01/user/month — negligible against the $100 global cap. Per-query yield tracked (P3) so zero-yield queries rotate out at next regeneration.

---

## 5. P3 — Health + telemetry (1 session)

Job-pipeline decays silently (C3, C8); jobify must not.

**Board health.** New table `board_health`: per catalog board, `last_success_at`, `last_status`, rolling 30-day posting count, status history. Updated every discovery run. Run the metadata-name impostor check on **every poll**, not just add time (C3). Alert conditions: HTTP 404/410; posting count drops to zero vs 90-day baseline; metadata name mismatch. Alerts surface in the admin review page and the discovery run summary (upgrading P0.4's warning into structured telemetry — an empty *section* and a *dead board* become distinct, loud signals).

**Auto-relocation (propose-only).** On a dead-board alert: probe the same company name across all ATS APIs (slug probe service) + one SerpAPI `site:` dork; if a new home is found, enqueue a candidate with evidence `relocation`; admin approves the swap. No silent auto-commit — a wrong relocation poisons the pool.

**Funnel attribution.** Extend P0.5: matches rows already carry rejection stage; add `source` + `board_id`/`query_id` provenance on postings (partially exists — **verify** current `postings.source` granularity). Add user-action states to surfaced matches (`clicked, applied, screen, interview, offer` — clicked is trackable now; later states via user marking, which the matches UI must support minimally). Monthly rollup view per source/board/query: surfaced count, application rate, cost from `budget_ledger`.

**Kill rules** (implemented as flags in the rollup, enforced by admin action initially): paid source/query with zero applications across all users in 60 days loses budget; catalog board with zero surfaced matches for any user in 90 days flagged `dormant` (still cheap to fetch, so dormant ≠ deleted — just excluded from tier packs).

---

## 6. Non-goals

- **LinkedIn automation** — ToS violation, ban risk to users' accounts, asymmetric downside. Hard no (C7).
- **Discord/Slack/newsletter scraping** — human-consumption media, brittle, low structure.
- **GitHub org activity as hiring signal** — weak, laggy proxy (C7).
- **Common Crawl ATS enumeration** — real project, low precision; not this wave (C, §3.8).
- **hiring.cafe / Getro / YC WaaS** — deferred pending ToS/API-stability verification, not rejected.
- **Auto-committing board relocations or ambiguous slugs** — precision failures here poison every user's pool; human keystroke stays in the loop.
- **More scoring sophistication** — per Agent C, the problem is recall, not precision; scoring ladder is untouched except the P0 rubric fixes.

## 7. Sequencing & session map

| Session | Phase | Scope (one line) | Depends on |
|---|---|---|---|
| S1 | P0 | Atlanta filter removal **+ location-tier ranking (P0.7, same session, non-negotiable)**; remote plumb-through + inference; dealbreakers→rubric; empty-board warning; full-funnel matches rows; template query params | — |
| S2 | P1 | Slug probe service; dream_companies→seed plumbing (`buildDoc.ts`, `portalsSeed.ts`); `board_catalog` table + initial 51-board import + tier-pack mapping | S1 (schema conventions) |
| S3 | P1 | Lever fetcher wiring; Workday CXS fetcher (+ jsonschema extension); `raw jsonb` retention + comp/age/department columns + two pre-LLM filters; catalog curation pass to 150+ | S2 (catalog) |
| S4 | P2 | `candidate_boards` queue + auto-admit/review flow; HN extraction feeder; aggregator-unknown routing feeder; SerpAPI dork feeder | S2 (probe, catalog) |
| S5 | P2 | Per-user LLM query generation (metered, monthly) replacing S1 templates; per-query provenance | S1, budget_ledger |
| S6 | P3 | `board_health` + every-poll impostor check + alerts; propose-only relocation; funnel rollups + kill-rule flags; admin review page polish | S2-S4 |

S1 ships alone and immediately (it alone should transform the owner's next hunt). S2/S3 and S4/S5 can interleave; S6 last.

## 8. Success metrics

Tied to the complaint: **amount** (pool starved) and **types** (aggregator-junior-remote skew, no enterprise, remote-blind, dealbreakers ignored).

**Owner's next hunt after S1+S2 (primary target):**
- Pool ≥ 2,500 postings (vs 371), with ≥50% from direct ATS boards (vs ~0% ex-hand-seeding).
- Surfaced matches: 8-15 (vs 2), with the owner rating ≥half of them "on par with or better than job-pipeline's same-day output" — the ground-truth comparison that triggered this plan.
- `remote` non-null on ≥70% of pool; zero surfaced matches violating a stated dealbreaker.
- Location ordering holds: every surfaced Atlanta-based or remote match ranks above every non-Atlanta onsite match (P0.7).
- Cost ≤ $0.50/hunt (bigger pool, same ladder; well inside caps).

**After S3-S4 (structural):**
- Catalog ≥ 150 active boards spanning ≥3 ATS platforms including Workday; ≥10 catalog boards originating from discovery feeders (companies no human hand-added) within 30 days.
- Every discovery run summary reports boards fetched/skipped/dead — zero silent skips.

**After S6 (durable):**
- Full funnel reconstructable per user per cycle; per-source surfaced/applied rollup exists; first kill-rule flag fires on real data.
- A dead board is detected within one poll cycle and has a proposed relocation or issue within 24h.

The meta-metric: a brand-new user completing onboarding gets a non-empty, verified portals doc and a first hunt whose pool composition matches the owner's — no SQL hand-seeding ever again.

---

## Appendix: upstream agent verdicts (for the record)

**Agent A (job-pipeline inventory):** 14 source types; effective yield concentrated in 51 hand-verified boards (19 Greenhouse, 32 Ashby); Lever/Workday/SmartRecruiters/Recruitee/Personio wired but empty; ~4,400 raw postings/run; hygiene machinery = impostor-slug check, Skipped ledger, triple dedup, liveness + aggregator-verification gates. "The moat is portals.yml, not the code."

**Agent B (jobify audit):** portalsSeed ships `companies: []` unconditionally; dream_companies dead-ends at buildDoc.ts:224-234; discovery.py:184-185 silently skips empty boards; no source emits `remote` (jsearch.py:148-156 discards `job_is_remote`); legacy Atlanta filter active in hosted fetchers; dealbreakers→hard_disqualifiers severed; disqualified postings invisible (no matches rows).

**Agent C (adversarial, full report retained in session transcript):** "A precision machine bolted to a recall dead-end." Top three moves: candidate-company queue + HN/aggregator/dork feeders; board health monitoring with auto-relocation; per-source funnel telemetry with kill rules. Ranked discovery mechanisms: HN feedback #1, SerpAPI ATS dorks #2, aggregator-unknown routing #3 (all three share one queue back-end). Source scorecard highlights: Lever "fix — populate now"; JSearch "kill unless telemetry saves it"; Remotive "kill-leaning probation."
