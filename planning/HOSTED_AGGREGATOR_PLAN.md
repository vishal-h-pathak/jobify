# Hosted Aggregator Plan — "jobify cloud" v1

_Drafted 2026-07-03 in Cowork. Direction confirmed by Vishal: evolve jobify (not a
new repo), aggregator-only v1, with hunt/tailor/submit eventually abstracted into
independently runnable services. LLM strategy: all three modes — funded pool,
static-after-profile scoring, optional BYO key._

## 1. What exists vs. what's missing

jobify is already the de-personalized product: profile contract behind
`profile_loader`, conversational onboarding, clean schema baseline, trimmed
cockpit. What it is **not** is hosted or multi-user. Gaps:

| Area | Today (single-user local) | Hosted v1 needs |
|---|---|---|
| Identity | one `profile/` dir on disk | per-user profile in DB, built via web chat |
| Auth | `DASHBOARD_PASSWORD` | Supabase Auth magic links (papercuts pattern) |
| RLS | enabled, NO policies, service-role only | real per-user policies; anon+auth reads become load-bearing |
| Discovery | per-user portal polling | **shared global discovery** — fetch each source once, score per user |
| LLM | one Anthropic key, unbounded | budget ledger, model tiering, scoring ladder, BYO key |
| Scope | hunt→tailor→submit | hunt only; contracts preserved for later services |

**Prerequisite (H0):** the Phase F PII scrub-gate sign-off / publish runbook
(`planning/session-prompts/09_merge_and_publish.md`) is still the open release
item. Finish it first — the hosted work builds on a clean public baseline.

## 2. Product shape (what a friend experiences)

1. Gets an invite link → signs in with a magic link (no password, no keys).
2. **Onboarding chat** (~15 min): uploads resume, answers the interview — the web
   port of `onboarding/SKILL.md` stages 1–3 (ingestion, identity/logistics,
   targeting) plus disqualifiers. Voice/proof-points/archetypes stages are
   tailor-era; deferred from v1.
3. Lands on a **feed**: scored postings with reasons, refreshed daily. Actions:
   save, dismiss, "I applied" (manual click — the applied source-of-truth rule
   carries over). Feedback tunes their rubric.

## 3. Architecture

```
Next.js app (Vercel)                    Python worker (GHA cron, reuse hunt/)
 ├ landing + invite gate                 ├ discovery: portals ∪ all users' sources,
 ├ onboarding chat  ──┐                  │   fetched ONCE, deduped by shared.jobid
 └ feed UI            │                  └ scoring fan-out: per user, via ladder
        │             │                          │
        ▼             ▼                          ▼
   Supabase: auth · profiles · postings(global) · matches(user×posting)
             · runs · budget_ledger · api_keys(BYO, encrypted)
```

New tables (migration `0002_multitenant.sql`):

- `profiles` — `user_id`, profile JSONB (the 8-file contract as one document,
  same schema as `onboarding/schema/`), `compiled_rubric` JSONB, profile
  embedding vector. `profile_loader` gets a DB backend alongside the dir backend
  so hunt code is unchanged.
- `postings` — **global**, keyed by `shared.jobid` id; title/company/location/
  description/ATS URL/`link_status`; posting embedding (computed once, shared by
  every user). This is the big cost lever: discovery and embeddings amortize
  across all users.
- `matches` — `user_id × posting_id`, ladder scores + LLM reason, and its own
  small per-user state: `new → seen → saved → dismissed → applied`. **Do not
  touch `jobify/shared/status.py`** — the pipeline status machine stays intact
  for the tailor/submit era; aggregator state lives on `matches`.
- `budget_ledger` — per-user token/cost events (port the job-pipeline
  cost-tracking pattern: record at the `llm.complete` chokepoint).
- `api_keys` — optional BYO Anthropic key, encrypted at rest, raises that
  user's LLM cap; never logged.

RLS: users read/write their own `profiles`/`matches` via authed anon key;
`postings` readable by all authed users; workers keep service-role. Note the
inherited hazard now points the other way — anon reads are load-bearing, so test
both "sees own rows" and "cannot see others'" in CI.

## 4. Scoring ladder (the LLM-reduction design)

