# Session 57 — INT2-C: reconcile + the sim gate  (MAIN checkout, not a worktree)

**Model: Sonnet.** Reconciliation + validation session, session-46 pattern:
merge `feat/int2-engine` then `feat/int2-deck` into local main as a UNION
(no fix from either side lost), verify, then run the REAL sim gate against
the new engine. Do not push — the owner pushes after reviewing your report.

## Context to read first
- Both branches' diffs (`git log -p main..feat/int2-engine` etc. — skim
  the shape, read the engine contract in
  `planning/session-prompts/55_int2_engine.md` §"engine contract").
- `web/sim/**` — personas + invariants (NO-REPEAT, PROGRESS,
  NO-DOUBLE-FALLBACK, RECOVERY, LEDGER, MONOTONIC-STATE, TRUNCATION).

## Steps
1. Merge both branches; resolve conflicts to the union. The engine rewrite
   (55) wins on handleTurn/interview/turn-route; the deck work (56) wins
   on reactions/moduleTurns additions. Grep both sides' dated comments and
   verify each survives.
2. Adapt the sim harness to the new engine ONLY where signatures force it
   — invariant definitions must not be weakened. NO-REPEAT and
   MONOTONIC-STATE should now be structurally guaranteed; if an
   adaptation would loosen an invariant to pass, STOP and report instead.
3. Full suites: pytest (should be untouched), web tsc/vitest/build, scrub.
4. **THE GATE** (requires `CLAUDE_CODE_OAUTH_TOKEN` in `web/.env.local` —
   the owner refreshes it before you start; at-API-prices accounting,
   $0 actual): run THREE personas — cooperative, terse/uncooperative, and
   the card-heavy one closest to the real second user's shape. Expected
   with the new engine: every persona reaches done in ≤12 turns; ZERO
   repeated intents; ZERO canned-string fallbacks (they no longer exist —
   assert their absence); askHint-fallback rate <10% of turns; TRUNCATION
   quiet; LEDGER exact; RECOVERY: kill one persona mid-run and resume it,
   must complete without re-asking answered intents.
5. Include ALL verdict tables verbatim, pass or fail. If the gate FAILS:
   fix mechanical findings (parse bugs, off-by-one) and re-run ONCE; for
   anything structural, report honestly and stop — do not iterate on
   prompts to force a pass.
6. Commit the merge + adaptations on local main. Do NOT push.

## Exit criteria
Union verified, suites green, scrub PASS, three persona verdict tables in
the report, recovery test documented. Report: merge summary, fix-survival
checklist, verdict tables, cost of the sim runs, ambiguities.
