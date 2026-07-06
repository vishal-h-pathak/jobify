# Session 29 — ONB-D: Admin profile review + settings resume upload  (Onboarding-v2 wave 2, parallel with ONB-B)

**Model: Sonnet.** Owner decisions #2 and #3 (2026-07-05) made real.
**Run from:** a `jobify-wt/hosted-onbv2-admin` worktree off main.
**Depends on:** ONB-A merged (consumes its `regenerateCv` helper + v2
`extracted` shape).
**You own:** `web/app/(app)/admin/**`, `web/lib/admin/**`,
`web/app/(app)/settings/**`, `web/app/api/settings/**` (new),
`web/app/api/admin/**`, their tests, docs. Do NOT touch
`web/app/(app)/onboarding/**`, `web/components/onboarding/**` (ONB-B's, in
parallel), `web/lib/anthropic/**`, `web/lib/onboarding/**`,
`web/lib/profile/**` (consume, don't modify), `jobify/`, migrations.

## Task 1 — Admin extraction/profile review (owner decision #2)

On the Operations tab's Users card: each row gains a "Review profile"
expander (or drill-in page — your call, simplest wins) showing, via the
admin-gated service-role client only: the onboarding `extracted` object
(anchor, calibration answers/evidence, targeting fields) pretty-rendered,
the 8 `profiles.doc` files (monospace, collapsible per file), and
`validation_status`. READ-ONLY in v1 — no editing. Guard: `requireAdmin()`
before any data fetch, exactly like existing admin routes.

**Disclosure (required, same task):** onboarding's first screen gets one
quiet line of consent copy — add it via a SHARED location ONB-B can render
(simplest: export a `DISCLOSURE_COPY` string from `web/lib/admin/` and hand
it to ONB-B via your merge report; if ONB-B has already merged, add the line
to the anchor panel directly). Copy: "During the beta, the operator can
review what's captured here to improve matching." Neutral, no names (scrub
gate).

## Task 2 — Settings: add/replace resume after onboarding (owner decision #3)

`web/app/(app)/settings/`: a "Resume" card — shows current cv.md provenance
("from your resume" / "built from your interview answers", derivable from
ONB-A's provenance header), paste box + .txt/.md upload, submit →
`POST /api/settings/resume` (auth + invite-or-admin gate, same pattern as
onboarding routes) → calls ONB-A's `regenerateCv` → success shows the new
provenance + a hint to run a fresh hunt (rubric recompile happens on the
worker's next run for that user). Ledger: the regeneration's LLM turn writes
its row (the helper handles it — verify, don't reimplement). Errors surface
in a Banner; the old cv.md is never destroyed on a failed regeneration.

## Tests

Admin review: gated (401/403 matrix), renders extracted + doc files from a
fake, never constructs service-role pre-gate. Settings resume: gates,
happy-path regeneration call shape, failed regen leaves profile untouched,
provenance line derivation both ways. Disclosure copy exported + asserted
non-empty, no operator-identifying strings anywhere (scrub gate).

## Exit criteria

`npm run build` + vitest + tsc green; scrub gate PASS; diff inside ownership.
Commit: `ONB-D: admin profile review (read-only) + settings resume add/replace, beta disclosure copy`.
Push; do NOT merge — review-then-merge.