Cheapest gate first; each stage prunes for the next. Marginal LLM cost per
posting per user approaches zero.

1. **Title pre-filter** (existing, static) — user's `portals.yml` title filter.
2. **Compiled rubric** (static, the key new idea) — at onboarding end, ONE LLM
   call compiles thesis + disqualifiers + tiers into a deterministic rubric:
   weighted keyword/phrase groups, disqualifier regexes, location/remote/comp
   gates, degree gate. Scoring is then pure Python — zero tokens. Feedback
   (save/dismiss) adjusts weights; a nightly cheap LLM call can recompile from
   accumulated feedback.
3. **Embedding rerank** — cosine(profile embedding, posting embedding). Voyage
   or similar (~$0.0001/posting, and posting embeddings are shared globally).
4. **LLM verdict** — Haiku fit+legitimacy call for only the top-N survivors per
   user per day (N≈15), producing the human-readable "why this matches" reason.
   Budget-gated by `budget_ledger`; BYO key raises N; an exhausted pool degrades
   gracefully to stages 1–3 (feed still works, reasons say "rubric match").

Cost math: onboarding ≈ $0.50–1.00/user (Sonnet interview + rubric compile);
steady state ≈ $0.02–0.05/user/day (15 Haiku verdicts + embeddings). **$100
comfortably runs 10–20 friends for several months.** Discovery remains
token-free HTTP/RSS.

## 5. Modularity contracts (the "abstract each piece later" requirement)

- **Aggregator emits** `(posting, profile)` — everything the tailor needs is a
  `postings` row + a `profiles` document. No tailor columns on `matches`.
- **Tailor (later)** = service: `(posting, profile) → resume + CL + answers` in
  Storage keyed by match. Runs hosted (LaTeX in a container) or local.
- **Submitter (later)** = local companion, not hosted: `(ATS URL, materials) →
  pre-filled visible browser`, stop-at-submit preserved. Hosted app just deep-
  links into it.
- The existing console-script split (`jobify-hunt` / `jobify-tailor` /
  `jobify-submit`) is already this seam — the hosted work must not blur it.

## 6. Phases → session prompts

Each phase = one Claude Code worktree session (`planning/session-prompts/10+`),
review-then-merge as usual.

| # | Session | Contents |
|---|---|---|
| H0 | publish gate | finish Phase F scrub sign-off + publish runbook (existing prompt 09) |
| H1 | schema | `0002_multitenant.sql`: profiles/postings/matches/budget_ledger/api_keys + RLS policies + both-direction RLS tests |
| H2 | profile backend | DB backend for `profile_loader`; rubric compiler + `compiled_rubric` schema; feedback→reweight hook |
| H3 | onboarding web | port interview stages 1–3 to an API-driven chat (Anthropic SDK, server-side); reuse `onboarding/validate_profile.py` as the gate |
| H4 | worker | shared discovery (global postings, link resolution, shared embeddings) + per-user scoring ladder fan-out; GHA cron |
| H5 | feed UI | feed + save/dismiss/applied + reasons; magic-link auth + invite gate |
| H6 | cost rails | budget ledger at `llm.complete`, per-user caps, BYO key (encrypted), degraded static mode |
| H7 | beta hardening | invite friends, telemetry (fleet bus/ntfy), admin cost view (port portfolio cost-dashboard pattern) |

H1+H2 can run in parallel; H3/H4/H5 fan out after H2; H6 before any invite goes
out.

## 7. Risks / carried-over gotchas

- **PII stakes rise**: hosted DB now holds friends' PII. Keep `application_
  defaults`-grade fields out of v1 profiles (aggregator doesn't need them);
  minimal-collection principle.
- **RLS tests must cover isolation**, not just access (see §3).
- **Status contract**: aggregator deliberately does not extend `jobs.status`;
  drift guard (`test_status_contract.py`) stays green untouched.
- **"Applied" is always a human click** — unchanged.
- **One heavy user draining the pool** — H6 caps are a launch blocker, not a
  nice-to-have.
- Anthropic has no embeddings API — stage-3 needs a second provider (Voyage) or
  a small local model in the worker; decide in H4.
