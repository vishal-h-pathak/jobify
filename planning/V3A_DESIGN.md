# V3a Design — intake orchestration, LLM modules, dossier

Status: design, wave-2 input. Canon: PRODUCT_VISION.md (§1 dossier, §2 intake, §4 look/voice).
Extends ONBOARDING_REDESIGN.md §3's shipped language (StepSpine receipts, type ramp,
`panel-enter`/`message-enter`/`amber-radial-glow`, token palette — no new tokens, no new fonts).
Wave-1 (`feat/v3a`) contracts are FROZEN: the `ModuleKey` union + exported signatures in
`web/lib/onboarding/moduleRegistry.ts`, `checkpoint.ts`, `incrementalDoc.ts`, the module routes
(`/api/onboarding/modules/[key]`, `/modules/reactions`), and the completion sequence in
`docs/MODULES.md`. Wave 2 consumes them; internals of `noExtractorYet` receipts may be replaced.

---

## 1. Intake orchestration

### 1.1 The spine becomes a PhaseRail (decision: redesign, don't extend)

Twelve dots is noise. Replace `StepSpine` on the v3a onboarding page with **`PhaseRail`**:
three segments — `01 Ground truth · 02 Depth · 03 Mirror` — each showing a fraction
(`3/4`) and, beneath the rail, ONE line: the receipt of the most recently completed module
(receipts are now server-persisted in `modules[key].receipt`, fixing v2's local-only receipts).
The single 2px amber underline spans all three segments; width = completed modules / 12,
animating 400ms ease-in-out per completion — every module completion is a visible tick of the
same bar, which IS the "profile being assembled" promise. Segment labels `text-xs`, fraction
`text-xs text-ink-muted`, receipt line `text-sm text-ink-muted`. `StepSpine.tsx` is retired with
the page rebuild (v2 page is replaced, not forked).

### 1.2 Sequencing — guided order, resumable map

Canonical order (drives "next module" and resume): **Phase 1** anchor → reactions → values →
dealbreakers · **Phase 2** energy → environment → trajectory → interview block (range →
evidence → targeting) → voice → metrics · **Phase 3** mirror. One module panel on screen at a
time inside the existing `max-w-2xl` shell with `amber-radial-glow`; panel swap uses
`panel-enter`. No free navigation forward; completed modules are revisitable from the dossier
(§3), not from the rail — keeps the flow a flow.

**Resumability:** `GET /api/onboarding/state` is extended to return `modules` (jsonb as-is) +
`next_module` (first incomplete key in canonical order) + `checkpoint_fired: boolean`. Returning
users land directly on `next_module` with the rail already filled — no replay, no summary screen.
Deep-link `?module=<key>` re-opens any completed module for re-submission (routes already
support wholesale replace).

### 1.3 Reaction calibration — the fun moment

One posting card at a time, stacked deck feel (next card peeking 8px below at 60% opacity).
Card: `Card variant="elevated"`, title `text-lg text-ink`, company · location `text-sm
text-ink-muted`. Actions: two big buttons — `Pass` (ghost) / `Interested` (primary amber) —
plus ←/→ keys. On choice the card exits (`translateX(∓24px)` + fade, 180ms), then a
**one-beat why chip row** slides in under the exiting position: 6 canned one-worders
(`comp · title · domain · company · level · location`) + a 24-char free field, all optional,
auto-advance after 2.5s or on tap (`note` on the POST). Progress: "3 of 8" ticks top-right;
back-arrow undo re-opens the previous card (POST upsert = changed minds are free). At ≥6
reactions the module self-completes server-side; the client shows the receipt tick on the rail.
Copy sets the frame: "Real postings, live right now. Gut reactions only — this is how your
feed learns taste, not just keywords."

### 1.4 Values trade-offs

One pair per screen, framed by the fixed line "Same pay either way." Two option cards
side-by-side (stacked on mobile), `text-lg`, tap = choose: chosen card border flashes amber
(150ms), pair advances after 200ms. 7 pairs from `VALUE_PAIRS` (server-defined; fetch labels
from a tiny GET or ship them via state — do NOT redefine client-side). One `Can't choose —
skip` ghost link, usable once (server minimum is 6). No Likert, no sliders, ever.

### 1.5 Dealbreakers

Structured panel, zero-LLM: chip toggles for common hard filters (on-site required · defense ·
crypto/gambling · sub-$X comp — the comp chip opens a number field and serializes to
"comp below $X" · specific-city-only) + free-add input, and a second muted row for
`soft_concerns`. This panel also absorbs the *logistics floor* (location + remote stance) as
disqualifier strings, so the targeting chat stops owning dealbreakers entirely (§2.0).
Submitting fires the phase-1 checkpoint server-side.

### 1.6 The checkpoint moment — a product beat, not a toast

The dealbreakers POST returns the updated `modules`. The client branches on
`modules.checkpoint_hunt` **honestly**:

- **Fired:** full-panel interstitial (not a toast, not skippable-by-accident): rail pauses,
  panel enters with the amber glow at its strongest allowed dose. Copy, display-size:
  h2 `text-3xl tracking-tight` — "Your first hunt just left." Body `text-lg max-w-prose` —
  "Phase one is enough to hunt with, so we sent it. Results will be waiting when you're done —
  and everything you answer from here re-shapes them before you ever see the list." One primary
  button: "Keep going — Depth, about 10 minutes." Motion: the rail's amber underline does a
  full-width sweep-and-settle (600ms, once) as the panel enters. This is one of the two
  sanctioned emotional-beat animations (the other is the mirror reveal).
- **Not fired** (checkpoint swallowed a failure / profile pre-existed): same interstitial
  layout, honest copy — "Phase one done. Depth next — about 10 minutes." No hunt claim.

Afterwards a quiet status chip lives right of the PhaseRail: `hunt #1 running · 14:32`
(from `checkpoint_hunt.fired_at`), swapping to `N matches waiting` once `matches` rows exist
(cheap count on state fetch). That chip is the ambient re-rank surface for V3a: it only ever
states things that are true in the DB. Per-module "re-ranked!" toasts are **cut** — wave 1
has no re-score mechanism, and we don't fake beats (open question 1 covers hunt #2).

### 1.7 The v2 conversational stages slot in as the "interview block"

The stage machine (`anchor→calibration→resume→targeting→done`) survives untouched as the
engine of ONE module panel: a chat surface (v2 restyle rules: amber-left-rule assistant text,
user chips, `message-enter`) that covers three rail-visible modules. Wave 2 adds only glue in
`handleTurn`: when `record_calibration` lands → `markModuleComplete("range", "4 answers")`;
when `record_resume`/skip lands → `markModuleComplete("evidence", "resume added" | "built from
your answers")`; `finish_interview` closes the block. Targeting shrinks by prompt edit: it no
longer asks dealbreakers (module owns them) — it confirms tiers and fills remaining logistics
gaps only, 2-4 turns. Anchor stays the existing zero-LLM `AnchorForm` (already module-unified).
No stage-enum migration; `stage` and `modules` advance in parallel, `modules` is the UI truth.

---

## 2. The three LLM modules

All three run on **dedicated module routes, NOT the /turn chat path**. That is the FIX-1
answer: `handleTurn`'s ends-with-a-question post-check is never touched and never sees these
turns, so reveal moments need no prompt-level exemption hack — the exemption is structural.
Each LLM call writes exactly one `budget_ledger` row (reuse `recordOnboardingTurn`), reuses
the tool-forcing patterns of `interview.ts`, and carries the scrub gate (prompts say "the
candidate", zero operator-identifying strings). Each gets a real receipt fn swapped into
`moduleRegistry` (internals-only change, union/signatures untouched).

### 2.0 Ownership note
Voice/metrics/mirror prompts live in a new `web/lib/anthropic/moduleTurns.ts`; the targeting
trim edits `interview.ts`. Both are B2 (§4).

### 2.1 Voice sample (1 LLM turn)

**Collection UX:** one panel, two tabs — "Paste something you wrote" (email, doc excerpt,
post; textarea, guidance 200–2000 chars, reminder: strip anything confidential) / "Write it
fresh" (prompt: "Explain what you actually do to a friend — like you'd text it. Three or four
sentences."). Placeholder copy carries the voice ("Typos fine. This is about how you sound.").
**Ingest turn** (`POST /api/onboarding/modules/voice`): forced tool `record_voice
{register, rhythm, words_used[], words_avoided[], signature_phrases[]}`. Prompt rules:
descriptive, never evaluative ("plainspoken, short sentences", not "good writer");
`signature_phrases` must be verbatim substrings of the sample (server-verify, drop any that
aren't); no personality inference; no grading. Writer → `voice-profile.md` (already in
`DOC_FILENAMES`) with those five sections. Receipt: `voice: {register}` e.g. "voice: dry,
compressed". Sample itself stored in `extracted.voice.sample` for the dossier.

### 2.2 Metric honesty pass (1 LLM turn + zero-LLM marking)

**Extraction** (`POST /modules/metrics/extract`): inputs = `cv.md` + `extracted` (calibration
evidence, energy, anchor). Forced tool `record_metric_claims {claims: [{id, text, source,
has_number}]}` — `text` verbatim from the inputs (server-verifies substring presence; non-
verbatim claims dropped), `source ∈ cv|range|energy|anchor`, only quantifiable/outcome claims,
max 12, never invented. **Marking UI:** each claim is a row — the claim as a quote
(`text-ink`, amber open-quote glyph), source chip (`Badge`, e.g. "from your resume"), and a
two-state segmented control: `Confident` / `Don't use`. Nothing pre-selected; the submit
button stays disabled until every row is marked (bulk "mark all confident" ghost link allowed
— honesty needs a floor, not friction). Framing copy: "Every number we found. Anything you
don't mark Confident will never appear in a resume or cover letter we write. This is the fence."
**Zero-LLM POST** `/modules/metrics` writes `article-digest.md`: `## Confirmed metrics` /
`## Never use` (verbatim lists + sources) — the tailor's V3b gate reads this file. Receipt:
"7 confirmed · 2 held back".

### 2.3 Mirror moment (1–2 LLM turns) — the emotional peak

**Generate** (`POST /modules/mirror/generate`): inputs = full `extracted` + current doc.
Forced tool `record_mirror {paragraphs: [string, string], quoted_phrases: string[]}`.
Prompt rules (constitutional): exactly two paragraphs, second person, ≤180 words total; must
weave in **at least two verbatim phrases the user actually wrote** (listed in
`quoted_phrases`, server-verified as substrings of their free-text answers; regenerate once on
failure, then degrade to fewer quotes rather than fake ones); never diagnoses or labels (ban:
personality types, "perfectionist", "type-A", any trait noun not evidenced); never states a
fact absent from the inputs; no exclamation marks; ends declaratively — no question (safe:
this text never passes the /turn post-check). **Reveal UX:** full panel, rail recedes
(opacity 40%). Heading `text-3xl tracking-tight`: "Here's who we think you are. You get final
say." Paragraphs `text-lg leading-relaxed max-w-prose`, entering sequentially (fade +
translateY, 400ms, 500ms stagger — sanctioned beat #2); the user's own quoted phrases
highlighted with a `color-mix(amber 25%)` underline-tint. Actions: `That's me — finish my
profile` (primary amber) · `Edit it` (ghost → in-place textarea swap, 150ms) · `Try again`
(one regen max, second ledger row). **Accept POST** (zero-LLM) writes the accepted text as
`thesis.md`'s intro (the "hunting judgment" prose the scorer already splices first) and stores
it in `extracted.mirror`; marks the module; onboarding completes. Closing screen states only
DB truth: "N matches waiting" (+ "re-scored while you talked" ONLY if hunt #2 ships — OQ1).

### 2.4 Budget

voice ~4k/0.4k tok ≈ $0.02 · metrics ~8k/0.6k ≈ $0.03 · mirror ~12k/0.6k ×(1–2) ≈ $0.05–0.09.
Plus the v2 conversational block (~$0.35 typical, targeting now shorter). **Total intake
≈ $0.45–0.55 typical, ≤ $0.85 worst case** — inside the $1.00 ceiling with headroom. All
other modules remain zero-LLM, zero-ledger.

---

## 3. The dossier — `/profile` (flagship; this page sets the visual ceiling)

Server component reads `profiles.doc` + `onboarding_sessions.{modules,extracted}` through a
pure mapper `web/lib/dossier/derive.ts` (structured truth from `extracted`; prose from doc
files; unit-testable, no migration). Nav gains "Profile".

**Layout (single column, `max-w-3xl` — matches feed; whitespace is the luxury):**
1. **Header** — name (or anchor title if unnamed) `text-5xl tracking-tight` — the app's one
   display-size moment; beneath, anchor line "Staff RF Engineer · Acme · 3 yrs" `text-lg
   text-ink-muted`; status line `text-sm`: "12 of 12 modules · last learned Jul 16".
2. **The mirror narrative** — the accepted two paragraphs, `text-lg leading-relaxed
   max-w-prose`, 2px full-strength amber left rule (the page's anchor of meaning). Inline
   editable (pencil → same editor as the reveal; save re-writes thesis intro + extracted).
3. **Three bands: FACTS / WANTS / TEXTURE** — band label `text-xs uppercase tracking-[0.2em]
   text-ink-muted` over a hairline (`border-line`); bands enter staggered `panel-enter` (60ms).
   - **FACTS:** anchor · evidence (resume state / cv provenance) · skills · **confirmed
     metrics** (confident list; held-back rendered collapsed: "2 numbers held back — never
     used in materials" — distrust made visible IS the trust feature) · logistics.
   - **WANTS:** values as chips showing the win over the loss ("Mission *over prestige*" —
     loser in muted strikethrough-free small text) · trajectory + tier hint · environment ·
     dealbreakers (danger-tinted chips) · tiers.
   - **TEXTURE:** energy signals (both answers as pull-quotes) · voice profile (register,
     signature phrases verbatim) · reaction taste summary (interested/passed counts + notes).
4. **"How this profile learns"** — the change-log stub: rows from `modules` sorted by
   `completed_at`: "Jul 16 14:02 — Values · 7 trade-offs chosen". Component takes an
   `events[]` prop with exactly this shape; wave-3 appends dismissal/tailor-edit events to the
   same list. Ship the pattern, not the plumbing.

**Traceability:** every section carries a source chip — "from Values · Jul 16" (module +
`completed_at`). Tap → popover with the receipt + primary link **"Redo this module"** →
`/onboarding?module=values`.

**Edit rule (one sentence, applied everywhere):** *if the user typed it, they can edit it in
place; if the system derived it, they redo the module that fed it.* Inline-editable: mirror
text, energy answers, dealbreaker items, metric marks (Confident/Don't-use toggles live right
on the dossier), voice sample. Redo-only: values/environment/trajectory choices, extracted
skills, voice descriptors, reactions. Never editable: receipts, timestamps, ledger.

**Validation surfacing:** run `validate.ts` at render; on failure a danger `Banner` — "2
sections need attention" — plus a `--color-danger` dot on each offending band and a one-line
plain-words reason with a "Fix in <module>" link. Never show raw validator strings.

**Amber dosage (full strength ONLY):** mirror left rule · source-chip hover · primary
buttons · active-edit focus ring. Everything else ink/ink-muted. No motion beyond band entry
and 150ms edit swaps — the dossier is calm; the intake is where beats live.

**Partial state:** pre-mirror visitors see whatever bands exist + a quiet banner "Finish your
intake — 4 modules left" → resumes at `next_module`.

---

## 4. Build decomposition (3 Sonnet sessions; reviewer writes final prompts)

Frozen for all: `moduleRegistry` union/signatures, `checkpoint.ts`, `incrementalDoc.ts`,
existing module/reactions routes, migrations 0011-. **No new migrations** — `modules` jsonb +
`extracted` + existing doc files cover everything above.

- **B1 — intake shell + structured panels.** Owns `web/app/(app)/onboarding/**` (page rebuild
  + tests), `web/components/onboarding/**` EXCEPT B2's three files (new: `PhaseRail`,
  `ReactionDeck`, `ValuePairsPanel`, `DealbreakersPanel`, `EnergyPanel`, `EnvironmentPanel`,
  `TrajectoryPanel`, `CheckpointInterstitial`), `web/app/api/onboarding/state/route.ts`
  (extend GET: modules, next_module, checkpoint_fired, match count). Pins the `ModulePanelProps`
  slot contract (verbatim in both B1/B2 prompts) so B2's panels drop in.
- **B2 — LLM modules.** Owns `web/lib/anthropic/interview.ts` (targeting trim) + new
  `moduleTurns.ts`, `web/lib/onboarding/handleTurn.ts` (range/evidence completion glue),
  `moduleRegistry.ts` receipt-internals swap (flagged: smallest possible diff, union/signatures
  untouched), new `moduleWriters/{voice,metrics,mirror}.ts`, routes
  `modules/{voice,metrics/*,mirror/*}`, components `VoicePanel` / `MetricsPanel` /
  `MirrorReveal` (+tests). Ledger row per LLM call; scrub gate; verbatim-substring server checks.
- **B3 — dossier.** Owns `web/app/(app)/profile/**`, `web/lib/dossier/**`,
  `web/components/dossier/**`, and the one-line nav addition in `(app)/NavLinks.tsx` (its only
  shared-file touch — call it out in the prompt). Read-only against db helpers; edit actions
  re-POST existing module routes.

Order: **B1 ∥ B3 first, B2 after B1's slot contract is pinned** (or parallel if the reviewer
pins `ModulePanelProps` in both prompts). File ownership is otherwise disjoint.

---

## 5. Open questions for the owner (build-changing only)

1. **Hunt #2 at mirror-accept?** "Re-scored twice while you talked" needs a second
   system-initiated dispatch (cooldown bypass + Actions cost) — or does the closing screen
   just show hunt #1's matches and a "Run my hunt" button? Changes B2's accept route + all
   re-rank copy (we will not claim re-ranks that didn't happen).
2. **v2 graduates (Saturday's friends):** grandfather them into the dossier with "7 of 12
   modules" prompts to fill the gaps, or re-run them through intake fresh? Changes B1's entry
   logic and B3's partial-state design.
3. **Metric extraction scope:** resume/cv only, or also chat free-text (calibration evidence,
   energy)? Broader = better fence but noisier claim list and chattier sources on the dossier.
   Changes B2's extraction prompt + B3's source chips.
