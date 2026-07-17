# V3B-S3: Tailor Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the web UI for V3B's hosted tailor feature — a "Tailor this" entry point on match cards and a `/tailor/[runId]` viewer that shows the generated resume/cover letter side-by-side with per-claim source chips and a always-visible honesty drawer for anything the verifier dropped.

**Architecture:** Pure client-side consumption of S2's already-merged `web/lib/tailor/**` logic and three API routes (`POST /api/tailor/run`, `GET /api/tailor/runs`, `GET /api/tailor/materials/[runId]`). No new backend surface. All non-trivial logic (state derivation, id-based grouping, outcome copy) is factored into small exported pure functions, colocated with the component that uses them and unit-tested directly — this repo's vitest environment is `"node"` (no jsdom/RTL), so `.tsx` files are only ever imported for their pure exports in tests, never rendered to a DOM.

**Tech Stack:** Next.js 16 (App Router, `params`/`searchParams` are `Promise`s), React 19, TypeScript, Tailwind v4 CSS-variable theme, Vitest 3.

## Global Constraints

- **Branch/worktree:** `feat/v3b-s3-ui`, already checked out in this worktree, based on `main` post S1+S2 merge. Commit after every task.
- **Ownership — create/modify only:**
  - `web/components/feed/MatchCard.tsx` (modify) + `web/components/feed/TailorAction.tsx` (new) — the design doc's S3 decomposition (§4) explicitly names "`MatchCard` 'Tailor this'/'Materials' affordances" as S3's; the session prompt's `web/app/(app)/feed/**` glob is shorthand for this same feature area even though the component file itself lives under `web/components/feed/`.
  - `web/app/(app)/feed/tailorOutcome.ts` (+ test) — new, mirrors the existing `web/app/(app)/feed/huntOutcome.ts` pattern.
  - `web/app/(app)/tailor/**` (new route) and `web/components/tailor/**` (new components) — everything else in this plan.
  - Do **NOT** modify `web/lib/tailor/**`, `web/lib/materials/**`, `web/lib/supabase/types.ts`, any `web/app/api/**` route, `jobify/`, onboarding, dossier, settings, or migrations. Read-only access to all of those is fine and expected (this plan was written by reading them).
