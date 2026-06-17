# Seeding `portals.yml` + verifying ATS slugs

`portals.yml` tells the hunter which company job boards to poll and how to
pre-filter titles before any LLM scoring. Discovery is **zero-token**: the
hunter hits each board's public API directly over HTTP/JSON. A wrong or dead
slug just yields nothing (logged + dropped at runtime), so the only real
requirement is that the slugs you ship are **verified** and the `title_filter`
lists are non-empty.

## How to seed from the interview

From the dream companies / industries gathered in stage 3:

1. For each named company the user is excited about, find which ATS it uses and
   its slug (procedure below). Drop verified rows into the matching section.
2. It is completely fine to ship **a few verified boards + empty sections** the
   user grows later. An empty `companies: []` is safe.
3. Build `title_filter` from their target titles (stage 3) and disqualifiers:
   - `reject_substrings` — titles to auto-skip before scoring: leadership /
     non-engineering / clearly-irrelevant terms (`intern`, `vp of`, `recruiter`,
     `account executive`, …). Real disqualifiers only — be conservative; better
     to over-score than miss a good role on a noisy keyword.
   - `prefer_substrings` — strong-positive title signals for THIS person (their
     target titles). Logged as a hint; does not gate.
   - `seniority_substrings` — seniority hints (`senior`, `staff`, `principal`,
     `lead`, …). Logged only.

   All three lists **must be non-empty** (schema `minItems: 1`).

## Find + verify an ATS slug

The slug lives in the company's careers-page URL. Identify the ATS, extract the
slug, then **confirm the board API returns jobs for the RIGHT company** before
trusting it.

| ATS | Careers URL shape | Slug | Verify (expect JSON jobs for the right company) |
|---|---|---|---|
| Greenhouse | `boards.greenhouse.io/<slug>` or `job-boards.greenhouse.io/<slug>` | `<slug>` | `curl -s https://boards-api.greenhouse.io/v1/boards/<slug>/jobs \| head` |
| Lever | `jobs.lever.co/<slug>` | `<slug>` | `curl -s https://api.lever.co/v0/postings/<slug> \| head` |
| Ashby | `jobs.ashbyhq.com/<slug>` | `<slug>` | `curl -s https://api.ashbyhq.com/posting-api/job-board/<slug> \| head` |
| Workday | `<tenant>.wd<N>.myworkdayjobs.com/<site>` | tenant + site + dc=`<N>` | open the careers URL; confirm it lists the company's own jobs |

Verification checklist:
- The response is JSON (not a 404 / HTML error page) **and** the postings are
  this company's own roles (some slugs are squatted or shared — eyeball a couple
  of titles/locations).
- A slug that 404s won't crash a run, but remove dead entries so logs stay clean.
- Record the verify URL as a trailing comment on each row (see
  `profile.example/portals.yml`).

Workday rows carry richer metadata — each needs `tenant`, `site`, `dc` (the
`wd<N>` number from the URL), and `name`. Most small companies don't run a public
Workday board, so leaving `workday.companies: []` is common and fine.

## Example shape

```yaml
greenhouse:
  companies:
    - slug: stripe
      name: Stripe          # verify: boards-api.greenhouse.io/v1/boards/stripe/jobs
ashby:
  companies:
    - slug: linear
      name: Linear          # verify: api.ashbyhq.com/posting-api/job-board/linear
lever:   { companies: [] }
workday: { companies: [] }
title_filter:
  reject_substrings: ["intern", "vp of", "recruiter", "account executive"]
  prefer_substrings: ["platform engineer", "backend engineer", "distributed systems"]
  seniority_substrings: ["senior", "staff", "principal", "lead"]
```
