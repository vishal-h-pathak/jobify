# Session 45 — INTSIM: the interview simulation harness  (single session, off main)

**Model: Sonnet.** Owner directive after TWO live interview loops that 1174
green unit tests could not see: "we really need to fix these loops… I don't
know how we can categorically go through and test each of these emergent
errors" + "if something happens during onboarding, the process should be able
to recover from where it was left off." The answer is property-testing real
conversations: a scripted synthetic user plays the ENTIRE live intake against
the REAL model and transport, and the harness asserts conversation-level
invariants no mock can check. Read `web/lib/onboarding/handleTurn.ts` FIRST —
its v2 re-prompt + loop-breaker comments describe both live failures; your
harness must be able to catch exactly those two, retroactively.
**Branch:** `feat/intsim`, worktree `jobify-wt/intsim`.
**You own:** `web/sim/**` (new), an `npm run sim` script in `web/package.json`,
structured fallback/re-prompt telemetry inside `handleTurn.ts` (small,
additive — see task 4), tests for the harness's own pure logic, docs
(`web/sim/README.md`). Do NOT touch: routes, components, migrations,
`jobify/`, the extension.

## Build

1. **The loop.** `web/sim/runSim.ts` drives `handleOnboardingTurn` directly
   (it already takes injected `runTurn` + db clients) with: (a) the REAL
   `runTurn` built exactly as the state/turn routes build it — real model,
   real transport (works with `CLAUDE_CODE_OAUTH_TOKEN` or
   `ANTHROPIC_API_KEY` from env); (b) **fully in-memory fake supabase
   clients** — the sim must NEVER touch a real database (the pytest-hit-prod
   incident is the cautionary tale; assert no network except api.anthropic.com).
   Zero-LLM modules (values/dealbreakers/energy/environment/trajectory/
   reactions) are driven through their pure writers directly — the chat sim
   covers the LLM stages: calibration → resume → targeting → done.
2. **Personas.** `web/sim/personas/*.ts`, scripted deterministic answer
   functions (answer chosen by stage + question content, not turn index):
   `cooperative` (clean answers), `terse` (minimum viable words),
   `meandering` (buries the answer mid-paragraph), `corrective` (gives an
   answer, then corrects a fact next turn — the owner's "I'm actually in
   Atlanta" move). Alex Quinn data only.
3. **Invariants** (each a named check with a clear failure report):
   - **NO-REPEAT:** no two assistant turns contain the same normalized
     question (lowercase, strip punctuation/whitespace; a shared 12+-word
     window counts as repeat). This alone catches BOTH live loops.
   - **PROGRESS:** stage never regresses; every `record_*` tool lands within
     4 turns of its stage starting; session reaches `done` within 25 turns.
   - **NO-DOUBLE-FALLBACK:** the fallback/re-prompt telemetry (task 4) never
     fires the same fallback twice consecutively.
   - **RECOVERY (the owner's resume guarantee):** at 2–3 random-but-seeded
     points, serialize the session snapshot, throw the loop away, rebuild
     from the snapshot (exactly what the live app does on a return visit),
     and continue. Assert: nothing already recorded is re-asked, extracted
     state is byte-identical across the boundary, and the session still
     completes. Also assert every turn PERSISTED before the sim advances —
     the "spot saved" property itself.
   - **LEDGER:** ledger writes (to the fake) == real model calls, exactly.
4. **Telemetry (additive, in `handleTurn.ts`):** when the re-prompt or a
   fallback fires, `console.warn` a single structured line
   (`onboarding_fallback {userId, stage, kind: "reprompt"|"fallback"|"loop_breaker"}`)
   AND include a `fallback_kind` field on the turn's return value so the sim
   (and later, admin telemetry) can see it. No schema change.
5. **Run modes.** `npm run sim` = all personas, full run, ~$1–2, prints a
   per-persona verdict table + total tokens/cost; `npm run sim -- --persona
   terse --turns 8` for cheap spot checks. NOT wired into vitest/CI (cost +
   secrets) — it's the pre-deploy smoke for any prompt/model/transport
   change; say so prominently in the README, citing that the loop class
   appeared only after the OAuth transport switch.

## Tests (of the harness itself — cheap, no LLM)
Normalized-repeat detector cases (incl. the two real loop transcripts,
abridged, as fixtures — they must FAIL the invariant); persona answer
functions; recovery serializer round-trip; fake-supabase behavior. Full web
suite green; `npm run sim` demonstrated once for real in the session with the
verdict table in the report.

## Exit criteria
Web vitest + tsc + build green; scrub gate PASS; one real sim run's verdict
table in your final report; diff inside ownership. Commit:
`INTSIM: interview sim harness — personas, loop/recovery invariants, fallback telemetry`.
Push; do NOT merge.
