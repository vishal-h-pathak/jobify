# Session 28 — ONB-B: Onboarding surface rebuild  (Onboarding-v2 wave 2, parallel with ONB-D)

**Model: Sonnet.** Spec = `planning/ONBOARDING_REDESIGN.md` §3 (visual
direction — your blueprint) + §2 (the flow you're rendering). Read both first.
**Run from:** a `jobify-wt/hosted-onbv2-surface` worktree off main.
**Depends on:** ONB-A and ONB-C merged (new stage API + Card variants/motion
utilities exist).
**You own:** `web/app/(app)/onboarding/**`, new `web/components/onboarding/**`,
their tests. Do NOT touch `web/lib/**` (ONB-A's contracts are frozen —
consume them), `web/components/ui/**`, `web/app/api/**`, admin/settings/feed,
`jobify/`, migrations.

## Build (§3, condensed to obligations)

1. **Staged shell replaces the chat window:** one route, per-stage panel swap
   with the panel-enter motion utility; NO outer bordered transcript box —
   the page scrolls. Content width matches ONB-C's decision (see their merge
   report; default `max-w-3xl`). Apply the amber-glow utility behind the
   panel.
2. **`StepSpine`** (new component): `01 Role · 02 Range · 03 Resume (optional)
   · 04 What you want`; completed steps collapse to check + one-line capture
   receipt exactly as §3 ("{title} · {company}", "4 answers", "resume added" /
   "skipped — built from your answers"); animated 2px amber underline (400ms).
   Badge goes back to data chips only.
3. **`AnchorForm`:** labeled title+company inputs + optional tenure, inline
   validation, the "I'm between roles / this doesn't fit" escape swapping to
   most-recent + free-text situation field (owner decision #1). Zero-LLM
   submit to ONB-A's anchor route.
4. **`CalibrationPanel`:** intro copy VERBATIM from §2 ("Four short prompts…
   Not a test — no scores, no wrong answers…"); four elevated-variant prompt
   cards each with an autosizing textarea; single submit sends all four as one
   turn. Generation loading state = skeleton prompt cards + the rotating
   single line (§3), not typing dots.
5. **Chat restyle for resume + targeting stages:** assistant = plain text,
   2px amber left rule, `max-w-prose`, `text-lg` for the active question;
   user replies stay amber-tinted right chips. Typing dots stay for chat
   turns.
6. **Stage-aware composer:** upload + "Skip — use my answers instead" ghost
   button rendered ONLY in the resume stage; stage-driven placeholder copy;
   Enter/Shift-Enter, draft-preservation-on-error, and resumable-session
   behaviors all preserved (existing tests must keep passing, adapted to the
   new shell).
7. **Done state:** the §3 summary moment (rank-up / never-show / logistics
   recap) + primary "Run my first hunt" button linking to the feed.

## Tests

Reducer/pure-helper convention (keep it): transitions across all five stages
incl. anchor submit and resume skip; spine receipt derivation from
stage+extracted; upload/skip reachable only in resume stage; draft preserved
on failed turn; done-state renders the three recap sections. Reduced-motion:
panels render without animation classes when the utility is disabled (however
ONB-C exposed it).

## Exit criteria

`npm run build` + vitest + tsc green; scrub gate PASS; diff inside ownership.
Commit: `ONB-B: staged onboarding surface — StepSpine receipt, AnchorForm, CalibrationPanel, chat restyle`.
Push; do NOT merge — review-then-merge. Close-out includes `vercel --prod`.