- **Route naming — use `/tailor/[runId]`, not `/materials/[postingId]`.** `planning/V3B_DESIGN.md` §3.1/§3.5 sketches a posting-keyed `/materials/[postingId]` page plus a separate `/materials` index. The session prompt (the literal, binding task brief for this session) instead says `web/app/(app)/tailor/**` and `/tailor/[runId]`, and does not mention a `/materials` index anywhere in its ownership or Build list. This matches precedent already committed to `main`: S2's `GET /api/tailor/materials/[runId]` route is itself run-keyed, and its own doctring says plainly "this intentionally supersedes `V3B_DESIGN.md` §1.4's ... line — the session prompt is the binding directive." Follow the same resolution here. **Do not build a `/materials` index page** — out of this session's scope.
- **Entry link carries `postingId` as a search param:** `/tailor/${runId}?posting=${postingId}`. `GET /api/tailor/materials/[runId]` never returns `posting_id` in its response (`{urls: ...}` only), and the only run-status poll route (`GET /api/tailor/runs`) is keyed by `posting_id`, not `runId` — so posting context has to travel with the link, not be derived from the route.
- **Regenerate is a single, full re-run with no steer note.** `dispatchTailor`'s `DispatchTailorDeps` (`web/lib/tailor/dispatchTailor.ts`) has no `feedback` parameter — S2 did not wire the `tailor_runs.feedback` column through the dispatch path, so a "steer note" cannot be sent without modifying S2's owned file, which is out of scope. The session prompt's own Build step 4 says "regenerate (full re-run, ...)" — singular, no note — so this is not a gap, it's what's asked.
- **No new identity/contact header.** `tailored.json` never carries name/email/location — those are assembled straight from `profile.yml` by the Python LaTeX path and never touch storage. The resume viewer renders only what's in `tailored.json`/`claims.json` (experience/education/skills/summary). Do not add a profile/identity fetch — it's both out of ownership (`web/lib/db/profiles.ts` etc.) and not requested by the session prompt.
- **Test environment is Node, not jsdom.** `web/vitest.config.ts` sets `test.environment: "node"`. Never add `@testing-library/react` or attempt to render a component to a DOM. Instead:
  - Put all non-trivial logic in small, named, exported functions colocated in the same file as the component that uses them (this repo's existing convention — see `web/components/onboarding/CalibrationPanel.tsx` exporting both the component and `calibrationAnswersValid`/`parseCalibrationPrompts`/etc.). Unit-test those functions directly.
  - Where a `page.tsx` is a plain `async function` (server component), it can be called directly as a function and its return value (a React element, i.e. a plain object) inspected via `.type`/`.props` without rendering — see `web/app/invite/page.test.tsx` for the exact pattern (`vi.mock` its imports, call `Page({params, searchParams})`, assert on `result.props.children`).
  - Client (`"use client"`) components with hooks are **not** directly unit-tested anywhere in this repo (no `MatchCard.test.tsx` exists despite `MatchCard.tsx` having hooks) — their pure helper exports are what's tested. Follow this precedent for `TailorAction.tsx` and `TailorViewer.tsx`.
- **Scrub gate** (`scripts/scrub_gate.sh`) forbids, case-insensitively, the operator's real name, employer, domain, and a handful of other identifying strings — see the script's own `PATTERN` variable for the exact list, never reproduce it literally elsewhere in the tree (this plan file included). Every test fixture uses the neutral persona **"Alex Quinn"** (`email: "alex@example.com"`), matching existing fixtures (`web/app/(app)/profile/page.test.tsx`, `web/lib/dossier/applyLogisticsToDoc.test.ts`).
- **Design tokens** (`web/app/globals.css` `@theme inline`, fixed dark theme): `bg-base`, `bg-surface`, `border-line`, `text-ink`, `text-ink-muted`, `text-amber` / `bg-amber` / `hover:bg-amber-hover`, `text-success`, `text-danger`, `text-badge-blue`. **Amber is rationed** — default/inactive states stay `ink-muted`; full-strength amber is reserved for hover, the metric-number highlight, and the one emotional beat below. Reuse the existing `.rail-sweep` CSS class (`app/globals.css`, a 600ms one-shot amber sweep, already guarded by `prefers-reduced-motion`) on the viewer's succeeded-state container as "the mirror-grade moment when materials first resolve" — do not define a new keyframe.
- **Reuse shared primitives** from `web/components/ui/`: `Card` (`variant="default"|"quiet"|"elevated"`), `Button` (`variant="primary"|"secondary"|"ghost"|"danger-ghost"`, `busy` prop shows a `Spinner`), `Badge` (`tone="amber"|"blue"|"neutral"|"success"|"danger"`), `Banner` (`tone="info"|"warn"|"danger"`, renders `role="alert"`), `EmptyState`, `Spinner`.
- **Exact data shapes** (verified against the actual S1/S2 code, not the design doc's earlier sketch — use these verbatim):
  - `PolledTailorRun` (`web/lib/tailor/pollRuns.ts`): `{id: string; status: "queued"|"running"|"succeeded"|"failed"; mode: "tailor"|"render"; template: string|null; feedback: string|null; progress: Array<{step:string; label:string; at:string}>; dropped_count: number|null; error: string|null; cost_usd: number|null; created_at: string; updated_at: string}`. `GET /api/tailor/runs?posting_id=<id>` → 200 `{runs: PolledTailorRun[]}`, ordered `created_at` desc (newest first).
  - `POST /api/tailor/run` body `{posting_id: string; mode?: "tailor"|"render"; template?: string}` → 200 `{ok:true, run_id:string}` | 503 `{error:"tailor dispatch is not configured"}` | 429 `{error:"budget_exceeded"}` | 429 `{error:"daily_limit", count:number}` | 429 `{error:"cooldown"}` | 502 `{error:"dispatch failed"}`. No response ever carries a retry timestamp for tailor (unlike hunt's `cooldown_until`) — never fabricate one in UI copy.
  - `GET /api/tailor/materials/[runId]` → 200 `{urls: Record<string,string>}` (keys drawn from `resume.pdf`, `cover_letter.pdf`, `cover_letter.txt`, `tailored.json`, `claims.json`, `render_meta.json` — only the ones that exist) | 404 `{error:"not found"}` (covers: doesn't exist, belongs to another user, or `status !== "succeeded"` — all identical, by design).
  - Worker progress steps, exact `step` → `label`, fixed order (`jobify/hosted/tailoring.py:538-631`): `profile`→"reading your profile", `frame`→"choosing the frame", `resume`→"drafting the resume", `cover_letter`→"writing the cover letter", `verify`→"checking every claim against your profile", `render`→"rendering PDFs". **No live claim-count exists mid-run** — `dropped_count` is only set when the row transitions to `succeeded`. Do not show a running tally during the verify stage.
  - `tailored.json` (the persisted, post-trim, post-strip shape — no `*_sources` fields survive to storage): `{skills: Record<string,string>; skills_layout?: "auto"|"compact"|"wide"|"stacked"|null; experience: Array<{org:string; title:string; location:string; period:string; projects: Array<{name:string|null; period:string; bullets:string[]}>}>; education: Array<{school:string; degree:string; period:string}>; summary_line: string|null}`.
  - `claims.json`: `{version:1; doc_sha256:string; units: ClaimUnit[]; dropped: DroppedUnit[]}`. `ClaimUnit = {id:string; surface:"resume"|"cover_letter"; kind:"bullet"|"skill"|"header"|"edu"|"summary"|"cl_sentence"|"voice"; text?:string; sources?:Array<{file:string; quote:string; start_line?:number; end_line?:number}>; fields?:Record<string,string>; numbers?:Array<{token:string; basis:string}>; status:"verified"|"user_edited"}`. The verifier (`jobify/tailor/claims.py`) only ever emits `status:"verified"`; `status:"user_edited"` is a **client-side-only overlay** this plan applies in memory after an inline edit — there is no backend persistence route, so never attempt to write it back. `kind:"voice"` units are cover-letter connective sentences exempt from sourcing — render a muted "your voice" chip, no quote popover. `DroppedUnit = {id:string; text:string; reason:"number_not_confirmed"|"missing_span"|"new_entity"}` — exact literal values confirmed against `jobify/tailor/claims.py`'s `REASON_*` constants.
  - Claim-unit id scheme (`jobify/hosted/tailoring.py:227-327`): `r.exp{i}.header`, `r.exp{i}.b{j}` (`j` = a running bullet index across **all** of that experience's projects, not per-project), `r.edu{i}`, `r.skill{i}` (`i` = 0-based index over `skills`'s key insertion order), `r.summary` (only present if `summary_line` is non-null). Cover letter: `cl.s{i}`, sentence order. **Grouping/ordering for rendering must be derived by parsing these ids from `claims.json.units`, never by walking `tailored.json`'s array positions** — filtering removes dropped entries, so post-filter array indices no longer match the original `i`/`j` the ids were minted from.
  - The 5 resume templates (`jobify/resume_templates/__init__.py`), exact `id` → label: `classic`→"Classic", `modern`→"Modern", `compact`→"Compact", `accent`→"Accent", `executive`→"Executive".

---

## File Structure

```
web/app/(app)/feed/tailorOutcome.ts          new — POST /api/tailor/run response → UI outcome
web/app/(app)/feed/tailorOutcome.test.ts     new
web/components/feed/TailorAction.tsx         new — the match-card affordance (client)
web/components/feed/MatchCard.tsx            modify — renders <TailorAction>
web/components/tailor/types.ts               new — shared types + deriveTailorState + constants
web/components/tailor/types.test.ts          new
web/components/tailor/SourceChip.tsx         new — hover chip + claimChipLabel/highlightNumbers (pure, exported)
web/components/tailor/SourceChip.test.ts     new
web/components/tailor/ResumeView.tsx         new — groupResumeUnits (pure, exported) + resume renderer
web/components/tailor/ResumeView.test.ts     new
web/components/tailor/CoverLetterView.tsx    new — orderCoverLetterUnits (pure, exported) + CL renderer
web/components/tailor/CoverLetterView.test.ts new
web/components/tailor/HonestyDrawer.tsx      new — summarizeDropped (pure, exported) + drawer
web/components/tailor/HonestyDrawer.test.ts  new
web/components/tailor/TemplateSwitcher.tsx   new — dispatchRender (pure, exported) + template picker
web/components/tailor/TemplateSwitcher.test.ts new
web/app/(app)/tailor/[runId]/page.tsx        new — server component: params/searchParams → <TailorViewer>
web/app/(app)/tailor/[runId]/page.test.ts    new
web/app/(app)/tailor/[runId]/TailorViewer.tsx new — client: polling, generating/failed/succeeded states
web/app/(app)/tailor/[runId]/TailorViewer.test.ts new
```

---

### Task 1: `tailorOutcome.ts` — dispatch response → UI outcome

**Files:**
- Create: `web/app/(app)/feed/tailorOutcome.ts`
- Test: `web/app/(app)/feed/tailorOutcome.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `TailorOutcome` type and `interpretTailorResponse(status, body)`, imported by Task 3 (`TailorAction.tsx`) and Task 9 (regenerate button in `TailorViewer.tsx`).

- [ ] **Step 1: Write the failing test**

```ts
// web/app/(app)/feed/tailorOutcome.test.ts
import { describe, expect, it } from "vitest";
import { interpretTailorResponse } from "./tailorOutcome";

describe("interpretTailorResponse", () => {
  it("2xx returns started with the run id", () => {
    expect(interpretTailorResponse(200, { ok: true, run_id: "run-1" })).toEqual({
      kind: "started",
      runId: "run-1",
    });
  });

  it("429 daily_limit returns a count-aware message", () => {
    expect(interpretTailorResponse(429, { error: "daily_limit", count: 5 })).toEqual({
      kind: "daily_limit",
      message: "You've used 5 tailors today — try again tomorrow.",
    });
  });

  it("429 daily_limit singularizes count 1", () => {
    expect(interpretTailorResponse(429, { error: "daily_limit", count: 1 })).toEqual({
      kind: "daily_limit",
      message: "You've used 1 tailor today — try again tomorrow.",
    });
  });

  it("429 cooldown returns a qualitative message, never a fabricated time", () => {
    expect(interpretTailorResponse(429, { error: "cooldown" })).toEqual({
      kind: "cooldown",
      message: "This posting is already generating — check back in a bit.",
    });
  });

  it("429 budget_exceeded returns the shared-budget message", () => {
    expect(interpretTailorResponse(429, { error: "budget_exceeded" })).toEqual({
      kind: "budget_exceeded",
      message: "This month's shared budget is used up — try again next month.",
    });
  });

  it("503 not_configured returns a config error", () => {
    expect(interpretTailorResponse(503, { error: "tailor dispatch is not configured" })).toEqual({
      kind: "error",
      message: "Tailoring isn't configured yet — try again later.",
    });
  });

  it("502 dispatch_failed falls back to the body's error text", () => {
    expect(interpretTailorResponse(502, { error: "dispatch failed" })).toEqual({
      kind: "error",
      message: "dispatch failed",
    });
  });

  it("unrecognized error body falls back to a generic message", () => {
    expect(interpretTailorResponse(500, {})).toEqual({
      kind: "error",
      message: "Something went wrong.",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run app/\(app\)/feed/tailorOutcome.test.ts`
Expected: FAIL — `Cannot find module './tailorOutcome'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// web/app/(app)/feed/tailorOutcome.ts

export type TailorOutcome =
  | { kind: "started"; runId: string }
  | { kind: "cooldown"; message: string }
  | { kind: "daily_limit"; message: string }
  | { kind: "budget_exceeded"; message: string }
  | { kind: "error"; message: string };

/**
 * Maps a `POST /api/tailor/run` response to the button's next state.
 * Unlike hunt's cooldown (`feed/huntOutcome.ts`'s `formatCooldownTime`),
 * tailor's 429s carry no `cooldown_until` timestamp anywhere in the route
 * response (`web/app/api/tailor/run/route.ts`) — copy here stays
 * qualitative on purpose instead of fabricating a retry clock time.
 */
export function interpretTailorResponse(
  status: number,
  body: { error?: string; count?: number; run_id?: string }
): TailorOutcome {
  if (status >= 200 && status < 300) {
    return { kind: "started", runId: body.run_id ?? "" };
  }
  if (status === 429 && body.error === "daily_limit") {
    const count = body.count ?? 0;
    return {
      kind: "daily_limit",
      message: `You've used ${count} tailor${count === 1 ? "" : "s"} today — try again tomorrow.`,
    };
  }
  if (status === 429 && body.error === "cooldown") {
    return { kind: "cooldown", message: "This posting is already generating — check back in a bit." };
  }
  if (status === 429 && body.error === "budget_exceeded") {
    return { kind: "budget_exceeded", message: "This month's shared budget is used up — try again next month." };
  }
  if (status === 503) {
    return { kind: "error", message: "Tailoring isn't configured yet — try again later." };
  }
  return { kind: "error", message: body.error ?? "Something went wrong." };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run app/\(app\)/feed/tailorOutcome.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add web/app/\(app\)/feed/tailorOutcome.ts web/app/\(app\)/feed/tailorOutcome.test.ts
git commit -m "V3B-S3: tailor dispatch outcome grammar"
```

---

### Task 2: Shared tailor types + `deriveTailorState`

**Files:**
- Create: `web/components/tailor/types.ts`
- Test: `web/components/tailor/types.test.ts`

**Interfaces:**
- Consumes: `PolledTailorRun` from `@/lib/tailor/pollRuns` (S2, read-only).
- Produces: `ClaimUnit`, `DroppedUnit`, `ClaimsJson`, `TailoredResume` (+ nested types), `DROPPED_REASON_COPY`, `TAILOR_STAGES`, `TEMPLATE_OPTIONS`, `TailorCardState`, `deriveTailorState(runs)` — consumed by every later task in this plan.

- [ ] **Step 1: Write the failing test**

```ts
// web/components/tailor/types.test.ts
import { describe, expect, it } from "vitest";
import { deriveTailorState, TAILOR_STAGES, TEMPLATE_OPTIONS } from "./types";

describe("deriveTailorState", () => {
  it("no runs → tailorable", () => {
    expect(deriveTailorState([])).toEqual({ kind: "tailorable" });
  });

  it("only failed runs → tailorable (retry is just a fresh tailor)", () => {
    expect(deriveTailorState([{ id: "r1", status: "failed" }])).toEqual({ kind: "tailorable" });
  });

  it("a queued run → generating, with its id", () => {
    expect(deriveTailorState([{ id: "r1", status: "queued" }])).toEqual({
      kind: "generating",
      runId: "r1",
    });
  });

  it("a running run → generating, with its id", () => {
    expect(deriveTailorState([{ id: "r1", status: "running" }])).toEqual({
      kind: "generating",
      runId: "r1",
    });
  });

  it("an active run always wins over an older succeeded one", () => {
    expect(
      deriveTailorState([
        { id: "new", status: "running" },
        { id: "old", status: "succeeded" },
      ])
    ).toEqual({ kind: "generating", runId: "new" });
  });

  it("only succeeded runs → materials, latest (first in the desc-ordered list) wins", () => {
    expect(
      deriveTailorState([
        { id: "latest", status: "succeeded" },
        { id: "earlier", status: "succeeded" },
      ])
    ).toEqual({ kind: "materials", runId: "latest" });
  });

  it("a failed run does not block an older succeeded one from showing materials", () => {
    expect(
      deriveTailorState([
        { id: "retry-failed", status: "failed" },
        { id: "old-success", status: "succeeded" },
      ])
    ).toEqual({ kind: "materials", runId: "old-success" });
  });
});

describe("TAILOR_STAGES", () => {
  it("has the 6 worker-emitted steps in worker order", () => {
    expect(TAILOR_STAGES.map((s) => s.step)).toEqual([
      "profile",
      "frame",
      "resume",
      "cover_letter",
      "verify",
      "render",
    ]);
  });
});

describe("TEMPLATE_OPTIONS", () => {
  it("has the 5 resume template ids", () => {
    expect(TEMPLATE_OPTIONS.map((t) => t.id)).toEqual(["classic", "modern", "compact", "accent", "executive"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/tailor/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// web/components/tailor/types.ts
import type { PolledTailorRun } from "@/lib/tailor/pollRuns";

export interface SourceRef {
  file: string;
  quote: string;
  start_line?: number;
  end_line?: number;
}

export interface NumberToken {
  token: string;
  basis: string;
}

export type ClaimUnitKind = "bullet" | "skill" | "header" | "edu" | "summary" | "cl_sentence" | "voice";
export type ClaimUnitStatus = "verified" | "user_edited";

export interface ClaimUnit {
  id: string;
  surface: "resume" | "cover_letter";
  kind: ClaimUnitKind;
  text?: string;
  sources?: SourceRef[];
  fields?: Record<string, string>;
  numbers?: NumberToken[];
  status: ClaimUnitStatus;
}

export type DroppedReason = "number_not_confirmed" | "missing_span" | "new_entity";

export interface DroppedUnit {
  id: string;
  text: string;
  reason: DroppedReason;
}

export interface ClaimsJson {
  version: 1;
  doc_sha256: string;
  units: ClaimUnit[];
  dropped: DroppedUnit[];
}

export interface TailoredProject {
  name: string | null;
  period: string;
  bullets: string[];
}

export interface TailoredExperience {
  org: string;
  title: string;
  location: string;
  period: string;
  projects: TailoredProject[];
}

export interface TailoredEducation {
  school: string;
  degree: string;
  period: string;
}

export interface TailoredResume {
  skills: Record<string, string>;
  skills_layout?: "auto" | "compact" | "wide" | "stacked" | null;
  experience: TailoredExperience[];
  education: TailoredEducation[];
  summary_line: string | null;
}

export const DROPPED_REASON_COPY: Record<DroppedReason, string> = {
  number_not_confirmed: "number not in your confirmed metrics",
  missing_span: "no matching line in your profile",
  new_entity: "mentions something not in your profile",
};

export const TAILOR_STAGES: Array<{ step: string; label: string }> = [
  { step: "profile", label: "reading your profile" },
  { step: "frame", label: "choosing the frame" },
  { step: "resume", label: "drafting the resume" },
  { step: "cover_letter", label: "writing the cover letter" },
  { step: "verify", label: "checking every claim against your profile" },
  { step: "render", label: "rendering PDFs" },
];

export interface TemplateOption {
  id: string;
  label: string;
}

export const TEMPLATE_OPTIONS: TemplateOption[] = [
  { id: "classic", label: "Classic" },
  { id: "modern", label: "Modern" },
  { id: "compact", label: "Compact" },
  { id: "accent", label: "Accent" },
  { id: "executive", label: "Executive" },
];

export type TailorCardState =
  | { kind: "tailorable" }
  | { kind: "generating"; runId: string }
  | { kind: "materials"; runId: string };

/**
 * Derives the match-card's tailor affordance from its runs (already
 * newest-first, matching what `GET /api/tailor/runs?posting_id=` returns).
 * An active run always wins over an older succeeded one — only one run can
 * be active per posting (the DB's unique partial index), so this never has
 * to arbitrate between two simultaneously-active runs.
 */
export function deriveTailorState(runs: Pick<PolledTailorRun, "id" | "status">[]): TailorCardState {
  const active = runs.find((r) => r.status === "queued" || r.status === "running");
  if (active) return { kind: "generating", runId: active.id };
  const succeeded = runs.find((r) => r.status === "succeeded");
  if (succeeded) return { kind: "materials", runId: succeeded.id };
  return { kind: "tailorable" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/tailor/types.test.ts`
Expected: PASS, 10/10.

- [ ] **Step 5: Commit**

```bash
git add web/components/tailor/types.ts web/components/tailor/types.test.ts
git commit -m "V3B-S3: shared tailor types + card-state derivation"
```

---

### Task 3: MatchCard "Tailor this" / "Materials" / "Generating" affordance

**Files:**
- Create: `web/components/feed/TailorAction.tsx`
- Modify: `web/components/feed/MatchCard.tsx`

**Interfaces:**
- Consumes: `deriveTailorState`, `TailorCardState` (Task 2); `interpretTailorResponse` (Task 1); `PolledTailorRun` (S2, read-only).
- Produces: `<TailorAction postingId={string} />`, rendered from `MatchCard`.

No dedicated test file — the state-derivation and outcome-mapping logic this component wires together is already exhaustively covered by Task 1's and Task 2's pure-function tests (this repo's existing convention: `MatchCard.tsx` itself, with its own `useState`/async handlers, has no test file either — see `web/components/feed/` today). This task's own verification is the type-check in Step 3.

- [ ] **Step 1: Write `TailorAction.tsx`**

```tsx
// web/components/feed/TailorAction.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { deriveTailorState, type TailorCardState } from "@/components/tailor/types";
import { interpretTailorResponse } from "@/app/(app)/feed/tailorOutcome";
import type { PolledTailorRun } from "@/lib/tailor/pollRuns";

function tailorHref(runId: string, postingId: string): string {
  return `/tailor/${runId}?posting=${encodeURIComponent(postingId)}`;
}

export function TailorAction({ postingId }: { postingId: string }) {
  const [state, setState] = useState<TailorCardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tailor/runs?posting_id=${encodeURIComponent(postingId)}`)
      .then((res) => res.json())
      .then((body: { runs: PolledTailorRun[] }) => {
        if (!cancelled) setState(deriveTailorState(body.runs ?? []));
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "tailorable" });
      });
    return () => {
      cancelled = true;
    };
  }, [postingId]);

  async function startTailor() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/tailor/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posting_id: postingId, mode: "tailor" }),
    });
    const body = await res.json();
    const outcome = interpretTailorResponse(res.status, body);
    setBusy(false);
    if (outcome.kind === "started") {
      window.location.href = tailorHref(outcome.runId, postingId);
      return;
    }
    setMessage(outcome.message);
  }

  if (state === null) return null;

  if (state.kind === "generating") {
    return (
      <Link
        href={tailorHref(state.runId, postingId)}
        className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
      >
        Generating…
      </Link>
    );
  }

  if (state.kind === "materials") {
    return (
      <Link
        href={tailorHref(state.runId, postingId)}
        className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-amber hover:text-amber-hover"
      >
        Materials
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="ghost" busy={busy} onClick={startTailor}>
        Tailor this
      </Button>
      {message && <p className="text-xs text-ink-muted">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `MatchCard.tsx`**

Add the import alongside the existing ones:

```tsx
import { TailorAction } from "./TailorAction";
```

In the actions row (the `<div className="flex flex-wrap gap-2 pt-1">` block), add `<TailorAction>` for every state except `dismissed` (per the Build spec: "on match cards (all groups except dismissed)"). Insert it as the first child of that row, before the existing `Save`/`Dismiss`/`I applied` buttons:

```tsx
      <div className="flex flex-wrap gap-2 pt-1">
        {state !== "dismissed" && <TailorAction postingId={match.posting_id} />}
        {state === "dismissed" ? (
          <Button
            variant="ghost"
            onClick={() => transition("seen", () => undismissMatch(supabase, match.user_id, match.posting_id))}
          >
            Undo
          </Button>
        ) : (
          <>
            {/* ... existing Save/Dismiss/I applied buttons, unchanged ... */}
          </>
        )}
      </div>
```

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add web/components/feed/TailorAction.tsx web/components/feed/MatchCard.tsx
git commit -m "V3B-S3: Tailor this / Materials / Generating on match cards"
```

---

### Task 4: `SourceChip` + `ResumeView`

**Files:**
- Create: `web/components/tailor/SourceChip.tsx`
- Test: `web/components/tailor/SourceChip.test.ts`
- Create: `web/components/tailor/ResumeView.tsx`
- Test: `web/components/tailor/ResumeView.test.ts`

**Interfaces:**
- Consumes: `ClaimUnit`, `NumberToken` (Task 2).
- Produces: `claimChipLabel(unit)`, `highlightNumbers(text, numbers)`, `<SourceChip unit={ClaimUnit} />`; `groupResumeUnits(units)`, `<ResumeView units={ClaimUnit[]} onEdit?={(id, text) => void} />` (the optional `onEdit` renders a per-unit "Edit" affordance for `text`-bearing units — bullets/skills/summary; structural header/edu units have no free-text surface and are never editable) — `ResumeView` is consumed by Task 9's `TailorViewer`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/components/tailor/SourceChip.test.ts
import { describe, expect, it } from "vitest";
import { claimChipLabel, highlightNumbers } from "./SourceChip";
import type { ClaimUnit } from "./types";

function unit(overrides: Partial<ClaimUnit>): ClaimUnit {
  return { id: "r.exp0.b0", surface: "resume", kind: "bullet", status: "verified", ...overrides };
}

describe("claimChipLabel", () => {
  it("a verified bullet with a cv.md source, with a line number", () => {
    expect(
      claimChipLabel(unit({ sources: [{ file: "cv.md", quote: "...", start_line: 41 }] }))
    ).toBe("from your resume, line 41");
  });

  it("a verified unit with a source but no line number", () => {
    expect(claimChipLabel(unit({ sources: [{ file: "cv.md", quote: "..." }] }))).toBe("from your resume");
  });

  it("a voice cover-letter sentence has no source and reads 'your voice'", () => {
    expect(claimChipLabel(unit({ kind: "voice", surface: "cover_letter" }))).toBe("your voice");
  });

  it("a user-edited unit always reads 'yours', even if it still carries old sources", () => {
    expect(
      claimChipLabel(unit({ status: "user_edited", sources: [{ file: "cv.md", quote: "..." }] }))
    ).toBe("yours");
  });

  it("a unit with no sources array falls back to 'unsourced'", () => {
    expect(claimChipLabel(unit({}))).toBe("unsourced");
  });
});

describe("highlightNumbers", () => {
  it("no numbers → the text passes through as one non-metric segment", () => {
    expect(highlightNumbers("just words", [])).toEqual([{ text: "just words", isMetric: false }]);
  });

  it("splits out each number token as its own metric segment", () => {
    expect(
      highlightNumbers("Cut p95 from 2.1s to 380ms on Jetson Orin", [
        { token: "2.1s", basis: "confirmed_metric" },
        { token: "380ms", basis: "confirmed_metric" },
      ])
    ).toEqual([
      { text: "Cut p95 from ", isMetric: false },
      { text: "2.1s", isMetric: true },
      { text: " to ", isMetric: false },
      { text: "380ms", isMetric: true },
      { text: " on Jetson Orin", isMetric: false },
    ]);
  });

  it("escapes regex-special characters in tokens (e.g. a bare $ amount)", () => {
    expect(highlightNumbers("Saved $2.5M annually", [{ token: "$2.5M", basis: "confirmed_metric" }])).toEqual([
      { text: "Saved ", isMetric: false },
      { text: "$2.5M", isMetric: true },
      { text: " annually", isMetric: false },
    ]);
  });
});
```

```ts
// web/components/tailor/ResumeView.test.ts
import { describe, expect, it } from "vitest";
import { groupResumeUnits } from "./ResumeView";
import type { ClaimUnit } from "./types";

const ALEX_QUINN_UNITS: ClaimUnit[] = [
  {
    id: "r.summary",
    surface: "resume",
    kind: "summary",
    text: "Product manager focused on developer tools.",
    sources: [{ file: "cv.md", quote: "Product manager focused on developer tools." }],
    status: "verified",
  },
  {
    id: "r.exp0.header",
    surface: "resume",
    kind: "header",
    fields: { org: "Acme Corp", title: "Senior PM", location: "Remote", period: "2022–Present" },
    status: "verified",
  },
  {
    id: "r.exp0.b0",
    surface: "resume",
    kind: "bullet",
    text: "Shipped a self-serve onboarding flow, cutting time-to-value from 14 days to 3 days.",
    sources: [{ file: "cv.md", quote: "onboarding flow ... 14 days to 3 days", start_line: 12 }],
    numbers: [{ token: "14 days", basis: "confirmed_metric" }, { token: "3 days", basis: "confirmed_metric" }],
    status: "verified",
  },
  {
    id: "r.exp0.b1",
    surface: "resume",
    kind: "bullet",
    text: "Led a cross-functional team of 6 engineers.",
    sources: [{ file: "cv.md", quote: "team of 6 engineers", start_line: 18 }],
    status: "verified",
  },
  { id: "r.edu0", surface: "resume", kind: "edu", fields: { school: "State University", degree: "B.S. Computer Science", period: "2014–2018" }, status: "verified" },
  { id: "r.skill0", surface: "resume", kind: "skill", text: "SQL, Amplitude, Figma", sources: [], status: "verified" },
];

describe("groupResumeUnits", () => {
  it("groups a header with its bullets under one experience, ordered by parsed bullet index", () => {
    const grouped = groupResumeUnits(ALEX_QUINN_UNITS);
    expect(grouped.experience).toHaveLength(1);
    expect(grouped.experience[0].header?.id).toBe("r.exp0.header");
    expect(grouped.experience[0].bullets.map((b) => b.id)).toEqual(["r.exp0.b0", "r.exp0.b1"]);
  });

  it("collects education and skill units, ordered by parsed index", () => {
    const grouped = groupResumeUnits(ALEX_QUINN_UNITS);
    expect(grouped.education.map((e) => e.id)).toEqual(["r.edu0"]);
    expect(grouped.skills.map((s) => s.id)).toEqual(["r.skill0"]);
  });

  it("picks out the summary unit by its fixed id", () => {
    expect(groupResumeUnits(ALEX_QUINN_UNITS).summary?.id).toBe("r.summary");
  });

  it("summary is null when no r.summary unit is present", () => {
    expect(groupResumeUnits(ALEX_QUINN_UNITS.filter((u) => u.id !== "r.summary")).summary).toBeNull();
  });

  it("drops an experience whose header did not survive, even if a bullet unit is present (defensive backstop)", () => {
    const orphanBullet: ClaimUnit = {
      id: "r.exp1.b0",
      surface: "resume",
      kind: "bullet",
      text: "orphan",
      status: "verified",
    };
    const grouped = groupResumeUnits([...ALEX_QUINN_UNITS, orphanBullet]);
    expect(grouped.experience.map((e) => e.index)).toEqual([0]);
  });

  it("ignores cover-letter units entirely", () => {
    const clUnit: ClaimUnit = { id: "cl.s0", surface: "cover_letter", kind: "voice", text: "Hi.", status: "verified" };
    const grouped = groupResumeUnits([...ALEX_QUINN_UNITS, clUnit]);
    expect(grouped.experience).toHaveLength(1);
    expect(grouped.skills).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run components/tailor/SourceChip.test.ts components/tailor/ResumeView.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `SourceChip.tsx`**

```tsx
// web/components/tailor/SourceChip.tsx
"use client";

import { useState } from "react";
import type { ClaimUnit, NumberToken } from "./types";

const FILE_LABELS: Record<string, string> = { "cv.md": "your resume" };

function fileLabel(file: string): string {
  return FILE_LABELS[file] ?? file;
}

/** The chip's visible text — never renders a quote itself, only the receipt. */
export function claimChipLabel(unit: ClaimUnit): string {
  if (unit.status === "user_edited") return "yours";
  if (unit.kind === "voice") return "your voice";
  const source = unit.sources?.[0];
  if (!source) return "unsourced";
  return source.start_line ? `from ${fileLabel(source.file)}, line ${source.start_line}` : `from ${fileLabel(source.file)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits `text` around every confirmed number token so the caller can style
 * the metric segments distinctly (the amber metric-chip look, §3.3). A unit
 * with no numbers passes through untouched as a single non-metric segment.
 */
export function highlightNumbers(text: string, numbers: NumberToken[] = []): Array<{ text: string; isMetric: boolean }> {
  const tokens = numbers.map((n) => n.token).filter(Boolean);
  if (tokens.length === 0) return [{ text, isMetric: false }];
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "g");
  return text.split(pattern).map((part) => ({ text: part, isMetric: tokens.includes(part) }));
}

export function SourceChip({ unit }: { unit: ClaimUnit }) {
  const [open, setOpen] = useState(false);
  const label = claimChipLabel(unit);
  const source = unit.sources?.[0];
  const isYours = unit.status === "user_edited";
  const isVoice = unit.kind === "voice";

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
          isYours || isVoice
            ? "border-line text-ink-muted"
            : "border-line text-ink-muted hover:border-amber hover:text-amber"
        }`}
      >
        {label}
      </button>
      {open && source && (
        <span className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-line bg-surface p-2 text-xs text-ink shadow-lg shadow-black/20">
          &ldquo;{source.quote}&rdquo;
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Write `ResumeView.tsx`**

```tsx
// web/components/tailor/ResumeView.tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { SourceChip, highlightNumbers } from "./SourceChip";
import type { ClaimUnit } from "./types";

const EXP_HEADER_RE = /^r\.exp(\d+)\.header$/;
const EXP_BULLET_RE = /^r\.exp(\d+)\.b(\d+)$/;
const EDU_RE = /^r\.edu(\d+)$/;
const SKILL_RE = /^r\.skill(\d+)$/;

export interface ResumeExperienceGroup {
  index: number;
  header: ClaimUnit | null;
  bullets: ClaimUnit[];
}

export interface ResumeSections {
  experience: ResumeExperienceGroup[];
  education: ClaimUnit[];
  skills: ClaimUnit[];
  summary: ClaimUnit | null;
}

/**
 * Groups `claims.json`'s flat `units[]` back into resume sections by
 * parsing the id scheme (`r.exp{i}.header`/`r.exp{i}.b{j}`/`r.edu{i}`/
 * `r.skill{i}`/`r.summary`) rather than walking `tailored.json`'s array
 * positions — filtering removes dropped entries, so post-filter array
 * indices no longer line up with the `i`/`j` the ids were minted from.
 */
export function groupResumeUnits(units: ClaimUnit[]): ResumeSections {
  const resumeUnits = units.filter((u) => u.surface === "resume");
  const experienceMap = new Map<number, ResumeExperienceGroup>();

  for (const unit of resumeUnits) {
    const headerMatch = EXP_HEADER_RE.exec(unit.id);
    if (headerMatch) {
      const index = Number(headerMatch[1]);
      const group = experienceMap.get(index) ?? { index, header: null, bullets: [] };
      group.header = unit;
      experienceMap.set(index, group);
      continue;
    }
    const bulletMatch = EXP_BULLET_RE.exec(unit.id);
    if (bulletMatch) {
      const index = Number(bulletMatch[1]);
      const group = experienceMap.get(index) ?? { index, header: null, bullets: [] };
      group.bullets.push(unit);
      experienceMap.set(index, group);
    }
  }

  const experience = Array.from(experienceMap.values())
    .filter((g) => g.header !== null)
    .sort((a, b) => a.index - b.index)
    .map((g) => ({
      ...g,
      bullets: [...g.bullets].sort((a, b) => Number(EXP_BULLET_RE.exec(a.id)![2]) - Number(EXP_BULLET_RE.exec(b.id)![2])),
    }));

  const education = resumeUnits
    .filter((u) => EDU_RE.test(u.id))
    .sort((a, b) => Number(EDU_RE.exec(a.id)![1]) - Number(EDU_RE.exec(b.id)![1]));

  const skills = resumeUnits
    .filter((u) => SKILL_RE.test(u.id))
    .sort((a, b) => Number(SKILL_RE.exec(a.id)![1]) - Number(SKILL_RE.exec(b.id)![1]));

  const summary = resumeUnits.find((u) => u.id === "r.summary") ?? null;

  return { experience, education, skills, summary };
}

function BulletText({ unit }: { unit: ClaimUnit }) {
  const segments = highlightNumbers(unit.text ?? "", unit.numbers);
  return (
    <span>
      {segments.map((seg, i) =>
        seg.isMetric ? (
          <span key={i} className="font-medium text-amber">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </span>
  );
}

/**
 * A `text`-bearing unit (bullet/skill/summary/cl_sentence/voice), rendered
 * read-only with its chip, or — when `onEdit` is supplied and the reader
 * clicks "Edit" — a plain textarea that commits on blur/Enter. Structural
 * units (header/edu, `fields`-based) have no free-text surface to edit and
 * never receive this control (design §2.5 scopes inline edit to claim
 * text, not to structural facts like org/title/dates).
 */
function EditableClaim({ unit, onEdit }: { unit: ClaimUnit; onEdit?: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(unit.text ?? "");

  if (editing) {
    return (
      <span className="flex flex-1 items-start gap-2">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== unit.text) onEdit?.(unit.id, draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          rows={2}
          className="flex-1 rounded-md border border-line bg-base p-1.5 text-sm text-ink"
        />
      </span>
    );
  }

  return (
    <span className="flex-1">
      <BulletText unit={unit} /> <SourceChip unit={unit} />
      {onEdit && (
        <button
          type="button"
          onClick={() => {
            setDraft(unit.text ?? "");
            setEditing(true);
          }}
          className="ml-1 text-xs text-ink-muted hover:text-amber"
        >
          Edit
        </button>
      )}
    </span>
  );
}

export function ResumeView({ units, onEdit }: { units: ClaimUnit[]; onEdit?: (id: string, text: string) => void }) {
  const sections = groupResumeUnits(units);

  return (
    <Card className="flex flex-col gap-5">
      {sections.summary && (
        <p className="flex items-start text-sm text-ink">
          <EditableClaim unit={sections.summary} onEdit={onEdit} />
        </p>
      )}

      {sections.experience.map((exp) => (
        <div key={exp.index} className="flex flex-col gap-2">
          {exp.header?.fields && (
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="font-medium text-ink">{exp.header.fields.title}</p>
                <p className="text-sm text-ink-muted">
                  {exp.header.fields.org} · {exp.header.fields.location}
                </p>
              </div>
              <p className="text-xs text-ink-muted">{exp.header.fields.period}</p>
            </div>
          )}
          <ul className="flex flex-col gap-1.5">
            {exp.bullets.map((bullet) => (
              <li key={bullet.id} className="flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                <EditableClaim unit={bullet} onEdit={onEdit} />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {sections.education.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="border-b border-line pb-2 text-xs uppercase tracking-[0.2em] text-ink-muted">Education</p>
          {sections.education.map((edu) => (
            <div key={edu.id} className="flex items-baseline justify-between gap-3 text-sm text-ink">
              <span>
                {edu.fields?.school} — {edu.fields?.degree} <SourceChip unit={edu} />
              </span>
              <span className="text-xs text-ink-muted">{edu.fields?.period}</span>
            </div>
          ))}
        </div>
      )}

      {sections.skills.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="border-b border-line pb-2 text-xs uppercase tracking-[0.2em] text-ink-muted">Skills</p>
          {sections.skills.map((skill) => (
            <p key={skill.id} className="flex items-start text-sm text-ink">
              <EditableClaim unit={skill} onEdit={onEdit} />
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run components/tailor/SourceChip.test.ts components/tailor/ResumeView.test.ts`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add web/components/tailor/SourceChip.tsx web/components/tailor/SourceChip.test.ts \
        web/components/tailor/ResumeView.tsx web/components/tailor/ResumeView.test.ts
git commit -m "V3B-S3: source chips + resume viewer, id-parsed claim grouping"
```

---

### Task 5: `CoverLetterView`

**Files:**
- Create: `web/components/tailor/CoverLetterView.tsx`
- Test: `web/components/tailor/CoverLetterView.test.ts`

**Interfaces:**
- Consumes: `ClaimUnit`, `SourceChip`, `highlightNumbers` (Tasks 2, 4).
- Produces: `orderCoverLetterUnits(units)`, `<CoverLetterView units={ClaimUnit[]} onEdit?={(id, text) => void} />` — consumed by Task 9.

- [ ] **Step 1: Write the failing test**

```ts
// web/components/tailor/CoverLetterView.test.ts
import { describe, expect, it } from "vitest";
import { orderCoverLetterUnits } from "./CoverLetterView";
import type { ClaimUnit } from "./types";

function cl(id: string, kind: ClaimUnit["kind"] = "cl_sentence"): ClaimUnit {
  return { id, surface: "cover_letter", kind, text: id, status: "verified" };
}

describe("orderCoverLetterUnits", () => {
  it("orders sentence units by their numeric suffix, not array order", () => {
    const units = [cl("cl.s2"), cl("cl.s0"), cl("cl.s1")];
    expect(orderCoverLetterUnits(units).map((u) => u.id)).toEqual(["cl.s0", "cl.s1", "cl.s2"]);
  });

  it("includes voice-kind sentences alongside cl_sentence ones", () => {
    const units = [cl("cl.s0", "cl_sentence"), cl("cl.s1", "voice")];
    expect(orderCoverLetterUnits(units).map((u) => u.id)).toEqual(["cl.s0", "cl.s1"]);
  });

  it("excludes resume-surface units even if one somehow has a cl.s-shaped id", () => {
    const resumeUnit: ClaimUnit = { id: "cl.s0", surface: "resume", kind: "bullet", text: "x", status: "verified" };
    expect(orderCoverLetterUnits([resumeUnit])).toEqual([]);
  });

  it("handles double-digit sentence indices numerically, not lexically (s10 after s2)", () => {
    const units = [cl("cl.s10"), cl("cl.s2")];
    expect(orderCoverLetterUnits(units).map((u) => u.id)).toEqual(["cl.s2", "cl.s10"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/tailor/CoverLetterView.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `CoverLetterView.tsx`**

```tsx
// web/components/tailor/CoverLetterView.tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { SourceChip, highlightNumbers } from "./SourceChip";
import type { ClaimUnit } from "./types";

const CL_RE = /^cl\.s(\d+)$/;

/** Cover-letter sentence units, in sentence order (numeric, not array/lexical). */
export function orderCoverLetterUnits(units: ClaimUnit[]): ClaimUnit[] {
  return units
    .filter((u) => u.surface === "cover_letter" && CL_RE.test(u.id))
    .sort((a, b) => Number(CL_RE.exec(a.id)![1]) - Number(CL_RE.exec(b.id)![1]));
}

/** Same click-to-edit affordance as `ResumeView`'s `EditableClaim` (kept
 * local rather than a shared import — each view's surrounding markup
 * differs enough, inline/block, that sharing added more indirection than
 * it saved). Commits on blur/Enter, calling `onEdit(id, text)`. */
function EditableSentence({ unit, onEdit }: { unit: ClaimUnit; onEdit?: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(unit.text ?? "");

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== unit.text) onEdit?.(unit.id, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        rows={2}
        className="mb-1 block w-full rounded-md border border-line bg-base p-1.5 text-sm text-ink"
      />
    );
  }

  const segments = highlightNumbers(unit.text ?? "", unit.numbers);
  return (
    <span className="mr-1">
      {segments.map((seg, i) =>
        seg.isMetric ? (
          <span key={i} className="font-medium text-amber">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}{" "}
      <SourceChip unit={unit} />
      {onEdit && (
        <button
          type="button"
          onClick={() => {
            setDraft(unit.text ?? "");
            setEditing(true);
          }}
          className="ml-1 text-xs text-ink-muted hover:text-amber"
        >
          Edit
        </button>
      )}
    </span>
  );
}

export function CoverLetterView({ units, onEdit }: { units: ClaimUnit[]; onEdit?: (id: string, text: string) => void }) {
  const sentences = orderCoverLetterUnits(units);

  return (
    <Card className="flex flex-col gap-2">
      <p className="text-sm leading-relaxed text-ink">
        {sentences.map((sentence) => (
          <EditableSentence key={sentence.id} unit={sentence} onEdit={onEdit} />
        ))}
      </p>
    </Card>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/tailor/CoverLetterView.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add web/components/tailor/CoverLetterView.tsx web/components/tailor/CoverLetterView.test.ts
git commit -m "V3B-S3: cover letter viewer, ordered by sentence id"
```

---

### Task 6: `HonestyDrawer`

**Files:**
- Create: `web/components/tailor/HonestyDrawer.tsx`
- Test: `web/components/tailor/HonestyDrawer.test.ts`

**Interfaces:**
- Consumes: `DroppedUnit`, `DROPPED_REASON_COPY` (Task 2).
- Produces: `summarizeDropped(dropped)`, `<HonestyDrawer dropped={DroppedUnit[]} />` — consumed by Task 9. Always rendered when `dropped.length > 0` (never conditionally hidden by the caller — that's the whole point of the feature).

- [ ] **Step 1: Write the failing test**

```ts
// web/components/tailor/HonestyDrawer.test.ts
import { describe, expect, it } from "vitest";
import { summarizeDropped } from "./HonestyDrawer";

describe("summarizeDropped", () => {
  it("singularizes a single dropped claim", () => {
    expect(summarizeDropped([{ id: "r.exp0.b3", text: "x", reason: "missing_span" }])).toBe("1 claim withheld");
  });

  it("pluralizes multiple dropped claims", () => {
    expect(
      summarizeDropped([
        { id: "r.exp0.b3", text: "x", reason: "missing_span" },
        { id: "r.exp0.b4", text: "y", reason: "number_not_confirmed" },
      ])
    ).toBe("2 claims withheld");
  });

  it("empty list summarizes to zero", () => {
    expect(summarizeDropped([])).toBe("0 claims withheld");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/tailor/HonestyDrawer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `HonestyDrawer.tsx`**

```tsx
// web/components/tailor/HonestyDrawer.tsx
"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { DROPPED_REASON_COPY, type DroppedUnit } from "./types";

export function summarizeDropped(dropped: DroppedUnit[]): string {
  return `${dropped.length} claim${dropped.length === 1 ? "" : "s"} withheld`;
}

/**
 * The trust feature (design §3.3): a collapsed list of everything the
 * verifier dropped, always present when non-empty — never hidden behind a
 * dismissable toast or an easy-to-miss corner. Collapsed by default so it
 * doesn't dominate a mostly-clean run, but the summary line itself always
 * shows the count.
 */
export function HonestyDrawer({ dropped }: { dropped: DroppedUnit[] }) {
  const [open, setOpen] = useState(false);
  if (dropped.length === 0) return null;

  return (
    <Banner tone="warn" className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-left font-medium text-ink">
        {summarizeDropped(dropped)} — no source in your profile {open ? "▲" : "▼"}
      </button>
      {open && (
        <ul className="flex flex-col gap-2 border-t border-line pt-2">
          {dropped.map((d) => (
            <li key={d.id} className="text-xs text-ink-muted">
              <span className="text-ink">{d.text}</span> — {DROPPED_REASON_COPY[d.reason]}
            </li>
          ))}
        </ul>
      )}
    </Banner>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/tailor/HonestyDrawer.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add web/components/tailor/HonestyDrawer.tsx web/components/tailor/HonestyDrawer.test.ts
git commit -m "V3B-S3: honesty drawer for dropped claims"
```

---

### Task 7: `TemplateSwitcher`

**Files:**
- Create: `web/components/tailor/TemplateSwitcher.tsx`
- Test: `web/components/tailor/TemplateSwitcher.test.ts`

**Interfaces:**
- Consumes: `TEMPLATE_OPTIONS` (Task 2).
- Produces: `dispatchRender(deps)`, `<TemplateSwitcher postingId currentTemplate onRun />` — consumed by Task 9.

- [ ] **Step 1: Write the failing test**

```ts
// web/components/tailor/TemplateSwitcher.test.ts
import { describe, expect, it, vi } from "vitest";
import { dispatchRender } from "./TemplateSwitcher";

describe("dispatchRender", () => {
  it("POSTs mode=render with the chosen template, zero-LLM re-render path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, run_id: "render-run-1" }),
    });

    const result = await dispatchRender({ postingId: "posting-1", template: "modern", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("/api/tailor/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posting_id: "posting-1", mode: "render", template: "modern" }),
    });
    expect(result).toEqual({ kind: "started", runId: "render-run-1" });
  });

  it("surfaces a cooldown outcome the same way the tailor button does", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 429,
      json: async () => ({ error: "cooldown" }),
    });

    const result = await dispatchRender({ postingId: "posting-1", template: "classic", fetchImpl });

    expect(result.kind).toBe("cooldown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run components/tailor/TemplateSwitcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `TemplateSwitcher.tsx`**

```tsx
// web/components/tailor/TemplateSwitcher.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { interpretTailorResponse, type TailorOutcome } from "@/app/(app)/feed/tailorOutcome";
import { TEMPLATE_OPTIONS } from "./types";

export interface DispatchRenderDeps {
  postingId: string;
  template: string;
  fetchImpl: typeof fetch;
}

/**
 * Zero-LLM re-render (design §1.1's `mode=render` path): re-renders the
 * already-verified, already-stored `tailored.json`/claims with a different
 * template at ~$0 — never re-runs generation or the verifier.
 */
export async function dispatchRender({ postingId, template, fetchImpl }: DispatchRenderDeps): Promise<TailorOutcome> {
  const res = await fetchImpl("/api/tailor/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ posting_id: postingId, mode: "render", template }),
  });
  const body = await res.json();
  return interpretTailorResponse(res.status, body);
}

export function TemplateSwitcher({
  postingId,
  currentTemplate,
  onRun,
}: {
  postingId: string;
  currentTemplate: string | null;
  onRun: (outcome: TailorOutcome) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function pick(templateId: string) {
    if (templateId === currentTemplate) return;
    setBusyId(templateId);
    const outcome = await dispatchRender({ postingId, template: templateId, fetchImpl: fetch });
    setBusyId(null);
    onRun(outcome);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TEMPLATE_OPTIONS.map((option) => (
        <Button
          key={option.id}
          variant={option.id === currentTemplate ? "primary" : "secondary"}
          busy={busyId === option.id}
          onClick={() => pick(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run components/tailor/TemplateSwitcher.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add web/components/tailor/TemplateSwitcher.tsx web/components/tailor/TemplateSwitcher.test.ts
git commit -m "V3B-S3: template switcher, mode=render dispatch"
```

---

### Task 8: `/tailor/[runId]` page skeleton — generating + failed states

**Files:**
- Create: `web/app/(app)/tailor/[runId]/page.tsx`
- Test: `web/app/(app)/tailor/[runId]/page.test.ts`
- Create: `web/app/(app)/tailor/[runId]/TailorViewer.tsx`
- Test: `web/app/(app)/tailor/[runId]/TailorViewer.test.ts`

**Interfaces:**
- Consumes: `TAILOR_STAGES` (Task 2), auth pattern from `web/lib/supabase/server` (read-only, same pattern as `app/invite/page.tsx`).
- Produces: `deriveStages(progress)`, the `TailorViewer` component (generating/failed rendering only in this task — succeeded-state content is Task 9). `TailorPage` is the route's default export.

- [ ] **Step 1: Write the failing tests**

```ts
// web/app/(app)/tailor/[runId]/page.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

const { default: TailorPage } = await import("./page");

function params(runId: string) {
  return Promise.resolve({ runId });
}
function searchParams(posting?: string) {
  return Promise.resolve(posting !== undefined ? { posting } : {});
}

describe("/tailor/[runId] page", () => {
  beforeEach(() => {
    getUserMock.mockClear();
    redirectMock.mockClear();
  });

  it("signed-out visitors redirect to /login, preserving the destination", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await expect(
      TailorPage({ params: params("run-1"), searchParams: searchParams("posting-1") })
    ).rejects.toThrow("REDIRECT:/login?next=%2Ftailor%2Frun-1%3Fposting%3Dposting-1");
  });

  it("signed-in with both runId and posting renders the viewer with both ids", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const result = await TailorPage({ params: params("run-1"), searchParams: searchParams("posting-1") });
    expect(result.type.name).toBe("TailorViewer");
    expect(result.props.runId).toBe("run-1");
    expect(result.props.postingId).toBe("posting-1");
  });

  it("signed-in with no posting search param renders the missing-context empty state, not the viewer", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const result = await TailorPage({ params: params("run-1"), searchParams: searchParams() });
    expect(result.type.name).not.toBe("TailorViewer");
  });
});
```

```ts
// web/app/(app)/tailor/[runId]/TailorViewer.test.ts
import { describe, expect, it } from "vitest";
import { deriveStages } from "./TailorViewer";

describe("deriveStages", () => {
  it("no progress yet — the first stage is current, the rest pending", () => {
    const stages = deriveStages([]);
    expect(stages[0]).toEqual({ step: "profile", label: "reading your profile", state: "current" });
    expect(stages[1].state).toBe("pending");
    expect(stages.every((s, i) => (i === 0 ? s.state === "current" : s.state === "pending"))).toBe(true);
  });

  it("completed steps are done, the next unseen step is current, later ones pending", () => {
    const stages = deriveStages([
      { step: "profile", label: "reading your profile", at: "2026-07-17T10:00:00Z" },
      { step: "frame", label: "choosing the frame", at: "2026-07-17T10:00:05Z" },
    ]);
    expect(stages[0].state).toBe("done");
    expect(stages[0].at).toBe("2026-07-17T10:00:00Z");
    expect(stages[1].state).toBe("done");
    expect(stages[2].state).toBe("current");
    expect(stages[3].state).toBe("pending");
    expect(stages[5].state).toBe("pending");
  });

  it("all 6 steps done — none current or pending", () => {
    const progress = ["profile", "frame", "resume", "cover_letter", "verify", "render"].map((step) => ({
      step,
      label: step,
      at: "2026-07-17T10:00:00Z",
    }));
    const stages = deriveStages(progress);
    expect(stages.every((s) => s.state === "done")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run 'app/(app)/tailor/[runId]/page.test.ts' 'app/(app)/tailor/[runId]/TailorViewer.test.ts'`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `TailorViewer.tsx`** (generating + failed states; succeeded-state content is added in Task 9)

```tsx
// web/app/(app)/tailor/[runId]/TailorViewer.tsx
"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { TAILOR_STAGES } from "@/components/tailor/types";
import { interpretTailorResponse } from "@/app/(app)/feed/tailorOutcome";
import type { PolledTailorRun } from "@/lib/tailor/pollRuns";

const POLL_INTERVAL_MS = 4000;

export interface StageStatus {
  step: string;
  label: string;
  state: "done" | "current" | "pending";
  at?: string;
}

/**
 * Maps a run's `progress[]` (worker-appended, in step order) onto the fixed
 * 6-stage checklist. No fake percent bar (design §3.2) — a step is "done"
 * once it has a progress entry, "current" is the first one without an
 * entry yet, everything after that is "pending".
 */
export function deriveStages(progress: Array<{ step: string; label: string; at: string }>): StageStatus[] {
  const seen = new Map(progress.map((p) => [p.step, p]));
  let currentAssigned = false;
  return TAILOR_STAGES.map(({ step, label }) => {
    const entry = seen.get(step);
    if (entry) return { step, label, state: "done" as const, at: entry.at };
    if (!currentAssigned) {
      currentAssigned = true;
      return { step, label, state: "current" as const };
    }
    return { step, label, state: "pending" as const };
  });
}

function GeneratingPanel({ run }: { run: PolledTailorRun }) {
  const stages = deriveStages(run.progress);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">Tailoring your materials — this takes a couple of minutes. Feel free to leave; it'll be here when you're back.</p>
      <ul className="flex flex-col gap-2">
        {stages.map((stage) => (
          <li key={stage.step} className="flex items-center gap-2 text-sm">
            {stage.state === "current" && <Spinner className="h-3.5 w-3.5" />}
            <span
              className={
                stage.state === "done" ? "text-ink" : stage.state === "current" ? "font-medium text-ink" : "text-ink-muted"
              }
            >
              {stage.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FailedPanel({ run, postingId, onRetried }: { run: PolledTailorRun; postingId: string; onRetried: (runId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/tailor/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posting_id: postingId, mode: "tailor" }),
    });
    const body = await res.json();
    const outcome = interpretTailorResponse(res.status, body);
    setBusy(false);
    if (outcome.kind === "started") {
      onRetried(outcome.runId);
      return;
    }
    setMessage(outcome.message);
  }

  return (
    <Banner tone="danger" className="flex flex-col gap-2">
      <p>{run.error ?? "This tailor run failed."}</p>
      <Button variant="secondary" busy={busy} onClick={retry}>
        Try again
      </Button>
      {message && <p className="text-xs text-ink-muted">{message}</p>}
    </Banner>
  );
}

export function TailorViewer({ runId, postingId }: { runId: string; postingId: string }) {
  const [activeRunId, setActiveRunId] = useState(runId);
  const [run, setRun] = useState<PolledTailorRun | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const res = await fetch(`/api/tailor/runs?posting_id=${encodeURIComponent(postingId)}`);
      const body: { runs: PolledTailorRun[] } = await res.json();
      const match = (body.runs ?? []).find((r) => r.id === activeRunId);
      if (cancelled) return;
      if (!match) {
        setNotFound(true);
        return;
      }
      setRun(match);
      if (match.status === "queued" || match.status === "running") {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeRunId, postingId]);

  if (notFound) {
    return <Banner tone="danger">This tailor run couldn't be found.</Banner>;
  }
  if (!run) {
    return <Spinner />;
  }
  if (run.status === "queued" || run.status === "running") {
    return <GeneratingPanel run={run} />;
  }
  if (run.status === "failed") {
    return (
      <FailedPanel
        run={run}
        postingId={postingId}
        onRetried={(newRunId) => {
          setRun(null);
          setNotFound(false);
          setActiveRunId(newRunId);
        }}
      />
    );
  }

  // run.status === "succeeded" — succeeded-state content is added in Task 9.
  return null;
}
```

- [ ] **Step 4: Write `page.tsx`**

```tsx
// web/app/(app)/tailor/[runId]/page.tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/EmptyState";
import { TailorViewer } from "./TailorViewer";

export const dynamic = "force-dynamic";

export default async function TailorPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ posting?: string }>;
}) {
  const { runId } = await params;
  const { posting } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const target = `/tailor/${runId}${posting ? `?posting=${encodeURIComponent(posting)}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(target)}`);
  }

  if (!posting) {
    return (
      <EmptyState
        heading="Missing posting reference"
        message="This link is missing its posting reference — go back to your feed and open it from there."
      />
    );
  }

  return <TailorViewer runId={runId} postingId={posting} />;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run 'app/(app)/tailor/[runId]/page.test.ts' 'app/(app)/tailor/[runId]/TailorViewer.test.ts'`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/tailor/\[runId\]/page.tsx web/app/\(app\)/tailor/\[runId\]/page.test.ts \
        web/app/\(app\)/tailor/\[runId\]/TailorViewer.tsx web/app/\(app\)/tailor/\[runId\]/TailorViewer.test.ts
git commit -m "V3B-S3: /tailor/[runId] route — auth gate, polling, generating/failed states"
```

---

### Task 9: Succeeded-state wiring — materials, viewer composition, edits, regenerate

**Files:**
- Modify: `web/app/(app)/tailor/[runId]/TailorViewer.tsx`
- Modify: `web/app/(app)/tailor/[runId]/TailorViewer.test.ts`

**Interfaces:**
- Consumes: `ResumeView` (Task 4), `CoverLetterView` (Task 5), `HonestyDrawer` (Task 6), `TemplateSwitcher` (Task 7), `ClaimsJson`/`ClaimUnit` (Task 2), `interpretTailorResponse` (Task 1).
- Produces: `applyUserEdit(units, id, newText)`, `resolveMaterialUrls(urls)`, the completed `TailorViewer` succeeded-state UI. This is the plan's final task.

- [ ] **Step 1: Add the failing tests** (append to the existing `TailorViewer.test.ts`)

```ts
// appended to web/app/(app)/tailor/[runId]/TailorViewer.test.ts
import { applyUserEdit, resolveMaterialUrls } from "./TailorViewer";
import type { ClaimUnit } from "@/components/tailor/types";

describe("resolveMaterialUrls", () => {
  it("picks out the 4 signed URLs the viewer needs, by their storage key", () => {
    const urls = {
      "resume.pdf": "https://sign/resume.pdf",
      "cover_letter.pdf": "https://sign/cover_letter.pdf",
      "cover_letter.txt": "https://sign/cover_letter.txt",
      "claims.json": "https://sign/claims.json",
      "tailored.json": "https://sign/tailored.json",
      "render_meta.json": "https://sign/render_meta.json",
    };
    expect(resolveMaterialUrls(urls)).toEqual({
      claimsUrl: "https://sign/claims.json",
      coverLetterTextUrl: "https://sign/cover_letter.txt",
      resumePdfUrl: "https://sign/resume.pdf",
      coverLetterPdfUrl: "https://sign/cover_letter.pdf",
    });
  });

  it("leaves a field undefined when its artifact wasn't in the signed set (e.g. a partial upload)", () => {
    expect(resolveMaterialUrls({ "claims.json": "https://sign/claims.json" })).toEqual({
      claimsUrl: "https://sign/claims.json",
      coverLetterTextUrl: undefined,
      resumePdfUrl: undefined,
      coverLetterPdfUrl: undefined,
    });
  });
});

describe("applyUserEdit", () => {
  const units: ClaimUnit[] = [
    {
      id: "r.exp0.b0",
      surface: "resume",
      kind: "bullet",
      text: "original",
      sources: [{ file: "cv.md", quote: "original" }],
      numbers: [{ token: "5", basis: "confirmed_metric" }],
      status: "verified",
    },
    { id: "r.exp0.b1", surface: "resume", kind: "bullet", text: "untouched", status: "verified" },
  ];

  it("replaces the text and marks only the targeted unit user_edited", () => {
    const result = applyUserEdit(units, "r.exp0.b0", "edited text");
    expect(result[0]).toEqual({
      id: "r.exp0.b0",
      surface: "resume",
      kind: "bullet",
      text: "edited text",
      status: "user_edited",
    });
    expect(result[1]).toBe(units[1]);
  });

  it("clears sources and numbers on edit — a user-authored unit is exempt from sourcing, not falsely still-sourced", () => {
    const result = applyUserEdit(units, "r.exp0.b0", "edited text");
    expect(result[0].sources).toBeUndefined();
    expect(result[0].numbers).toBeUndefined();
  });

  it("an id that matches nothing leaves the list unchanged", () => {
    expect(applyUserEdit(units, "no-such-id", "x")).toEqual(units);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd web && npx vitest run 'app/(app)/tailor/[runId]/TailorViewer.test.ts'`
Expected: FAIL — `applyUserEdit` not exported yet.

- [ ] **Step 3: Extend `TailorViewer.tsx`** — add materials fetching, `applyUserEdit`, and the succeeded-state render. Replace the file's final `// run.status === "succeeded"` block and add the new pieces:

```tsx
// Added imports at the top of web/app/(app)/tailor/[runId]/TailorViewer.tsx
import { ResumeView } from "@/components/tailor/ResumeView";
import { CoverLetterView } from "@/components/tailor/CoverLetterView";
import { HonestyDrawer } from "@/components/tailor/HonestyDrawer";
import { TemplateSwitcher } from "@/components/tailor/TemplateSwitcher";
import type { ClaimsJson, ClaimUnit } from "@/components/tailor/types";
```

```ts
/**
 * Applies a local, in-memory edit: the *only* place `status:"user_edited"`
 * is ever assigned in this app (there is no backend persistence route for
 * it — see Global Constraints). Sources/numbers are cleared because an
 * edited unit is the user's own assertion, not a sourced claim; keeping
 * stale sources around would let a hover chip show a quote that no longer
 * matches the displayed text.
 */
export function applyUserEdit(units: ClaimUnit[], id: string, newText: string): ClaimUnit[] {
  return units.map((u) => {
    if (u.id !== id) return u;
    const { sources: _sources, numbers: _numbers, ...rest } = u;
    return { ...rest, text: newText, status: "user_edited" as const };
  });
}
```

```tsx
interface Materials {
  claims: ClaimsJson;
  coverLetterText: string;
  urls: Record<string, string>;
}

interface ResolvedMaterialUrls {
  claimsUrl: string | undefined;
  coverLetterTextUrl: string | undefined;
  resumePdfUrl: string | undefined;
  coverLetterPdfUrl: string | undefined;
}

/**
 * Picks the 4 signed URLs the viewer actually consumes out of
 * `GET /api/tailor/materials/[runId]`'s `{urls}` map (which may also
 * contain `tailored.json`/`render_meta.json`, unused here). A pure
 * projection so the "which storage key means what" mapping is unit-tested
 * without mocking `fetch`.
 */
export function resolveMaterialUrls(urls: Record<string, string>): ResolvedMaterialUrls {
  return {
    claimsUrl: urls["claims.json"],
    coverLetterTextUrl: urls["cover_letter.txt"],
    resumePdfUrl: urls["resume.pdf"],
    coverLetterPdfUrl: urls["cover_letter.pdf"],
  };
}

function useMaterials(runId: string) {
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/tailor/materials/${runId}`);
      if (!res.ok) {
        if (!cancelled) setError("Couldn't load your materials — try refreshing.");
        return;
      }
      const { urls }: { urls: Record<string, string> } = await res.json();
      const { claimsUrl, coverLetterTextUrl } = resolveMaterialUrls(urls);
      if (!claimsUrl) {
        if (!cancelled) setError("This run has no claims data.");
        return;
      }
      const [claims, coverLetterText] = await Promise.all([
        fetch(claimsUrl).then((r) => r.json() as Promise<ClaimsJson>),
        coverLetterTextUrl ? fetch(coverLetterTextUrl).then((r) => r.text()) : Promise.resolve(""),
      ]);
      if (!cancelled) setMaterials({ claims, coverLetterText, urls });
    }
    load().catch(() => {
      if (!cancelled) setError("Couldn't load your materials — try refreshing.");
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return { materials, error };
}

function SucceededPanel({ run, postingId }: { run: PolledTailorRun; postingId: string }) {
  const { materials, error } = useMaterials(run.id);
  const [units, setUnits] = useState<ClaimUnit[] | null>(null);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [regenerateMessage, setRegenerateMessage] = useState<string | null>(null);
  const [redirectRunId, setRedirectRunId] = useState<string | null>(null);

  useEffect(() => {
    if (materials) setUnits(materials.claims.units);
  }, [materials]);

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!materials || !units) return <Spinner />;
  const { resumePdfUrl, coverLetterPdfUrl } = resolveMaterialUrls(materials.urls);

  if (redirectRunId) {
    if (typeof window !== "undefined") {
      window.location.href = `/tailor/${redirectRunId}?posting=${encodeURIComponent(postingId)}`;
    }
    return <Spinner />;
  }

  function editUnit(id: string, newText: string) {
    setUnits((prev) => (prev ? applyUserEdit(prev, id, newText) : prev));
  }

  async function regenerate() {
    setConfirmingRegenerate(false);
    const res = await fetch("/api/tailor/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posting_id: postingId, mode: "tailor" }),
    });
    const body = await res.json();
    const outcome = interpretTailorResponse(res.status, body);
    if (outcome.kind === "started") {
      setRedirectRunId(outcome.runId);
      return;
    }
    setRegenerateMessage(outcome.message);
  }

  return (
    <div className="rail-sweep flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TemplateSwitcher
          postingId={postingId}
          currentTemplate={run.template}
          onRun={(outcome) => {
            if (outcome.kind === "started") setRedirectRunId(outcome.runId);
            else setRegenerateMessage(outcome.message);
          }}
        />
        <div className="flex items-center gap-2">
          {resumePdfUrl && (
            <a href={resumePdfUrl} className="text-sm text-amber hover:text-amber-hover">
              Download resume
            </a>
          )}
          {coverLetterPdfUrl && (
            <a href={coverLetterPdfUrl} className="text-sm text-amber hover:text-amber-hover">
              Download letter
            </a>
          )}
          <Button variant="ghost" onClick={() => navigator.clipboard.writeText(materials.coverLetterText)}>
            Copy letter text
          </Button>
        </div>
      </div>

      <HonestyDrawer dropped={materials.claims.dropped} />

      <div className="grid gap-4 md:grid-cols-2">
        <ResumeView units={units} onEdit={editUnit} />
        <CoverLetterView units={units} onEdit={editUnit} />
      </div>

      <div className="flex flex-col items-start gap-2">
        {confirmingRegenerate ? (
          <Banner tone="warn" className="flex flex-col gap-2">
            <p>
              This re-runs the full tailor (archetype → resume → cover letter → verification → render), uses one of
              your 5 daily tailors, and costs roughly $0.20–$0.35. Continue?
            </p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={regenerate}>
                Regenerate
              </Button>
              <Button variant="ghost" onClick={() => setConfirmingRegenerate(false)}>
                Cancel
              </Button>
            </div>
          </Banner>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmingRegenerate(true)}>
            Regenerate
          </Button>
        )}
        {regenerateMessage && <p className="text-xs text-ink-muted">{regenerateMessage}</p>}
      </div>
    </div>
  );
}
```

Update `TailorViewer`'s final branch to use this panel instead of returning `null`:

```tsx
  if (run.status === "succeeded") {
    return <SucceededPanel run={run} postingId={postingId} />;
  }
  return null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run 'app/(app)/tailor/[runId]/TailorViewer.test.ts'`
Expected: PASS, all green (including the pre-existing `deriveStages` tests from Task 8).

- [ ] **Step 5: Full verification sweep**

Run, from `web/`:
```bash
npx vitest run
npx tsc --noEmit
npm run build
```
Expected: all tests pass, no type errors, build succeeds.

Run from the repo root:
```bash
bash scripts/scrub_gate.sh
```
Expected: PASS — no forbidden tokens, no stray binaries.

- [ ] **Step 6: Commit**

```bash
git add web/app/\(app\)/tailor/\[runId\]/TailorViewer.tsx web/app/\(app\)/tailor/\[runId\]/TailorViewer.test.ts
git commit -m "V3B-S3: tailor surface — side-by-side viewer, source chips, honesty drawer, template switch"
```

This is the exit-criteria commit message specified by the session prompt.

---

## Post-plan: push, do not merge

After Task 9's commit, per the session prompt's exit criteria: web vitest + tsc + build are green, scrub gate passes, and the diff is entirely inside the ownership boundaries listed in Global Constraints. Push the branch (`git push -u origin feat/v3b-s3-ui`) and stop — **do not merge**. Reviewer close-out (applying migration 0012 live, verifying the `job-materials` bucket, `vercel --prod`, and a real end-to-end tailor on a live match) is explicitly the human reviewer's job per the session prompt, not part of this plan.
