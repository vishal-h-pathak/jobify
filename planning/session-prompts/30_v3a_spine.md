# Session 30 — V3A-1: Module spine, incremental doc, background-hunt checkpoint  (V3a wave 1, parallel with 31)

**Model: Sonnet.** Vision: `planning/PRODUCT_VISION.md` §2+§5 — read first.
**Branch discipline (NEW):** worktree `jobify-wt/v3a-spine`, branch
`feat/v3a-spine` **off `feat/v3a`** (the integration branch — NOT main).
Push to origin; merges go into `feat/v3a`.
**You own:** `jobify/migrations/0011_v3a_modules.sql`,
`web/lib/onboarding/moduleRegistry.ts` (new), `web/lib/onboarding/checkpoint.ts`
(new), `web/lib/onboarding/incrementalDoc.ts` (new), `web/lib/hunt/dispatchHunt.ts`
(one param), `web/lib/supabase/types.ts` (additive), tests. Do NOT touch
`web/app/**`, `web/lib/onboarding/handleTurn.ts`, `web/lib/anthropic/**`,
`jobify/` Python, migrations 0001–0010. (Session 31 owns
`web/lib/onboarding/moduleWriters/**` + `web/app/api/onboarding/modules/**` —
it codes against YOUR registry contract, pinned below in both prompts.)

## The pinned contract (31 codes against this — do not deviate)

```ts
export type ModuleKey =
  | "anchor" | "reactions" | "values" | "dealbreakers"        // phase 1
  | "range" | "energy" | "environment" | "trajectory"
  | "evidence" | "voice" | "metrics"                          // phase 2
  | "mirror";                                                 // phase 3
export interface ModuleDefinition {
  key: ModuleKey;
  phase: 1 | 2 | 3;
  /** one-line spine receipt derived from extracted, e.g. "{title} · {company}" */
  receipt: (extracted: Record<string, unknown>) => string | null;
}
// onboarding_sessions.modules jsonb:
// { [key: ModuleKey]: { completed_at: string /*ISO*/, receipt: string } }
export function markModuleComplete(session, key, receipt): ModulesState;
export function phaseOneComplete(modules: ModulesState): boolean; // anchor+reactions+values+dealbreakers
```

## Tasks

1. **Migration `0011_v3a_modules.sql`** (additive, idempotent, house style):
   - `onboarding_sessions ADD COLUMN IF NOT EXISTS modules JSONB NOT NULL DEFAULT '{}'::jsonb;`
   - `posting_reactions` table: `user_id UUID` FK auth.users cascade,
     `posting_id TEXT` FK postings cascade, `reaction TEXT NOT NULL CHECK
     (reaction IN ('interested','not_interested'))`, `note TEXT`,
     `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, PK (user_id,
     posting_id). RLS: authed own-row SELECT/INSERT/UPDATE (users may change
     their mind), no DELETE.
2. **`moduleRegistry.ts`** — the contract above, implemented: all 12
   definitions with receipt functions (phase-2/3 receipts may return null
   until their extractors exist), `markModuleComplete`, `phaseOneComplete`.
3. **`incrementalDoc.ts`** — the v3 architectural change: the profile doc is
   assembled INCREMENTALLY, not only at finish. `buildMinimalDoc(extracted)`:
   from anchor+reactions+values+dealbreakers alone, produce a doc that
   passes the validator's REQUIRED checks (profile.yml identity from
   anchor+auth email; thesis.md from values trade-offs, reaction likes/
   dislikes ("energy signals" + "calibration examples" sections — WRITTEN
   INTO THESIS TEXT so the existing Python rubric compiler consumes them
   with zero Python changes), tiers from anchor title; disqualifiers.yml
   from dealbreakers; stubs for the rest incl. cv.md provenance stub).
   `applyModuleToDoc(doc, key, extracted)`: pure updater used as later
   modules complete (31's writers call it). Reuse existing buildDoc pieces
   — extract shared helpers rather than duplicating.
4. **`checkpoint.ts`** — `maybeFireCheckpoint(deps, session, user)`: when
   `phaseOneComplete` flips true and no profiles row exists: buildMinimalDoc
   → upsert profiles (service-role) → dispatch the background hunt →
   record `modules.checkpoint_hunt = {fired_at}` (idempotent; never fires
   twice; every failure logs + returns cleanly — onboarding must never
   crash on checkpoint failure).
5. **`dispatchHunt.ts`** — add `systemInitiated?: boolean`: skips the
   cooldown CHECK (still stamps `last_hunt_requested_at`). No other
   behavior change; existing callers unaffected.
6. **types.ts** — additive: `modules` column, `posting_reactions` table.

## Tests
Registry (all keys/phases/receipts; markModuleComplete idempotency;
phaseOneComplete matrix). buildMinimalDoc passes the real validator (fixture
test, dump-to-dir like the h3 fixture pattern); thesis text contains the
values + reaction sections. applyModuleToDoc pure/deterministic. Checkpoint:
fires once, exactly-once under repeat calls, failure-safe, dispatch called
with systemInitiated. dispatchHunt: systemInitiated skips cooldown, stamps
timestamp, default path unchanged.

## Exit criteria
Full web vitest + tsc + build green; Python suite untouched+green; scrub
gate PASS; diff inside ownership. Commit:
`V3A-1: module registry + incremental doc + background-hunt checkpoint + 0011`.
Push `feat/v3a-spine`; do NOT merge (reviewer merges into feat/v3a).
