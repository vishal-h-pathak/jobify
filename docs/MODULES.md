# V3a structured intake modules

The hosted onboarding flow (`web/`) is decomposing from one linear LLM
interview into a set of independent, zero-LLM **modules**. Each module has
its own endpoint, writes into `onboarding_sessions.extracted[key]`, and
(once a `profiles` row exists) applies a pure doc update. Module progress is
tracked in `onboarding_sessions.modules` — a jsonb map, not another stage
enum — so completing modules out of order, or re-submitting one, never
disturbs the others. See `planning/PRODUCT_VISION.md` §2 for the product
framing and `planning/session-prompts/31_v3a_modules.md` for the pinned
contract this doc mirrors.

## Module keys

```ts
type ModuleKey =
  | "anchor" | "reactions" | "values" | "dealbreakers"
  | "range" | "energy" | "environment" | "trajectory"
  | "evidence" | "voice" | "metrics" | "mirror";
```

`anchor` has its own route (`web/app/api/onboarding/anchor`, pre-existing).
`reactions` has its own route (below). This session (V3A-2) owns the five
**structured modules** — `values`, `energy`, `environment`, `trajectory`,
`dealbreakers` — served by one shared handler,
`POST /api/onboarding/modules/[key]`. The remaining keys (`range`,
`evidence`, `voice`, `metrics`, `mirror`) are out of this session's scope.

## Structured modules — `POST /api/onboarding/modules/[key]`

Auth: signed-in + (claimed invite or admin), same gate as every other
onboarding route. Per-module payload schema, receipt string, and doc writer
live in `web/lib/onboarding/moduleWriters/` — one file per module, each a
pure `applyToDoc(doc, data) -> doc` function with its own unit tests.

| key | payload | feeds |
|---|---|---|
| `values` | `{pair_id, choice: "a"\|"b"}[]`, 6-7 of the 7 server-defined trade-off pairs (`moduleWriters/values.ts::VALUE_PAIRS`) | `thesis.md` `## What matters (chosen under trade-off)` |
| `energy` | `{hours_disappear, kept_putting_off}` — two free-text answers | `thesis.md` `## Energy signals` |
| `environment` | `{team_size, pace, ambiguity, management_appetite}`, each `"a"\|"b"` against server-defined scenarios (`moduleWriters/environment.ts::ENVIRONMENT_SCENARIOS`) | `thesis.md` `## Environment preferences` |
| `trajectory` | `{direction: "climb"\|"switch"\|"stabilize"\|"experiment", free_text?}` | `thesis.md` `## Trajectory` (direction + a one-line tier hint) |
| `dealbreakers` | `{hard_disqualifiers: string[], soft_concerns?: string[]}` | `disqualifiers.yml` (`hard_disqualifiers` / `soft_concerns`, replaced wholesale) |

Re-submitting a module replaces its own section/fields — never duplicates
or merges with a prior submission. Markdown-target writers share an
idempotent section-upsert helper (`moduleWriters/sectionHelpers.ts`); the
YAML-target writer (`dealbreakers`) replaces its two array fields while
preserving any other top-level key already in the file.

## Reaction calibration — `web/app/api/onboarding/modules/reactions`

- `GET`: samples 6-8 live postings near the user's anchor title — non-
  expired, seen in the last 14 days, ranked by normalized token overlap
  between the anchor title and each posting's title (`web/lib/onboarding/
  reactions.ts::tokenOverlapScore`, no embeddings in v1). Already-reacted
  postings are excluded; ties (including zero-overlap postings, when the
  overlap pool is thin) fall back to most-recently-seen. Returns
  `id`/`title`/`company`/`location` only.
- `POST { posting_id, reaction: "interested"|"not_interested", note? }`:
  upserts a `posting_reactions` row (own-row RLS, changed minds overwrite
  the prior reaction for that posting) and mirrors a denormalized entry
  into `extracted.reactions[]`. At ≥6 total reactions the module is marked
  complete (receipt `"<n> reactions"`) and likes/dislikes (+ notes) are
  written into `thesis.md` under `## Calibration — real postings reacted
  to`.

## The completion sequence

Every module POST that changes `extracted[key]`, on success, runs the same
sequence (session 30, `feat/v3a-spine`, owns these three — pinned contract
in the session prompts, `// V3A-1 contract` comments mark the call sites):

1. `markModuleComplete(session, key, receipt)` — writes
   `onboarding_sessions.modules[key] = {completed_at, receipt}`.
2. `applyModuleToDoc(doc, key, extracted)` — only when a `profiles` row
   already exists (phase II modules can complete before the phase III
   mirror-moment interview has ever written one).
3. `maybeFireCheckpoint(deps, session, user)` — idempotent, failure-safe;
   dispatches the background hunt once `phaseOneComplete(modules)` first
   goes true (PRODUCT_VISION §2's "checkpoint: hunt #1 dispatches in the
   background").

## Zero-LLM

Every route in this doc — structured modules and reaction calibration — is
zero-LLM: no Anthropic call, no `budget_ledger` row, ever. All scoring
(trade-off pairs, scenarios, token overlap) is deterministic server-side
logic. The only LLM turns in V3a onboarding are the phase III mirror-moment
synthesis (`mirror`, out of this session) and the hunt itself (already
live, unaffected by this session).
