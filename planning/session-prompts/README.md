# jobify — Claude Code session prompts

Each file here is a self-contained prompt to paste into a fresh Claude Code
session. They build jobify per `../PROJECT_PLAN.md`. Run in dependency order
(waves below). Each prompt ends with exit criteria and a commit message.

## Order & dependencies

```
Wave 0 (serial, first):   00  Phase 0 — scaffold & extract
                              │
Wave 1 (parallel):        01  WS-A1  freeze profile contract + example persona
                          02  WS-B   dashboard carve-out + trim
                          03  WS-C   schema / infra / setup docs
                              │   (01 must finish before Wave 2)
Wave 2 (parallel):        04  WS-A2  persona-data audit        (needs 01)
                          05  WS-D   generalize submit prefill (needs 01; coord w/ 04 on _common.py)
                          06  WS-E   onboarding flow           (needs 01)
                          07  WS-F   ATS-safe resume gallery   (needs 01)
                              │
Wave 3 (serial, last):    08  Phase F — integration & verification (needs all)
```

## How to run

1. **Wave 0 — Session 00**, from the parent dir containing `job-pipeline/`,
   `portfolio/`, `jobify/`. Let it finish and commit.
2. **Wave 1 — Sessions 01, 02, 03.** These touch disjoint trees and can run at
   the same time. Two ways:
   - *Simple:* run them one after another in the same `jobify/` checkout,
     committing between each.
   - *Truly parallel:* give each its own git worktree
     (`git worktree add ../jobify-wsB`, etc.), run concurrently, then merge.
   **Wave 1 → Wave 2 gate:** Session 01 (WS-A1) must be merged before starting
   Wave 2 — 04/05/06/07 all consume the frozen profile contract.
3. **Wave 2 — Sessions 04, 05, 06, 07.** Parallel-safe, with ONE caveat:
   04 (WS-A2) and 05 (WS-D) both can touch `submit/adapters/_common.py`. Let 04
   own that file (it makes `applicant_fields` read the loader); run 05 after 04,
   or keep 05 off that file. Everything else is disjoint.
4. **Wave 3 — Session 08**, alone, after all others merge.

## Tips
- Each prompt says where to run from and what it depends on — keep that header.
- Commit after every session; the prompts assume clean checkpoints.
- If you use worktrees for parallelism, merge each wave fully before the next.
- The shared test fixture is the example persona from WS-A1 / WS-E
  (`profile.example/` and `onboarding/examples/`); other sessions assume it.
```
