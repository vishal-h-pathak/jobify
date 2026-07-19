# Session 41 — V3C-E1A: the fill engine core  (V3c E1, parallel with 42)

**Model: Sonnet.** Spec = `planning/V3C_DESIGN.md` (v2.1) §0, §2 (F1–F4), §3
(L0 + §3.1–3.3) — read FIRST. Porting sources, read before writing code:
`jobify/submit/adapters/prepare_dom/field_maps.yml` + `field_maps.py`
(map schema, selector-chain rules, Lever full-name override),
`prepare_dom/_common.py` (`build_field_map` label→value contract),
`adapters/browser_tools.py::get_form_fields` (the survey ancestor).
This is the robustness cornerstone: pure DOM logic, **zero `chrome.*` APIs,
zero network, zero LLM** — everything testable headless against fixture DOMs.
**Branch:** `feat/v3c-e1-engine` off main, worktree `jobify-wt/v3c-e1-engine`.
**You own:** `extension/engine/**` ONLY (its own package.json/tsconfig/vitest
— standalone TS package; session 42 owns `extension/manifest.json`,
`extension/shell/**`, and the root build that bundles both). Do NOT touch
`web/`, `jobify/`, migrations, or anything outside `extension/engine/`.

## PINNED CONTRACT (shared verbatim with session 42 — implement EXACTLY)

```ts
// extension/engine/src/types.ts — the survey is the lingua franca (§3.1).
export type SurveyField = {
  id: string;                    // stable within one survey pass: "f1","f2",...
  kind: "text"|"textarea"|"select"|"combobox"|"radio_group"|"checkbox"|"file"|"date"|"unknown";
  label: string;                 // best label via the resolution ladder
  name: string;                  // name attribute or ""
  autocomplete: string;          // autocomplete attribute or ""
  required: boolean;
  value: string;                 // current value; radio_group -> checked option label or ""
  options?: string[];            // select/combobox/radio_group visible labels
  frame: string;                 // "" = main document; else frame path like "iframe0/iframe1"
  automationId?: string;         // data-automation-id when present (Workday)
};
export type SurveyButton = { id: string; label: string; kind: "button"|"submit"|"link" };
export type Survey = { url: string; fields: SurveyField[]; buttons: SurveyButton[] };

export type FillInstruction = { fieldId: string; value: string; source: string }; // source = packet key ("identity.phone") or file key ("materials.resume_pdf")
export type FillOutcome = { fieldId: string; label: string; layer: "map";
  attempted: boolean; filled: boolean; stuckAfterReadback: boolean; strategy: string };
export type FillReport = { outcomes: FillOutcome[]; requiredEmpty: string[] };

export type AtsMapKind = "greenhouse"|"lever"|"ashby"|"workday";
export type EngineFiles = { resume?: File; cover_letter?: File };

// The engine's ENTIRE public API — nothing else is exported from the package root:
export function survey(root: Document): Survey;
export function planFills(s: Survey, packet: SubmitPacket, ats: AtsMapKind | "generic"): FillInstruction[]; // E1: L0 maps only; "generic" -> []
export function executeFills(root: Document, s: Survey, plan: FillInstruction[], files: EngineFiles): Promise<FillReport>;
```
(`SubmitPacket` = the canonical type; copy it verbatim from
`web/lib/submit/types.ts` into the engine package — the extension cannot
import from `web/`, and a drift test in 42 keeps them identical.)

## Build

1. **`survey.ts`** — enumerate fields + buttons across document + **open
   shadow roots (recursive)** + **same-origin iframes** (frame path ids).
   Label ladder: `<label for>` → wrapping label → `aria-label` /
   `aria-labelledby` → placeholder → nearest preceding text / fieldset
   legend. Kind detection by role/pattern, not tag (ARIA combobox ≠ select).
   Buttons are SURVEYED ONLY — the engine can describe them, never press
   them. Settle helper: MutationObserver quiescence (no mutations for N ms,
   bounded), never a global load-state wait (F1).
2. **`maps.ts`** — L0 maps as data. Transcribe `field_maps.yml`'s greenhouse/
   lever/ashby entries to JSON **verbatim in order, keys, required flags,
   and selector chains** (drop Playwright's `:visible` — visibility is a
   runtime helper here), plus the same schema rules as `field_maps.py::
   _selectors_for` (explicit selectors lead; name-attr pair; label fallbacks
   for text; fuzzy-name for Ashby via `defaults`). **NEW: a `workday` map**
   anchored on `data-automation-id` selectors (legalNameSection_firstName /
   _lastName, email, phone-number, addressSection city/postalCode, file
   upload, source dropdown — document each selector's provenance in a
   comment). Lever's full-name value override ports intact.
3. **`plan.ts`** — port `build_field_map`: packet → label-keyed values
   (identity keys map 1:1; `__resume__`/`__cover_letter__` become file
   instructions). `planFills` joins map specs to surveyed fields (selector
   match first, label match fallback) and emits instructions; empty values
   are skipped, required-and-empty feeds `requiredEmpty`.
4. **`drivers.ts`** — widget drivers keyed by `SurveyField.kind`: text/
   textarea (native value setter + synthetic `input`/`change` — the React
   fix, F3), select (option by value or label), checkbox/radio_group (match
   option label), **combobox/typeahead** (open → set filter text → await
   options → choose matching option; widget-scoped clicks are FILLING and
   live only inside this driver), file (DataTransfer → `input.files` +
   `change`), date (ISO + input events). Strategy escalation interface:
   `native` → `keystrokes` (per-char keydown/keypress/input/keyup); leave a
   typed extension point for later strategies (E2's debugger driver) —
   do NOT implement chrome.debugger here.
5. **`fill.ts`** — `executeFills`: per instruction — driver → **read-back**
   (re-read the field; normalized compare) → on mismatch retry next strategy
   → honest `stuckAfterReadback`. Never throws past an instruction; the
   report is the truth.
6. **Constitution tests (CI):** (a) package root exports exactly the pinned
   API — nothing else; (b) grep-test: no `chrome.` / `browser.` reference
   anywhere in `extension/engine/src`; (c) **deny-test**: walk every bundled
   map; fail if any fill target's selector or label matches
   `/submit|apply now|send application|finish/i`; (d) drivers never receive
   a `SurveyButton`.

## Fixtures + tests
Hand-authored HTML fixtures (NOT scraped real pages), Alex Quinn data only:
greenhouse (server-rendered `job_application[...]` names), lever (`name=`,
single full-name field, `comments` textarea), ashby-like (React-ish labels,
hidden file input behind a dropzone, contenteditable, fuzzy names), workday-
like (`data-automation-id`, an **open shadow root**, a typeahead requiring
option selection), generic (autocomplete attributes only), plus a same-origin
iframe fixture. Pick vitest + happy-dom or jsdom (justify in a comment; note
any shadow/iframe limits honestly). Tests: survey ladder rung-by-rung; map
transcription parity (table-driven against the YAML source); plan (Lever
override; skip-empty; requiredEmpty); every driver, including a React-style
controlled input that reverts non-native value writes, and read-back
escalation to `keystrokes`; the four constitution tests.

## Exit criteria
Engine package tests green standalone (`cd extension/engine && npx vitest
run` + `npx tsc --noEmit`); repo suites untouched and green; scrub gate PASS;
diff entirely inside `extension/engine/`. Commit:
`V3C-E1A: fill engine core — survey, widget drivers, read-back, L0+Workday maps`.
Push; do NOT merge.
