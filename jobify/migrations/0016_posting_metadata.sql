-- 0016_posting_metadata.sql — HUNT2 P1 S3: metadata retention + two
-- pre-LLM fanout filters (planning/HUNT2_SOURCES.md §3.5).
--
-- Additive on top of 0001-0015. Session 51 (parallel, same base) owns
-- 0017 — this migration does not reference or depend on it.
-- Idempotent (ADD COLUMN IF NOT EXISTS throughout), so re-running is
-- safe, and safe to apply whether or not 0017 has landed yet.
--
-- `raw` and `posted_at` already exist on `public.postings` as of
-- 0002_multitenant.sql (JSONB / TIMESTAMPTZ respectively) but no fetcher
-- has ever populated them (`jobify.db.upsert_posting` never included
-- them in its upsert payload — this session fixes that in Python, this
-- migration just re-asserts both columns IF NOT EXISTS so this file
-- applies cleanly and correctly on a project that somehow predates 0002
-- too). The five genuinely new columns are `department`, `employment_type`,
-- `comp_min`, `comp_max`, `comp_currency` — Ashby publishes structured
-- compensation via `includeCompensation=true` (confirmed live: a
-- `compensation.summaryComponents[].{minValue,maxValue,currencyCode}`
-- entry with `compensationType="Salary"`); Greenhouse/Lever have no
-- structured comp field but do expose department (`departments[].name` /
-- `categories.department`) and Lever exposes `categories.commitment` as
-- employment_type; Workday's CXS detail payload exposes `timeType` as
-- employment_type and `startDate` as an exact posted-on date (confirmed
-- live against target.wd5/homedepot.wd5 — `startDate` matches the
-- human-readable `postedOn` string exactly, e.g. "Posted Yesterday" ==
-- startDate == (today - 1)). All six columns are nullable — a fetcher
-- that can't extract a field simply leaves it NULL, never a fabricated
-- value.
--
-- These columns feed two new pre-LLM fanout filters (comp floor + max
-- posting age, `jobify.hosted.fanout`) that run on the STRUCTURED
-- comp_min/comp_max/posted_at columns here — a different, cheaper
-- mechanism than the pre-existing `gates.comp_floor_usd` rubric gate
-- (`jobify.hunt.rubric.score_posting`), which regex-parses a dollar
-- figure out of free-text `description` and only runs after a user's
-- rubric has already been compiled. Both filters PASS ON NULL (absent
-- data is never a disqualifier) and write `matches` rows with
-- `status='rejected_rubric'` (the existing canonical enum has no
-- separate "pre-filter" bucket — this is the same funnel category as
-- the rubric gate: failed a static/cheap check before the expensive
-- stages) and a `reject_reason` of `comp_below_floor` or `stale_posting`.

ALTER TABLE public.postings
  ADD COLUMN IF NOT EXISTS raw               JSONB,
  ADD COLUMN IF NOT EXISTS posted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS department        TEXT,
  ADD COLUMN IF NOT EXISTS employment_type   TEXT,
  ADD COLUMN IF NOT EXISTS comp_min          NUMERIC,
  ADD COLUMN IF NOT EXISTS comp_max          NUMERIC,
  ADD COLUMN IF NOT EXISTS comp_currency     TEXT;
