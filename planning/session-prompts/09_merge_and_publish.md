# Session 09 — Merge, settle & publish  (SERIAL — run last, alone)

**Run from:** `/Users/jarvis/dev/jarvis/jobify` (the main checkout).
**Depends on:** all build sessions + Phase F (`08`) complete; tag `v0.1.0` exists.
**Goal:** consolidate every branch/worktree into `main`, re-verify the repo is
clean, push `main` + the tag to the GitHub remote, and remove the temporary
worktrees and branches. Do NOT force-push. Do NOT commit any `.env` or `profile/`.

---

## 0. Pre-flight — understand the current state (read-only)

Run and report before changing anything:

```bash
git status
git log --oneline -6
git tag --list 'v*'
git rev-parse v0.1.0          # the intended release commit
git branch -vv
git worktree list
git remote -v
```

Stop and ask the user if: the working tree has uncommitted changes you didn't
expect, or `v0.1.0` doesn't resolve, or `main` has diverged from the v0.1.0
commit in a way that isn't a clean fast-forward.

## 1. Consolidate onto `main`

The Phase F work (and tag `v0.1.0`) may sit on a `phaseF` branch. Bring `main`
to the release commit:

```bash
git switch main
git merge --ff-only phaseF      # fast-forward; if it refuses, inspect with `git log --graph --oneline main phaseF` and report before merging non-ff
```

If any other feature branch (`wsA wsB wsC wsA2 wsD wsE wsF`) is NOT already an
ancestor of `main` (check `git branch --merged main`), report which and why
before doing anything — by this point they should all be merged.

## 2. Final verification gate (must pass before push)

```bash
source .venv/bin/activate 2>/dev/null || (python3.11 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]" -q)
make scrub                      # the CI scrub gate (persona text + stray pdf/docx). MUST pass.
pytest -q                       # expect green (≈461 passed)
( cd dashboard && npm install && npx tsc --noEmit )   # dashboard type-checks
git ls-files | grep -iE '(^|/)\.env($|\.)|/\.env\.local$' | grep -v '\.example' || echo "no secrets tracked — good"
git ls-files 'profile/*' || echo "live profile/ not tracked — good"
```

If `make scrub` or `pytest` fails, STOP and report — do not push.

## 3. Push to the GitHub remote

Remote: `https://github.com/vishal-h-pathak/jobify.git`

```bash
git remote get-url origin 2>/dev/null || git remote add origin https://github.com/vishal-h-pathak/jobify.git
git push -u origin main
git push origin v0.1.0
```

- If the push is REJECTED as non-fast-forward, the GitHub repo was initialized
  with content (e.g. an auto-created README/LICENSE). Do NOT force-push. Instead
  `git pull --rebase origin main`, re-run `make scrub` + `pytest`, then push
  again — and report what was on the remote.

## 4. Clean up worktrees & branches

```bash
git worktree list
# remove every ../jobify-ws* / ../jobify-phaseF worktree that still exists:
git worktree remove ../jobify-wsA  2>/dev/null
git worktree remove ../jobify-wsB  2>/dev/null
git worktree remove ../jobify-wsC  2>/dev/null
git worktree remove ../jobify-wsA2 2>/dev/null
git worktree remove ../jobify-wsD  2>/dev/null
git worktree remove ../jobify-wsE  2>/dev/null
git worktree remove ../jobify-wsF  2>/dev/null
git worktree remove ../jobify-phaseF 2>/dev/null
git worktree prune
git branch -d wsA wsB wsC wsA2 wsD wsE wsF phaseF 2>/dev/null   # -d only deletes fully-merged branches; safe
git worktree list && git branch -vv
```

If any `git worktree remove` complains the worktree is dirty, report it rather
than forcing — there may be unmerged work there.

## 5. Report

Summarize: the commit `main` now points at, that `v0.1.0` is pushed, the remote
URL, the verification results (`make scrub` / pytest / dashboard), and the final
`git worktree list` + `git branch` state. Confirm the repo is clean and the tag
is live on GitHub.

## Guardrails
- Never `git push --force` / `-f`.
- Never `git add -A` without first confirming no `.env`, `.env.local`, or
  `profile/` files are staged.
- If anything is ambiguous (diverged history, dirty worktree, remote already
  has commits), STOP and report instead of resolving destructively.
