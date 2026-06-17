# Known issues & operational notes

A short, honest list of the rough edges in this single-user release. None of
these block the hunt → tailor → submit flow; they're things to be aware of.

## Submit: per-ATS form fillers drift (R4)

The local-Playwright pre-fill (`jobify-submit`) finds form fields with
declarative, per-ATS selector maps in
`jobify/submit/adapters/prepare_dom/field_maps.yml` (Greenhouse, Lever, Ashby),
plus a generic fallback for everything else. ATS vendors change their DOM over
time, so a selector that worked last quarter can silently stop matching.

**What's verified, and how:**

- The field-resolution logic for each adapter is unit-tested against captured
  DOM fixtures:
  `tests/test_prepare_dom_{greenhouse,lever,ashby}.py`,
  `tests/test_prepare_dom_field_maps.py`,
  `tests/test_manual_scrape_{greenhouse,lever,ashby}.py`. These pass in CI.
- The "never click the final submit" guard is enforced by
  `tests/test_prefill_stop_at_submit.py` — the pre-fill always parks before the
  real Submit button so a human reviews and clicks it.

**What's NOT automated:** a live smoke against *current* public postings.
Hitting real ATS pages needs a browser (and, for the legacy hosted path,
Browserbase credentials), so it isn't a CI step. Per-adapter smoke against the
fixtures last passed **2026-06-17** (63 tests green).

**If a filler misses fields on a real posting:** the pre-fill stops short and
flips the row to `needs_review` rather than submitting a half-filled form — you
finish it by hand. To fix the drift, capture the new DOM and update the
adapter's entry in `field_maps.yml`; the existing fixture tests show the shape.

## Dashboard

- The dashboard runs **service-role only** against your own Supabase project
  (see the key contract in the root `README.md`). With no `DASHBOARD_PASSWORD`
  set it runs open (single-user, local). Set one to gate it.
- Booting the dashboard requires the Supabase env vars; without them the API
  routes return a "misconfigured" 500 by design rather than crashing.

## Voice profile (submit)

`jobify/submit/adapters/prepare_loop.py` looks for an optional
`VOICE_PROFILE.md` under the tailor templates dir; if absent it simply uses an
empty voice block. The canonical voice now lives in the profile layer
(`voice-profile.md`), so this legacy lookup is a harmless no-op for fresh
profiles.
