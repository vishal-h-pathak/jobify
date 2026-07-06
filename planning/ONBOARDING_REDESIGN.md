# Onboarding Redesign — flow v2 + visual direction

Status: design doc, pre-build. Owner verdict: "not happy at all with how the site looks"
(couldn't articulate why) + a restructured interview: anchor on title/company → tailored
open-ended calibration → resume becomes optional → 3-5 pointed targeting questions.
Everything feeds `profiles.doc`; profile quality IS product quality (docs/SCORING.md —
compiled rubric, profile embedding, LLM verdicts all read what onboarding writes).

---

## 1. Diagnosis — why the site feels wrong

The one-sentence version: **the entire product is built from a single visual register —
one bordered 8px-radius box, one text size, zero motion — so every screen reads as a
wireframe that shipped.** Specifics, all citeable:

1. **The chat is a full-width void.** The transcript is a giant outlined rectangle
   (`flex-1 … rounded-lg border border-line p-4`, `web/app/(app)/onboarding/page.tsx:295-298`)
   that on first load contains one small bubble in the top-left corner and ~500px of empty
   dark space. Nothing communicates scope ("~5 minutes, 4 steps"), nothing fills the space
   with purpose. It looks like a debug harness for a chat API.

2. **No visual hierarchy anywhere.** The onboarding h1 is `text-xl` (`page.tsx:284`) —
   *smaller* than the landing wordmark (`text-4xl`, `web/app/page.tsx:25`) and the same
   size as the login card heading (`LoginForm.tsx:66`). Body copy is `text-sm` in every
   component. Title, progress rail, transcript, composer all carry equal weight; the eye
   has nowhere to land. There is effectively a two-step type scale (xl, sm) for an entire
   product.

3. **One box to rule them all.** `Card` is the only container primitive
   (`web/components/ui/Card.tsx:5` — `rounded-lg border border-line bg-surface p-4`) and it
   is used for: assistant chat bubbles (`onboarding/page.tsx:301`), job matches
   (`MatchCard.tsx:55`), the login form (`LoginForm.tsx:64`), the done-state
   (`page.tsx:329`). "The assistant is speaking to you" and "here is a job posting" have
   identical visual containers. No elevation, no quiet/loud variants, no surface contrast
   beyond one border color.

4. **The progress rail is badge soup.** Four pills joined by literal `→` text characters
   (`page.tsx:286-293`), labels "Resume / Basics / What you want / Done" — "Done" as a
   step name, no fraction-complete affordance, no record of what each step captured. It
   reads as breadcrumbs, not progress, and it's the only wayfinding on the page.

5. **Zero motion.** The whole app has one 150ms color transition (`globals.css:44-49`)
   and pulsing typing dots (`page.tsx:320-322`). Messages pop into existence; stage
   completion — the emotional beat of the interview — changes a badge tint. Static
   interfaces read as cheap; this one is static everywhere except three dots.

6. **The brand is a period.** The complete brand system: wordmark + amber dot
   (`(app)/layout.tsx:29-31`, landing `page.tsx:26-27`) and a footer line. The amber
   `#f5a97f` (globals.css:20) is a muted peach that mostly appears at 15% opacity
   (Badge amber tone, user bubbles) where it nearly vanishes against `#131722`. The net
   palette impression is undifferentiated gray-blue "dark mode defaults," not a designed
   dark theme. Microcopy is system-neutral ("Building your profile", "Type your reply…") —
   no voice on the single screen where the product should be charming.

7. **The composer contradicts the flow.** A 3-row textarea plus an always-visible
   "Upload resume (.txt/.md)" button (`page.tsx:357-377`) persists through *all* stages —
   you can still be offered a resume upload while answering dealbreaker questions.
   Placeholder text never changes to hint what kind of answer the current question wants.

8. **The landing page's axis is broken.** A centered stack whose `<ol>` renders with no
   list markers (`flex flex-col` kills them, `web/app/page.tsx:33`) — the "3 steps" pitch
   reads as three stray left-aligned muted lines inside a centered column. Vertical
   button stack ("I have an invite" over "Sign in") under it.

9. **Widths jitter across routes.** Onboarding content is `max-w-2xl` (`page.tsx:283`),
   the feed and header are `max-w-3xl` (`feed/page.tsx:77`, `layout.tsx:28`) — navigating
   feed → onboarding visibly narrows the page under a wider header for no reason.

10. **The stakes/treatment inversion.** Onboarding is the highest-stakes surface in the
    product (SCORING.md: rubric + embedding + verdicts are all downstream of this one
    conversation) and it received the *least* designed treatment — less than the feed,
    less than login. A first-time invitee's entire impression is formed here.

What he's nodding along to: *it looks like an engineer's acceptance-test UI for a
pipeline, with dark tokens applied.* The fix is not new colors — the token palette is
fine — it's a second visual register (scale, weight, motion, staging) and an onboarding
surface designed as a moment rather than a chat window.

---

## 2. The new flow, formalized

### Stage machine

| # | stage (db) | UI surface | Asks | Extracts (tool) | LLM turns |
|---|---|---|---|---|---|
| 1 | `anchor` | structured form (no chat) | exact current/most recent job title + company; optional years-in-role | `extracted.anchor {current_title, current_company, years_in_role?}` — written server-side, **zero LLM calls** | 0 |
| 2 | `calibration` | generated card set + free-text answers | 4 open-ended prompts tailored to the anchored role (below) | `record_calibration {skills[], evidence[], range_statement, background_summary}` | 2 (generate set; ingest answers) |
| 3 | `resume` | chat turn + upload affordance, **skippable** | "Have a resume handy? Paste/upload it — or skip, we already have plenty." | `record_resume` (existing tool, now optional) | 0-2 |
| 4 | `targeting` | chat | batched logistics opener, then 3-5 pointed generated questions | `record_identity` (logistics; name only if unknown), `record_targeting`, `finish_interview` | 5-8 |
| 5 | `done` | summary card | — | — | 0 |

### Stage 1 — anchor (form, not conversation)

Two required fields (job title, company) + optional tenure. Submitted to a new
zero-LLM endpoint (`POST /api/onboarding/anchor`) that validates non-empty, writes
`extracted.anchor`, sets `stage='calibration'`. No ledger row — the ledger contract is
per *LLM turn*, and this spends none. An "I'm between roles / this doesn't fit me"
escape link switches the fields to "most recent title + company" with a free-text
"or describe your situation" fallback (open question #1 covers the fully-titleless case).
`current_title`/`current_company` land in `profile.yml` under `background_summary`
context and seed `portals.yml::title_filter.prefer_substrings`.

### Stage 2 — calibration (the "aptitude test", reframed) — **DECISION MADE, FLAGGED**

The owner's intent: calibrate *actual* skill level for the anchored role, and let people
align themselves outside their title. The word "test" cannot survive contact with the
audience — these are friends, most will be non-engineers, and "aptitude test" reads as
*being graded by your friend's robot*. Test anxiety produces short defensive answers,
which is the opposite of what the profile needs (rich text also feeds the stage-3
embedding).

**Framing shipped:** user-facing step name **"Show your range"**, intro copy on the card:
*"Four short prompts about the work itself. Not a test — no scores, no wrong answers.
This is how your feed learns what you can actually do, beyond what your title says."*
Hard prompt rules: the model NEVER evaluates, grades, praises correctness, or compares
answers to an expected answer; it records. Same tone bans as INT-1 (no "passion" etc.).
This keeps 100% of the owner's calibration intent (the *model* still infers level from
the answers) while removing the exam frame. If he wants the word "test" back, it's a
copy change, not a structural one.

**The generated set — exactly 4 items, one LLM turn, rendered as one card list:**

1. **Depth probe** — a concrete scenario from the core of the anchored role ("A
   {role-typical situation}. Walk me through how you'd handle it — a few sentences.").
   Open-ended means: no options, no rubric shown, answerable in 2-5 sentences, admits
   junior and principal answers alike. Level is inferred from tradeoffs/vocabulary, never
   asked directly.
2. **Breadth probe** — "Which parts of the job *around* your title do you get pulled
   into?" — surfaces adjacent skills the title hides.
3. **Range/realignment probe** (the owner's explicit requirement) — "If your next role
   were *outside* {current_title} work, what would you want it to be — and what from
   your current work carries over?" Answer may be "nothing, more of the same" — that's
   signal too.
4. **Evidence probe** — "Describe one piece of work you'd actually show someone —
   what it was, what you did, what happened."

**Answer → profile mapping:** skills mentioned across 1/2/4 → `key_technical_skills`;
answer 4 (+ concrete parts of 1) → `evidence[]` bullets; answer 3 → `range_statement`
(feeds tier candidates + thesis energy signals); the model synthesizes
`background_summary` from all four. The user answers all four in one submission
(one textarea per prompt in the card), which the server sends as a single user turn —
one ingest LLM call, one ledger row.

### Stage 3 — resume, now optional (the real behavioral change)

If provided (paste or .txt/.md upload, unchanged mechanics): existing INT-1 behavior —
reflect-back ending "— anything wrong or missing?", one correction turn max, then
`record_resume` (`web/lib/anthropic/interview.ts:58-67`). If **skipped** (explicit Skip
button, not an empty send — the empty-reply guard stays intact): `cv.md` is synthesized
at buildDoc time from anchor + calibration:

```
# CV — assembled from onboarding interview (no resume provided)
## {current_title} — {current_company} ({years_in_role})
- {evidence bullets from calibration}
## Skills
{key_technical_skills}
```

The provenance header comment matters: downstream (tailor-era) code can distinguish a
real CV from an interview-assembled one. Schema-wise this is safe — `cv.md` is
"Recommended", free-form markdown (`onboarding/schema/README.md:35`,
`markdown-files.md`), and `buildDoc.ts:179` already tolerates absence; we upgrade
absence to a synthesized minimum.

### Stage 4 — targeting

Opens with the batched logistics turn (base location, remote/onsite, comp floor —
verbatim rule from `interview.ts:69-77`), asking name ONLY if no resume was given and
it isn't otherwise known. Then **3-5 pointed questions, soft bounds**: keep INT-1's five
archetypes (direction forced-choice → tiers; trade-off → thesis weighting;
more-of/done-with → energy signals; dealbreakers → hard_disqualifiers; optional company
seed → portals) but generated as deltas against *anchor + calibration + resume-if-any*
— e.g. if calibration's range answer already declared a direction, the direction
question confirms instead of re-asking, and the count drops to 3-4. Ends with
`record_targeting` + `finish_interview` + plain-words profile summary (unchanged).

### Contracts preserved / changed

- **DB stage enum — additive migration, pinned: `jobify/migrations/0010_onboarding_stage_v2.sql`.**
  Current CHECK is `stage IN ('resume','identity','targeting','done')`
  (`0003_hosted_onboarding.sql:104-105`), default `'resume'`. Migration (idempotent,
  0003 style):
  1. `ALTER TABLE public.onboarding_sessions DROP CONSTRAINT IF EXISTS onboarding_sessions_stage_check;`
  2. `UPDATE public.onboarding_sessions SET stage='targeting' WHERE stage='identity';`
     (in-flight v1 sessions: identity folds into targeting's opener)
  3. `ADD CONSTRAINT onboarding_sessions_stage_check CHECK (stage IN ('anchor','calibration','resume','targeting','done'));`
     — `'resume'` deliberately kept valid so surviving v1 rows mid-resume stay legal.
  4. `ALTER COLUMN stage SET DEFAULT 'anchor';`
  Completed (`status='complete'`) sessions are untouched; grandfathering is open question #5.
- **PII rules unchanged and re-asserted:** never work-auth / visa / start date /
  relocation-for-forms / AI-policy-ack (`interview.ts:72-76`); `application_defaults`
  written blank (`buildDoc.ts:72-80`); auth email overwrites any model-supplied email
  every turn (`handleTurn.ts:70-72`). Calibration prompt additionally instructs: don't
  solicit confidential employer specifics — "describe the shape, not the secrets."
- **FIX-1 behaviors preserved structurally** (session 25): (a) every non-terminal
  assistant turn ends with exactly one question — enforced by the deterministic
  post-check in `handleTurn` (prefer post-check over prompt-only, per 25's tests), with
  the fallback map extended to the new stages: `calibration` → first unanswered prompt,
  `resume` → the resume-optional ask, `targeting` → batched logistics; (b) empty-reply
  guard: retry once, then deterministic stage-appropriate fallback, never persist a
  blank bubble; (c) never ask resume/anchor-known fields (anchor data joins the
  "never re-ask" set).
- **Ledger:** one row per LLM turn, unchanged (`handleTurn.ts:74-79`). Anchor = 0 rows.
- **Validation:** final doc still validates via `upsertProfileDoc` → schema
  (`handleTurn.ts:88-89`); tiers/disqualifiers/thesis remain required non-empty
  (`record_targeting` required fields unchanged, `interview.ts:175`).

### Budget (claude-sonnet-5, $3/$15 per MTok — `pricing.ts:10-12`)

| Phase | Turns | ~Input tok | ~Output tok |
|---|---|---|---|
| Calibration generate + ingest | 2 | 9k | 1.1k |
| Resume reflect + confirm (if given, ~4k tok resume) | 2 | 19k | 0.9k |
| Targeting (logistics + 4 q + finish) | 6 | 70k | 1.8k |
| **Typical total** | **10** | **~98k → $0.29** | **~3.8k → $0.06** |

**≈ $0.35 typical; ≈ $0.70 worst case** (long resume, 5 questions, one empty-reply
retry). 2x headroom under the $1.50 ceiling and under the $5 default monthly cap
(`ledger.ts:29`) even stacked with a first hunt. Prompt caching the system prompt would
cut input ~50% but is not required to meet budget — note it as a follow-up, don't spend
a session on it.

---

## 3. Visual redesign direction (onboarding surface)

**Layout: hybrid staged surface, not a chat window.** One route, one component shell;
a stage panel swaps per stage. Anchor and calibration are structured cards (form
fields / prompt list) — conversation has not earned its keep there. Resume and
targeting are conversational, restyled. Kill the outer bordered transcript box
entirely; the page itself scrolls. Width: `max-w-2xl` stays but the header/footer
shell should adopt it on this route (or onboarding adopts 3xl) — pick one, stop the
jitter.

**Progress: a step spine that doubles as a receipt.** Replace the badge-arrow rail
(`page.tsx:286-293`) with a horizontal spine: `01 Role · 02 Range · 03 Resume (optional)
· 04 What you want`. Completed steps collapse to a check + a one-line capture summary
("{title} · {company}", "4 answers", "resume added" / "skipped — built from your
answers"). A 2px amber underline animates width per stage (400ms ease-in-out). This
converts "progress" into visible evidence the profile is being assembled — the core
product promise.

**Typography scale — introduce a real ramp:** stage title `text-3xl font-semibold
tracking-tight`; the current question / prompt text `text-lg text-ink` (questions are
the protagonist — today they're `text-sm` inside a Card, `page.tsx:302`); answers, meta,
help text `text-sm text-ink-muted`; spine labels `text-xs`. Landing h1 stays 4xl; app
pages get h1 `text-2xl` minimum.

**Chat restyle (resume + targeting stages):** assistant messages drop the Card — plain
text on the page background with a 2px amber left rule, `max-w-prose`, relaxed
line-height. User replies stay as right-aligned amber-tinted chips (keep
`page.tsx:242-243` styling). Result: the assistant reads as *the product speaking*, not
a boxed log entry, and it's visually distinct from feed cards.

**Motion (all honoring `prefers-reduced-motion`):**
- Stage panel enter: 240ms ease-out, `translateY(8px)→0` + fade.
- Message enter: 180ms same curve.
- Step-complete check: stroke draw ~300ms; spine underline 400ms ease-in-out.
- Calibration generation is a slow (~5-10s) LLM call — a purposeful loading state, not
  the typing dots: skeleton prompt cards + rotating single line ("Reading your role…" /
  "Writing your four prompts…").
- Keep the typing dots for normal chat turns; keep 150ms color transitions.

**Empty/loading states:** initial state fetch renders a skeleton of the spine + panel
(not the centered spinner void, `page.tsx:266-272`). Done state becomes a real moment:
the summary card listing what'll rank up / never show / logistics recap (content already
mandated by the prompt, `interview.ts:99-101`) + primary button "Run my first hunt".

**Component changes (before → after):**
1. **`Card`** — add `variant?: "default" | "quiet" | "elevated"` (quiet: no border,
   `bg-surface/50`; elevated: border + `shadow-lg shadow-black/20`). Calibration prompts
   use elevated; chat stops using Card.
2. **New `StepSpine`** (components/onboarding/) — replaces the Badge rail; Badge returns
   to being a data chip (scores, states), which is what it's shaped for.
3. **`TextArea`** — autosize up to ~8 rows; amber focus ring already exists globally
   (`globals.css:51-54`) — keep. Context placeholder driven by stage ("A few sentences —
   plain language is fine.").
4. **Composer** — upload affordance rendered ONLY in the resume stage, alongside an
   explicit `Skip — use my answers instead` ghost button; Send stays primary-amber.
5. **New `AnchorForm` + `CalibrationPanel`** (components/onboarding/) — labeled `Input`
   pair with inline validation; prompt list with per-prompt textareas and a single
   submit.

**Palette: stay within existing tokens.** The problem is dosage, not hue: use `--color-amber`
at full strength for the spine underline, left rules, and primary actions instead of
15% tints. One permitted flourish, zero new tokens: a fixed, very subtle radial glow
behind the onboarding panel via `color-mix(in srgb, var(--color-amber) 6%, transparent)`
— gives the surface depth no other screen has, cheap to delete if disliked.

---

## 4. Decomposition into build sessions (outlines — reviewer writes finals)

**Session A — interview v2 backend (Sonnet, worktree off main).**
Owns: `web/lib/anthropic/interview.ts` (+test), `web/lib/onboarding/{handleTurn,applyToolCalls}.ts`
(+tests), `web/lib/profile/buildDoc.ts` (+test), `web/app/api/onboarding/**` (state,
turn, new anchor route), `jobify/migrations/0010_onboarding_stage_v2.sql` — nothing else.
Scope: new stage enum + migration exactly as §2; new system prompt (stages, calibration
rules, tone bans, PII bans, FIX-1 rules carried verbatim); tools `record_anchor` (server
applies, not model), `record_calibration`; `record_resume` optional path + skip handling;
extended per-stage fallback-question map; cv.md synthesis in buildDoc.
Tests: migration idempotency note; applyToolCalls stage advancement across all 5 stages;
skip-resume → synthesized cv.md validates; auth-email overwrite still unconditional;
prompt contains never-evaluate + always-end-with-question + PII-ban strings; empty-reply
retry→fallback per new stages; exactly one ledger row per LLM turn incl. zero for anchor;
final doc passes validator fixture. Scrub gate PASS.

**Session B — onboarding surface rebuild (Sonnet, after A merges; needs A's types).**
Owns: `web/app/(app)/onboarding/**`, new `web/components/onboarding/**` — does NOT touch
`components/ui/` (Card variant ships in C; B uses plain divs if C hasn't landed).
Scope: staged shell + `StepSpine` receipt rail, `AnchorForm`, `CalibrationPanel`,
chat restyle (no outer box, amber-rule assistant messages), stage-aware composer
(upload + Skip only in resume stage), motion + reduced-motion, skeleton/loading/done
states per §3. Keep reducer + pure-helper testing convention (`page.tsx:34-39`).
Tests: reducer transitions for new stages incl. anchor submit + skip; spine derivation
from stage+extracted summaries; draft preserved on failure (existing rule,
`page.tsx:214-217`); upload only reachable in resume stage.

**Session C — shell + design-system polish (Sonnet, parallel with A; disjoint files).**
Owns: `web/components/ui/{Card,Input}.tsx` (+tests), `web/app/page.tsx`,
`web/app/(app)/layout.tsx`, `web/app/globals.css`.
Scope: Card variants, TextArea autosize, landing-page axis fix (numbered steps rendered
as designed list, horizontal CTA pair), width consistency decision, motion utility
classes + reduced-motion media query.
Tests: Card variant class mapping; landing renders 3 visibly numbered steps; existing
ui tests stay green. No copy may include operator-identifying strings (scrub gate).

Order: **A ∥ C, then B.** File ownership is disjoint; migrations only in A.

---

## 5. Open questions for the owner

1. **No-title users:** friends who are students / between roles / career-switching — is
   "most recent title + company" + a free-text fallback acceptable for the anchor, or do
   they get a separate path? (Changes AnchorForm + calibration generation input.)
2. **Show the extraction?** After calibration, do we show the skills/evidence we
   extracted for a one-tap edit before it's written, or keep extraction invisible?
   (Trust + accuracy vs. added friction on the critical path.)
3. **Post-onboarding resume upload:** if someone skips the resume, may they add one later
   from settings — which means code updating `cv.md` after the initial write, currently
   promised never to happen (`buildDoc.ts:114-118` header)? Yes changes that contract.
4. **Fixed five vs. generated 3-5 targeting questions:** generated deltas are smarter but
   less predictable across users; fixed is testable and comparable. Which do you want to
   debug in beta?
5. **Existing users:** the handful already onboarded under v1 — grandfather their
   profiles, or invite them through the new flow (wiping/regenerating their doc)?
