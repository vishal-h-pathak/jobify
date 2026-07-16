# Session 31 — V3A-2: Structured intake modules + reaction calibration  (V3a wave 1, parallel with 30)

**Model: Sonnet.** Vision: `planning/PRODUCT_VISION.md` §2 — read first.
**Branch discipline:** worktree `jobify-wt/v3a-modules`, branch
`feat/v3a-modules` **off `feat/v3a`** (NOT main). Push to origin; the
reviewer merges into `feat/v3a`.
**You own:** `web/app/api/onboarding/modules/**` (new),
`web/lib/onboarding/moduleWriters/**` (new), `web/lib/onboarding/reactions.ts`
(new), tests. Do NOT touch `web/lib/onboarding/{moduleRegistry,checkpoint,
incrementalDoc}.ts` (session 30 builds those in parallel — code against the
pinned contract below), `web/app/(app)/**`, `web/lib/anthropic/**`,
`jobify/` Python, migrations (30 owns 0011).

## The pinned contract (identical in prompt 30 — do not deviate)

```ts
export type ModuleKey =
  | "anchor" | "reactions" | "values" | "dealbreakers"
  | "range" | "energy" | "environment" | "trajectory"
  | "evidence" | "voice" | "metrics" | "mirror";
// onboarding_sessions.modules jsonb:
// { [key: ModuleKey]: { completed_at: string /*ISO*/, receipt: string } }
// 30 exports from moduleRegistry.ts:
//   markModuleComplete(session, key, receipt) / phaseOneComplete(modules)
// 30 exports from incrementalDoc.ts:
//   applyModuleToDoc(doc, key, extracted)  // pure
// 30 exports from checkpoint.ts:
//   maybeFireCheckpoint(deps, session, user)  // idempotent, failure-safe
// 30 adds table posting_reactions(user_id, posting_id,
//   reaction 'interested'|'not_interested', note, created_at, PK(user,posting))
//   with authed own-row select/insert/update RLS.
```
Import these; if 30 hasn't merged when you start, write against the
signatures above and mark the imports with a `// V3A-1 contract` comment —
integration is verified at the reviewer's merge into feat/v3a.

## Tasks — all zero-LLM (no ledger rows anywhere in this session)

1. **Structured-module endpoints** — `POST /api/onboarding/modules/[key]`
   for `values`, `energy`, `environment`, `trajectory`, `dealbreakers`:
   auth + invite-or-admin gate (existing pattern), body schema per module
   (below), write into `onboarding_sessions.extracted[key]`, call
   `markModuleComplete` with the registry receipt, `applyModuleToDoc` when a
   profiles row already exists, then `maybeFireCheckpoint`. One shared
   handler, per-module schema + writer.
2. **Module payload schemas + writers** (`moduleWriters/`):
   - `values`: 6–7 pair choices `{pair_id, choice: "a"|"b"}[]` — pairs
     defined server-side in one const (write them per PRODUCT_VISION §2.3:
     mission/prestige, hours/equity, specialist/generalist, autonomy/
     mentorship, stability/upside, IC/leadership, remote/in-person-energy).
     Writer renders a "## What matters (chosen under trade-off)" section
     into thesis.md text.
   - `energy`: two free-text answers (hours-disappear / kept-putting-off) →
     thesis "## Energy signals" additions.
   - `environment`: 4 scenario either-or picks (team size, pace, ambiguity,
     management appetite; scenarios server-side consts) → thesis section.
   - `trajectory`: one enum (climb | switch | stabilize | experiment) +
     optional free-text → thesis + tier hints.
   - `dealbreakers`: string list + optional soft-concerns → disqualifiers.yml.
   All writers are pure functions doc-in/doc-out with unit tests; thesis
   sections are APPENDED idempotently (re-submission replaces the module's
   own section, never duplicates it).
3. **Reaction calibration** (`reactions.ts` + endpoints):
   - `GET /api/onboarding/modules/reactions` → sample 6–8 postings for the
     user: non-expired, seen in the last 14 days, ranked by overlap between
     anchor title tokens and posting title (simple normalized token
     overlap; no embeddings in v1), pad with most-recent if the pool is
     thin, exclude already-reacted. Return id/title/company/location only.
   - `POST` same route: `{posting_id, reaction, note?}` → upsert
     posting_reactions row + mirror into `extracted.reactions[]`; after ≥6
     reactions, mark the module complete (receipt "6 reactions" style) and
     write likes/dislikes (+notes) into thesis via the writer
     ("## Calibration — real postings reacted to").
4. **Docs:** short `docs/MODULES.md` — module keys, payload schemas, which
   doc file each feeds, the checkpoint rule (30's), and that all of this is
   zero-LLM.

## Tests
Per-module: schema rejection matrix, writer purity + idempotent re-submit,
gate 401/403. Reactions: sampler excludes expired/reacted + token-overlap
ordering + thin-pool padding; completion at 6; upsert allows changed minds.
Checkpoint called after every module completion (spy). No ledger writes
anywhere (assert).

## Exit criteria
Full web vitest + tsc + build green; scrub gate PASS; diff inside ownership.
Commit: `V3A-2: structured intake modules (values/energy/environment/trajectory/dealbreakers) + reaction calibration`.
Push `feat/v3a-modules`; do NOT merge.
