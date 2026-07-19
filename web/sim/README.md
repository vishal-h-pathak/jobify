# INTSIM — the interview simulation harness

**This is the pre-deploy smoke test for any change to the onboarding chat's
prompt, model, or transport. Run it by hand before shipping one — do not
rely on `npm test` to catch what this catches.** The loop class this exists
to catch (see "Why this exists" below) only appeared *after* the OAuth
transport switch (`lib/anthropic/client.ts`, 2026-07-19) — 1174 green unit
tests at the time didn't see either live loop coming, because both were
emergent conversation-level failures: individually correct-looking turns
that, strung together against the real model, looped forever. Nothing
short of running the real conversation catches that class of bug.

## Why this exists

Two live interview loops happened back to back on 2026-07-19, both only
visible once real users hit the real model over the real transport:

1. **The context-blind re-ask loop.** Once `record_identity` had already
   landed the logistics block, the targeting fallback kept re-asking the
   same batched logistics question — the model acknowledged, the
   deterministic post-check appended the (already-answered) opener anyway,
   the user answered again, forever.
2. **The ack-only self-imitation loop.** The model sent a bare
   acknowledgment with no question ("Good, moving on."), imitated that
   pattern in its own next turn, and the deterministic append repeated the
   same canned question turn after turn.

Both hotfixes live in `../lib/onboarding/handleTurn.ts` (search for
"Live-fire fix"). The owner's directive after the second one: *"we really
need to fix these loops… I don't know how we can categorically go through
and test each of these emergent errors"* and *"if something happens during
onboarding, the process should be able to recover from where it was left
off."* INTSIM is the answer: a scripted synthetic user plays the entire
live intake against the **real model and real transport**, and the harness
asserts conversation-level invariants no mock can check.

## What it does — and doesn't — touch

- **Real**: the Anthropic model, via the exact same `runInterviewTurn` /
  `runCalibrationGeneration` functions the live routes call (real prompt,
  real tool schema, real transport — `CLAUDE_CODE_OAUTH_TOKEN` or
  `ANTHROPIC_API_KEY` from `web/.env.local`, whichever `lib/anthropic/client.ts`
  would pick in production).
- **Fake, fully in-memory, zero I/O**: Supabase. `fakeSupabase.ts` implements
  exactly the three call shapes `saveSession` / `upsertProfileDoc` /
  `recordOnboardingTurn` make, against plain in-process `Map`s — nothing
  it does can reach a real database, by construction.
- **Enforced, not just assumed**: `networkGuard.ts` wraps `global.fetch`
  for the run's duration and throws — before any bytes leave the process —
  on any request to a host other than `api.anthropic.com`. This is the
  belt on top of the fake db's suspenders: a prior pytest-hits-a-real-
  database incident (a different repo, same lesson) is the cautionary
  tale this exists to prevent from ever having a sibling here.
- **Never called**: `maybeFireCheckpoint` (the background-hunt dispatch).
  The zero-LLM onboarding modules (values/dealbreakers/energy/environment/
  trajectory/reactions) are seeded directly through their real pure
  writer/receipt functions (`seedZeroLlmModules.ts`) — same functions the
  real routes call, just with no HTTP, no Supabase, and no side-effecting
  hunt dispatch.

## Personas

Four scripted, deterministic answer functions (`personas/*.ts`), chosen by
**stage + question content** (via `classifyQuestion.ts`), never by turn
index — so a fallback/re-prompt turn that shifts the global turn count
can't desync a persona from what's actually being asked. All four are Alex
Quinn (`profile.example/`) — no real PII anywhere in this harness.

| Persona | Shape |
|---|---|
| `cooperative` | Clean, complete answers. The baseline. |
| `terse` | Minimum viable words; also exercises the zero-LLM resume-skip sentinel path. |
| `meandering` | Buries the real answer mid-paragraph, with tangents. |
| `corrective` | Answers logistics normally, then corrects the salary floor exactly once on the next targeting turn — the real "gives an answer, then corrects a fact next turn" shape. This is also the deliberate stress test for MONOTONIC-STATE (see below): it re-calls `record_identity` with only the changed field, which is exactly the shape that used to destroy `location_and_compensation` mid-interview. |

## Invariants

Each is a named, independently-reportable check (`sim/repeatDetector.ts`,
`sim/monotonicState.ts`, `sim/turnInvariants.ts`):

- **NO-REPEAT** — no two assistant turns share a normalized 12+-word window.
  This alone catches both live loops above; the harness's own tests
  (`repeatDetector.test.ts`) include abridged reproductions of both as
  fixtures that must (and do) fail this check.
- **PROGRESS** — stage never regresses; every `record_*` tool lands within
  4 turns of its stage starting; the session reaches `done` within 25
  turns.
- **NO-DOUBLE-FALLBACK** — the fallback/re-prompt telemetry (`fallback_kind`
  on `handleOnboardingTurn`'s return value, additive in `handleTurn.ts`)
  never fires the same kind twice consecutively.
- **RECOVERY** — the owner's resume guarantee. At 2-3 random-but-seeded
  points (`seededRandom.ts` — deterministic per persona, not
  `Math.random()`), the session snapshot is serialized, the in-memory loop
  state is thrown away, and the loop continues from a freshly-deserialized
  copy — exactly what the live app does on a return visit
  (`recoverySnapshot.ts::roundTripSnapshot`). Asserts extracted state is
  byte-identical across that boundary, and that every turn was persisted
  (exactly one `saveSession` call) *before* the sim advances to the next
  one — the "spot saved" property itself.
- **LEDGER** — ledger writes to the fake `budget_ledger` table equal real
  model calls, exactly. Constitutional: one `budget_ledger` row per real
  Anthropic call, no more, no fewer.
- **MONOTONIC-STATE** — a field once present (non-empty) in `extracted`
  must never disappear or shrink to empty on a later turn. General-purpose
  deep-compare, no knowledge of which tool call caused a regression. Added
  after a live bug: a correction turn re-calling `record_identity` with
  only the changed field wholesale-replaced `extracted.identity` and
  silently destroyed `location_and_compensation` (fixed in
  `applyToolCalls.ts`, same session — the `corrective` persona is the
  regression test for it).

## Run modes

```bash
npm run sim                              # all four personas, full run, ~$1-2
npm run sim -- --persona terse --turns 8 # one persona, capped turns — a cheap spot check
```

Requires `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in
`web/.env.local` (see `.env.example`) — the sim refuses to start without
one, before spending anything. Prints a per-persona verdict line as it
runs, then a verdict table with total tokens/cost and (only if something
failed) a failures section per persona.

**Not wired into `vitest`/CI** — it costs real money and needs a real
credential. `npm test` covers the harness's own pure logic (the repeat
detector, personas, the recovery serializer, the fake Supabase client) with
zero LLM calls; this file is what you run by hand.
