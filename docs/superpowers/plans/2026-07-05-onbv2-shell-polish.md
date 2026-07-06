# ONB-C: Shell + Design-System Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the ONB-C slice of the onboarding-v2 redesign (`planning/ONBOARDING_REDESIGN.md` §3/§4-C) — Card variants, TextArea autosize, globals.css motion + type-ramp + flourish utilities, and the landing-page axis/CTA fix — with zero visual regression to any existing call site.

**Architecture:** Small, additive changes to five files already reviewed in full. `Card` gains an opt-in `variant` prop whose `default` value is byte-for-byte the current class string. `TextArea` gains a pure, value-derived row estimate (no DOM measurement, so it stays testable via direct component-function calls, matching this repo's existing test style). `globals.css` gains new keyframes/utility classes and a `@layer base` h1 floor — all additive, nothing removed. The landing page swaps two Tailwind class strings to fix list semantics and CTA layout. The app shell gets a documentation-only comment recording the width decision for the parallel onboarding session (ONB-B) to pick up.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4 (CSS-first `@theme`/`@layer`), TypeScript, Vitest (node environment, components tested by calling them as plain functions and inspecting the returned element tree — not `@testing-library/react` DOM rendering).

## Global Constraints

- **File ownership is exclusive to this session:** only touch `web/components/ui/Card.tsx`, `web/components/ui/Input.tsx`, `web/app/page.tsx`, `web/app/(app)/layout.tsx`, `web/app/globals.css`, and their tests. Never touch `web/lib/**`, `web/app/(app)/onboarding/**`, `web/app/api/**`, admin/settings/feed pages, `jobify/`, or migrations — a parallel session (ONB-A) owns those.
- **Zero visual regression outside opted-in variants:** `Card`'s default variant and every existing call site must render an identical class string to today.
- **Implement faithfully, no redesigning beyond the spec** (`27_onbv2_shell_polish.md:5`).
- **Motion utilities are classes only** — do not apply them anywhere in this session's files; ONB-B wires them into the onboarding surface later.
- **Scrub gate:** no copy introduced by this session may contain operator-identifying strings (names, emails). This session adds no new user-facing copy strings, only class names and a code comment — verify the comment itself stays generic.
- **Exit criteria:** `npm run build` + `vitest run` + `tsc --noEmit` all green; diff confined to the five owned files + their tests; commit message exactly `ONB-C: Card variants, TextArea autosize, motion utilities, landing axis + width fixes`; push, do not merge.

---

### Task 1: Card variants

**Files:**
- Modify: `web/components/ui/Card.tsx`
- Test: `web/components/ui/Card.test.tsx`

**Interfaces:**
- Produces: `CardVariant = "default" | "quiet" | "elevated"`; `Card(props: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant; children: ReactNode })` — unchanged call signature for every existing caller (variant is optional, defaults to `"default"`).

- [ ] **Step 1: Write the failing tests**

Append to `web/components/ui/Card.test.tsx` (keep the existing two `it` blocks as-is):

```tsx
  it("default variant renders the exact original class string — zero visual regression", () => {
    const result = Card({ children: "content" });
    expect(result.props.className.trim()).toBe("rounded-lg border border-line bg-surface p-4");
  });

  it("quiet variant drops the border and uses a translucent surface", () => {
    const result = Card({ children: "content", variant: "quiet" });
    expect(result.props.className).toMatch(/bg-surface\/50/);
    expect(result.props.className).not.toMatch(/border-line/);
  });

  it("elevated variant keeps the border and adds shadow", () => {
    const result = Card({ children: "content", variant: "elevated" });
    expect(result.props.className).toMatch(/border-line/);
    expect(result.props.className).toMatch(/shadow-lg/);
    expect(result.props.className).toMatch(/shadow-black\/20/);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd web && npx vitest run components/ui/Card.test.tsx`
Expected: the `quiet`/`elevated` assertions FAIL (current `Card` ignores `variant`, so `className` never contains `bg-surface/50` or `shadow-lg`). The default-variant snapshot test passes already (no behavior change yet).

- [ ] **Step 3: Implement Card variants**

Replace `web/components/ui/Card.tsx` with:

```tsx
import type { HTMLAttributes, ReactNode } from "react";

export type CardVariant = "default" | "quiet" | "elevated";

const CARD_VARIANT_CLASSES: Record<CardVariant, string> = {
  default: "rounded-lg border border-line bg-surface p-4",
  quiet: "rounded-lg bg-surface/50 p-4",
  elevated: "rounded-lg border border-line bg-surface p-4 shadow-lg shadow-black/20",
};

export function Card({
  variant = "default",
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant; children: ReactNode }) {
  return (
    <div className={`${CARD_VARIANT_CLASSES[variant]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run components/ui/Card.test.tsx`
Expected: PASS (5 tests: 2 original + 3 new).

- [ ] **Step 5: Commit**

```bash
git add web/components/ui/Card.tsx web/components/ui/Card.test.tsx
git commit -m "ONB-C: add Card variant prop (default/quiet/elevated)"
```

---

### Task 2: TextArea autosize

**Files:**
- Modify: `web/components/ui/Input.tsx`
- Test: `web/components/ui/Input.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TextArea` keeps its existing call signature (`TextareaHTMLAttributes<HTMLTextAreaElement>`); `rows` is now optional — if omitted, it's derived from `value` via an internal `autosizeRows` helper (not exported; later sessions pass `value` and let it autosize, or pass `rows` explicitly to opt out).

- [ ] **Step 1: Write the failing tests**

Append to `web/components/ui/Input.test.tsx` (keep the existing `describe("Input", ...)` and `describe("TextArea", ...)` blocks as-is):

```tsx
describe("TextArea autosize", () => {
  it("defaults to the minimum 3 rows for a short or empty value", () => {
    expect(TextArea({ value: "short answer" }).props.rows).toBe(3);
    expect(TextArea({}).props.rows).toBe(3);
  });

  it("grows rows with explicit newlines, up to the value's line count", () => {
    const fiveLines = "one\ntwo\nthree\nfour\nfive";
    expect(TextArea({ value: fiveLines }).props.rows).toBe(5);
  });

  it("caps growth at 8 rows for long input", () => {
    const longValue = "a".repeat(500);
    expect(TextArea({ value: longValue }).props.rows).toBe(8);
  });

  it("an explicit rows prop always wins over the autosize estimate", () => {
    const longValue = "a".repeat(500);
    expect(TextArea({ value: longValue, rows: 3 }).props.rows).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd web && npx vitest run components/ui/Input.test.tsx`
Expected: FAIL — current `TextArea` never sets `rows` unless the caller passes it, so `props.rows` is `undefined` for the first three new tests.

- [ ] **Step 3: Implement autosize**

Replace `web/components/ui/Input.tsx` with:

```tsx
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const FIELD_CLASSES =
  "w-full rounded-md border border-line bg-base px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-50";

const TEXTAREA_MIN_ROWS = 3;
const TEXTAREA_MAX_ROWS = 8;
const TEXTAREA_CHARS_PER_ROW = 60;

/** Estimates the rows a textarea needs from its value alone — no DOM measurement,
 * so autosize stays a pure function of props and is testable by calling the
 * component directly, matching this file's existing test style. */
function autosizeRows(value: TextareaHTMLAttributes<HTMLTextAreaElement>["value"]): number {
  if (typeof value !== "string" || value.length === 0) return TEXTAREA_MIN_ROWS;
  const explicitLines = value.split("\n").length;
  const wrappedLines = Math.ceil(value.length / TEXTAREA_CHARS_PER_ROW);
  return Math.min(Math.max(explicitLines, wrappedLines, TEXTAREA_MIN_ROWS), TEXTAREA_MAX_ROWS);
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_CLASSES} ${className}`} {...rest} />;
}

export function TextArea({ className = "", rows, value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows ?? autosizeRows(value)}
      value={value}
      className={`${FIELD_CLASSES} ${className}`}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run components/ui/Input.test.tsx`
Expected: PASS (6 tests: 2 original + 4 new).

- [ ] **Step 5: Commit**

```bash
git add web/components/ui/Input.tsx web/components/ui/Input.test.tsx
git commit -m "ONB-C: TextArea autosize up to 8 rows"
```

---

### Task 3: globals.css motion utilities, reduced-motion, h1 floor, amber flourish

**Files:**
- Modify: `web/app/globals.css`
- Create: `web/app/globals.css.test.ts`

**Interfaces:**
- Produces: CSS utility classes `.panel-enter`, `.message-enter`, `.amber-radial-glow` (all opt-in, applied by no file in this session); a `@layer base` rule setting a `1.5rem`/`2rem` (text-2xl-equivalent) floor on bare `h1` elements; a `@media (prefers-reduced-motion: reduce)` block disabling both animation classes. These are additive — nothing in the existing 54 lines changes.

- [ ] **Step 1: Write the failing test file**

Create `web/app/globals.css.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("globals.css — ONB redesign motion + type-ramp utilities", () => {
  it("defines the panel-enter and message-enter motion utilities", () => {
    expect(css).toMatch(/@keyframes panel-enter/);
    expect(css).toMatch(/animation:\s*panel-enter 240ms ease-out/);
    expect(css).toMatch(/@keyframes message-enter/);
    expect(css).toMatch(/animation:\s*message-enter 180ms ease-out/);
  });

  it("disables both motion utilities under prefers-reduced-motion", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    const reducedMotionBlock = css.split("prefers-reduced-motion")[1];
    expect(reducedMotionBlock).toMatch(/\.panel-enter/);
    expect(reducedMotionBlock).toMatch(/\.message-enter/);
  });

  it("sets a text-2xl-equivalent floor for h1", () => {
    expect(css).toMatch(/h1\s*{[^}]*font-size:\s*1\.5rem/);
  });

  it("defines the opt-in amber radial glow flourish", () => {
    expect(css).toMatch(/\.amber-radial-glow/);
    expect(css).toMatch(/color-mix\(in srgb, var\(--color-amber\) 6%, transparent\)/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run app/globals.css.test.ts`
Expected: FAIL on all four assertions — none of these strings exist in `globals.css` yet.

- [ ] **Step 3: Append the CSS**

Append to the end of `web/app/globals.css` (after the existing `:focus-visible` block, line 54):

```css

/* ONB redesign §3 type ramp — a global h1 floor so any heading that doesn't set
   its own size renders at least text-2xl. Pages that already set an explicit
   Tailwind size class (e.g. text-4xl on the landing wordmark, text-xl on several
   app pages) are unaffected — a class selector always wins over this element
   selector. Bumping those explicit page-owned headings to text-2xl is each page
   owner's call, not this layout-level floor's job. */
@layer base {
  h1 {
    font-size: 1.5rem;
    line-height: 2rem;
  }
}

/* ONB redesign §3 motion utilities — opt-in animation classes. Unused by any file
   in this session; the onboarding surface (ONB-B) applies them to its stage panel
   and chat messages. Both honor prefers-reduced-motion below. */
@keyframes panel-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes message-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.panel-enter {
  animation: panel-enter 240ms ease-out;
}

.message-enter {
  animation: message-enter 180ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .panel-enter,
  .message-enter {
    animation: none;
  }
}

/* ONB redesign §3 "one flourish" — fixed, very subtle radial amber glow. Opt-in,
   unused by any file in this session; the onboarding surface (ONB-B) applies it
   behind its panel. */
.amber-radial-glow {
  background-image: radial-gradient(
    circle at 50% 0%,
    color-mix(in srgb, var(--color-amber) 6%, transparent),
    transparent 70%
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run app/globals.css.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/app/globals.css web/app/globals.css.test.ts
git commit -m "ONB-C: globals.css motion utilities, reduced-motion, h1 floor, amber flourish"
```

---

### Task 4: Landing page axis fix (numbered list + horizontal CTAs)

**Files:**
- Modify: `web/app/page.tsx`
- Test: `web/app/page.test.tsx`

**Interfaces:**
- Consumes: nothing new. No change to top-level children order (`[wordmark-div, ol, p, ctas-div]`), so the existing test's `const [, , , ctas] = result.props.children;` destructure keeps working.

- [ ] **Step 1: Write the failing tests**

Append to `web/app/page.test.tsx`, inside the existing `describe("landing page (/)", ...)` block:

```tsx
  it("renders the 3 pitch steps as a visibly numbered list", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await Home();
    const [, steps] = result.props.children;

    expect(steps.type).toBe("ol");
    expect(steps.props.className).toMatch(/list-decimal/);
    expect(steps.props.children).toHaveLength(3);
  });

  it("renders the CTA pair side by side, not stacked", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await Home();
    const [, , , ctas] = result.props.children;

    expect(ctas.props.className).not.toMatch(/flex-col/);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd web && npx vitest run app/page.test.tsx`
Expected: FAIL — `steps.props.className` is currently `"flex max-w-md flex-col gap-2 text-left text-sm text-ink-muted"` (no `list-decimal`); `ctas.props.className` currently contains `flex-col`.

- [ ] **Step 3: Fix the two class strings in `web/app/page.tsx`**

Change the `<ol>` (currently line 33):

```tsx
      <ol className="flex max-w-md flex-col gap-2 text-left text-sm text-ink-muted">
```

to:

```tsx
      <ol className="max-w-md list-decimal list-inside space-y-2 text-left text-sm text-ink-muted">
```

Change the CTA wrapper `<div>` (currently line 43):

```tsx
      <div className="flex flex-col items-center gap-4">
```

to:

```tsx
      <div className="flex items-center gap-4">
```

(All three `<li>` copy lines and the two `<Link>` elements inside stay exactly as-is — only the two class strings change.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run app/page.test.tsx`
Expected: PASS (5 tests: 3 original + 2 new).

- [ ] **Step 5: Commit**

```bash
git add web/app/page.tsx web/app/page.test.tsx
git commit -m "ONB-C: landing page numbered-list + horizontal CTA fix"
```

---

### Task 5: Width-decision comment in the app shell

**Files:**
- Modify: `web/app/(app)/layout.tsx`

**Interfaces:**
- No behavioral or prop changes. `web/app/(app)/layout.test.tsx` is not modified — it must stay green unchanged, proving this step is comment-only.

- [ ] **Step 1: Add the width-decision comment**

In `web/app/(app)/layout.tsx`, change:

```tsx
      <header className="border-b border-line px-6 py-4">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
```

to:

```tsx
      <header className="border-b border-line px-6 py-4">
        {/* Width decision (ONBOARDING_REDESIGN.md §1.9/§3): the app shell standardizes
            on max-w-3xl, matching /feed (web/app/(app)/feed/page.tsx:77). Onboarding
            (owned by ONB-B, web/app/(app)/onboarding/page.tsx:276,283) currently
            renders at max-w-2xl — it should adopt max-w-3xl too, to stop the width
            jitter between routes that the redesign spec calls out. */}
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
```

- [ ] **Step 2: Run the existing layout test to confirm no regression**

Run: `cd web && npx vitest run "app/(app)/layout.test.tsx"`
Expected: PASS (5 tests, unchanged) — proves the comment introduced no behavioral change.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/layout.tsx"
git commit -m "ONB-C: document max-w-3xl width decision for ONB-B"
```

---

### Task 6: Full verification, scrub check, and push

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `cd web && npm run test`
Expected: all suites PASS, including the 4 touched/created files from Tasks 1-4.

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `cd web && npm run build`
Expected: build succeeds. (If it fails solely on missing runtime env vars unrelated to these five files, note that in the completion report rather than treating it as a regression — confirm by checking the failure is not in any file this session touched.)

- [ ] **Step 4: Confirm the diff is confined to ownership**

Run: `git diff --stat main`
Expected: only these paths appear: `web/components/ui/Card.tsx`, `web/components/ui/Card.test.tsx`, `web/components/ui/Input.tsx`, `web/components/ui/Input.test.tsx`, `web/app/page.tsx`, `web/app/page.test.tsx`, `web/app/globals.css`, `web/app/globals.css.test.ts`, `web/app/(app)/layout.tsx`, plus this plan doc under `docs/superpowers/plans/`.

- [ ] **Step 5: Scrub gate — no operator-identifying strings**

Run: `git diff main -- web/components/ui/Card.tsx web/components/ui/Input.tsx web/app/page.tsx "web/app/(app)/layout.tsx" web/app/globals.css | grep -iE -f <(the operator-token list in scripts/scrub_gate.sh)`
Expected: no output (grep exits non-zero / prints nothing).

- [ ] **Step 6: Push (do not merge)**

```bash
git push -u origin feat/hosted-onbv2-shell
```

Do not open a PR or merge — this is review-then-merge, same as the other wave-1 session.

---

## Self-Review Notes

- **Spec coverage:** all 7 numbered tasks in `27_onbv2_shell_polish.md` map to a plan task — Card variants (Task 1), TextArea autosize (Task 2), motion utilities (Task 3), landing axis fix (Task 4), width consistency (Task 5), type ramp (folded into Task 3's h1 floor, since it's a layout-level style, not a per-page edit), and the amber flourish (folded into Task 3, same file).
- **Placeholder scan:** no TBDs; every step has literal code/commands.
- **Type consistency:** `CardVariant` and `autosizeRows` names are used consistently between their defining task and nowhere else (both are internal to their file, not consumed cross-task in this plan).
