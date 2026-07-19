# Session 39 — V3C-KIT: submitter onboarding + submit kit (UI)  (V3c P0, parallel with 40)

> Supersedes the earlier truncated draft of this file (pre-dated
> `planning/V3C_DESIGN.md` v2.1; a prior session was interrupted mid-write).

**Model: Sonnet.** Spec = `planning/V3C_DESIGN.md` (v2.1) §3 (L4), §5, §9 (P0)
— read FIRST. This is the surface half of V3c P0: the one-time submitter
onboarding that collects application defaults, and the zero-automation submit
kit that makes every tailored match submittable BY HAND, beautifully, on any
browser, while the extension is built. Stop-at-submit is trivially true here:
nothing automates anything. **No LLM calls in this session.**
**Branch:** `feat/v3c-kit` off main, worktree `jobify-wt/v3c-kit`.
**You own:** `web/app/(app)/submit/**` (new: setup wizard + kit page),
`web/components/submit/**` (new), a small "Application defaults" card in
`web/app/(app)/settings/` (additive), the "Prepare to apply" affordance where
tailored materials already surface (`web/components/feed/TailorAction.tsx` /
the materials viewer header — additive, do not restructure), tests. Do NOT
touch: `web/app/api/**`, `web/lib/submit/**`, `web/lib/crypto/**` (all 40's),
migrations, `jobify/` Python, onboarding/dossier internals, the S3 viewer
components' existing behavior.

## PINNED CONTRACT (shared verbatim with session 40 — consume EXACTLY)

```ts
// POST /api/submit/profile   body: ApplicationProfile → 204
// GET  /api/submit/profile   → 200 ApplicationProfile | 404 (never onboarded)
// GET  /api/submit/packet?posting_id=<id>
//   → 200 SubmitPacket
//   | 409 {error:"no_application_profile"}   (UI redirects to submitter setup)
//   | 404 {error:"no_materials"}             (no succeeded tailor run yet)

type ApplicationProfile = {
  contact: { phone?: string; location?: string; linkedin_url?: string;
             github_url?: string; portfolio_url?: string };
  authorization: { work_authorized?: "yes"|"no";
                   visa_sponsorship_needed?: "yes"|"no"; notes?: string };
  logistics: { notice_period?: string; earliest_start?: string;
               salary_expectation?: string };
  self_id: { gender?: string; race_ethnicity?: string;
             veteran_status?: string; disability_status?: string };
  updated_at?: string;  // set server-side on save; every field optional
};

type SubmitPacket = {
  posting: { id: string; title: string; company: string;
             application_url: string; ats_kind: string };
  identity: { first_name: string; last_name: string; full_name: string;
              email: string; phone: string; location: string; linkedin_url: string;
              github_url: string; portfolio_url: string };  // missing = "" (render-what-exists)
  materials: { resume_pdf_url: string; cover_letter_pdf_url: string;
               cover_letter_text: string };  // short-lived signed URLs
  authorization: ApplicationProfile["authorization"];
  logistics: ApplicationProfile["logistics"];
  self_id: ApplicationProfile["self_id"];
  meta: { tailor_run_id: string; doc_sha256: string | null; generated_at: string };
};
```

Session 40 ships the routes; code against this contract (integration verified
at the reviewer's merge). Local test mocks return these exact shapes.

## Build

1. **Submitter onboarding** (`/submit/setup`, V3C_DESIGN §5): a one-time
   multi-step wizard — contact → work authorization/sponsorship → logistics
   (notice period, earliest start, salary stance) → **voluntary
   self-identification** → review → save (POST profile). Every field
   skippable; the self-ID step leads with plain privacy copy: encrypted at
   rest, never shown to anyone (including admins), used only to fill the boxes
   you'd otherwise fill by hand; leave anything blank and the submitter leaves
   that box blank. Reuse the intake design language (PhaseRail-style progress,
   warm-dark editorial per PRODUCT_VISION.md §4, zero exclamation marks). The
   Settings "Application defaults" card is the edit surface afterward (opens
   the same steps prefilled from GET profile).
2. **The kit** (`/submit/[postingId]`): fetch the packet; on 409 redirect to
   `/submit/setup` (with a return-to param); on 404 show an honest empty state
   pointing at "Tailor this" first. One purposeful page per application:
   - the posting: title, company, and **"Open the application"** as the
     primary action (opens `application_url` in a new tab), `ats_kind` shown
     as quiet meta;
   - the materials: resume PDF + cover letter PDF download buttons (packet's
     signed URLs) and the cover-letter BODY as copyable text;
   - **the answer sheet:** label-over-value with a per-item copy button for
     every non-empty packet value — identity fields, authorization, logistics,
     self-ID (its section is visually set apart and marked "voluntary — you
     chose to store these"). Render-what-exists: empty values simply don't
     render. NOTHING appears that isn't in the packet — never-fabricate
     applies verbatim; this page invents no prose.
   - a completion checklist ("open → upload resume → paste letter → fill from
     the sheet → review → you click Submit") and an **"I applied" action**
     wired to the existing applied-marking mechanism the feed already has
     (find and reuse it — do not invent a parallel state);
   - print CSS: the page prints as a clean one-sheet crib.
3. **Entry points:** on any match with a succeeded tailor run, surface
   "Prepare to apply" (→ the kit) next to the existing Materials affordance;
   the materials viewer header gets the same link. Additive only.

## Tests
Wizard: step flow, skippability (empty save is valid), self-ID privacy copy
present, settings card round-trip prefill; kit: 409 → setup redirect, 404
empty state, answer-sheet renders exactly the non-empty packet values (mock
packets: full, sparse, empty-self-ID), copy buttons per item, applied action
calls the existing mechanism (spy), print stylesheet applies. Alex Quinn
persona in all mock packets. Full suites green.

## Exit criteria
Web vitest + tsc + build green; scrub gate PASS; diff inside ownership (no
api/lib/migrations files). Commit:
`V3C-KIT: submitter onboarding wizard + submit kit page`. Push; do NOT merge.
