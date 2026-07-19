#!/usr/bin/env bash
# merge-ux1.sh — UX-1 reviewer merge: feat/ux1-gate + feat/ux1-dossier-export
# into main, with three PRE-AUTHORED reviewer fixups (in ops/waves/fixups/ux1/):
#   1. handleTurn.merged.ts — resolves the expected conflict between main's
#      live-fire targeting-loop hotfix and session 44's "identity" stage-literal
#      removal (union of both: identity case gone AND context-aware fallback).
#   2/3. next.config.ts + vitest.config.ts — REQUIRED: session 44's build-time
#      aliases point "@/lib/onboarding/intakeComplete" at a stub; once 43's real
#      helper merges, the alias would silently ship the STUB to production.
#      De-aliased configs restore normal resolution; the stub + ambient d.ts
#      are deleted outright.
# No migrations this wave. Stops before push.
# Run from anywhere:  bash merge-ux1.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
FIX="$JOBIFY/ops/waves/fixups/ux1"
cd "$JOBIFY"

echo "── preflight ──"
git rev-parse --verify feat/ux1-gate >/dev/null
git rev-parse --verify feat/ux1-dossier-export >/dev/null
for f in handleTurn.merged.ts next.config.ts vitest.config.ts; do
  [ -f "$FIX/$f" ] || { echo "ERROR: missing fixup $FIX/$f"; exit 1; }
done
git checkout main
[ -z "$(git status --porcelain)" ] || { echo "ERROR: main working tree not clean."; exit 1; }

echo "── merge gate ──"
git merge --no-ff feat/ux1-gate -m "Merge UX1-A: intake gate — completion helper, route guard, nav states, empty states"

echo "── merge dossier-export (handleTurn conflict expected and pre-resolved) ──"
if ! git merge --no-ff feat/ux1-dossier-export -m "Merge UX1-B: dossier export (md + AI copy + print) + stage-literal and applied-guard paper cuts"; then
  CONFLICTS="$(git diff --name-only --diff-filter=U)"
  if [ "$CONFLICTS" != "web/lib/onboarding/handleTurn.ts" ]; then
    echo "ERROR: unexpected conflict set:"; echo "$CONFLICTS"
    echo "Resolve manually or abort with: git merge --abort"; exit 1
  fi
  cp "$FIX/handleTurn.merged.ts" web/lib/onboarding/handleTurn.ts
  git add web/lib/onboarding/handleTurn.ts
  git commit --no-edit
  echo "handleTurn conflict resolved with the pre-authored union."
fi

echo "── reviewer fixup: de-alias the intakeComplete stub (prod-correctness) ──"
cp "$FIX/next.config.ts" web/next.config.ts
cp "$FIX/vitest.config.ts" web/vitest.config.ts
git rm -q --ignore-unmatch web/lib/onboarding/intakeCompleteStub.ts web/types/intakeComplete-ambient.d.ts
git add web/next.config.ts web/vitest.config.ts
git commit -m "UX-1 reviewer fixup: remove intakeComplete stub aliases + stub/ambient files (real helper now merged; alias would have shipped the stub)"

echo "── union verification ──"
( cd web && npx vitest run && npx tsc --noEmit && npm run build )
if [ -f .venv/bin/activate ]; then ( source .venv/bin/activate && pytest -q ); else pytest -q; fi
bash scripts/scrub_gate.sh

echo ""
echo "ALL GREEN — next steps:"
echo "  1. git push origin main"
echo "  2. cd web && vercel --prod"
echo "  3. The gate test: open the site while your intake is incomplete — every page"
echo "     should funnel to /onboarding, nav collapsed to 'Your intake — N of 12'."
echo "  4. Finish the intake -> the nav unlocks -> /profile -> 'Your dossier, yours"
echo "     to keep' -> download the markdown. That file is D5, in your hands."
echo "NOT pushed — local main only. No DB changes this wave."
