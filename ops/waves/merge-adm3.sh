#!/usr/bin/env bash
# merge-adm3.sh — merge feat/adm3 (session 49) into local main with full
# verification. Does NOT push. Run after cockpit review of the report.
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
cd "$JOBIFY"
[ -z "$(git status --porcelain)" ] || { echo "ERROR: main tree not clean."; exit 1; }
git rev-parse --verify feat/adm3 >/dev/null 2>&1 || { echo "ERROR: branch feat/adm3 not found."; exit 1; }

git merge --no-ff feat/adm3 -m "merge feat/adm3: ADM-3 admin panel + onboarding auto-seed hook (session 49)"
pytest -q || { echo "FAIL: pytest"; exit 1; }
( cd web && npx tsc --noEmit && npx vitest run && npm run build ) || { echo "FAIL: web suites"; exit 1; }
bash scripts/scrub_gate.sh || { echo "FAIL: scrub gate"; exit 1; }

echo ""
echo "ALL GREEN. Before deploying: set ADMIN_EMAILS in Vercel (Production) to the"
echo "owner admin email, then: git push origin main && (cd web && vercel --prod)."
