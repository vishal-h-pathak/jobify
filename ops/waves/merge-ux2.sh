#!/usr/bin/env bash
# merge-ux2.sh — merge feat/ux2 (session 52) into local main with full
# verification. Does NOT push. Run after cockpit review of the report.
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
cd "$JOBIFY"
[ -z "$(git status --porcelain)" ] || { echo "ERROR: main tree not clean."; exit 1; }
git rev-parse --verify feat/ux2 >/dev/null 2>&1 || { echo "ERROR: branch feat/ux2 not found."; exit 1; }
if [ -x "$JOBIFY/.venv/bin/pytest" ]; then PYTEST="$JOBIFY/.venv/bin/pytest"; else PYTEST="python3 -m pytest"; fi

git merge --no-ff feat/ux2 -m "merge feat/ux2: auth-first routing, truthful hunt button, U2 copy fixes, card-text mirror corpus (session 52)"
$PYTEST -q || { echo "FAIL: pytest"; exit 1; }
( cd web && npx tsc --noEmit && npx vitest run && npm run build ) || { echo "FAIL: web suites"; exit 1; }
bash scripts/scrub_gate.sh || { echo "FAIL: scrub gate"; exit 1; }
echo ""
echo "ALL GREEN. No migrations this wave: git push origin main && (cd web && npx vercel --prod)."
echo "Acceptance test after deploy: open the site in a FRESH browser -> should land on login, not invite."
