#!/usr/bin/env bash
# merge-hunt2-c.sh — merge HUNT2 wave C (feat/hunt2-s5 then feat/hunt2-s6)
# into local main with full verification after EACH merge. Does NOT push.
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
cd "$JOBIFY"
[ -z "$(git status --porcelain)" ] || { echo "ERROR: main tree not clean."; exit 1; }
for b in feat/hunt2-s5 feat/hunt2-s6; do
  git rev-parse --verify "$b" >/dev/null 2>&1 || { echo "ERROR: branch $b not found."; exit 1; }
done
if [ -x "$JOBIFY/.venv/bin/pytest" ]; then PYTEST="$JOBIFY/.venv/bin/pytest"; else PYTEST="python3 -m pytest"; fi

verify() {
  echo "── verify after $1 ──"
  $PYTEST -q || { echo "FAIL: pytest after $1"; exit 1; }
  ( cd web && npx tsc --noEmit && npx vitest run && npm run build ) || { echo "FAIL: web suites after $1"; exit 1; }
  bash scripts/scrub_gate.sh || { echo "FAIL: scrub gate after $1"; exit 1; }
  echo "── $1 GREEN ──"
}

git merge --no-ff feat/hunt2-s5 -m "merge feat/hunt2-s5: HUNT2 S5 per-user query generation (session 53)"
verify "hunt2-s5"
git merge --no-ff feat/hunt2-s6 -m "merge feat/hunt2-s6: HUNT2 S6 board health + telemetry + fixups (session 54)"
verify "hunt2-s6"

[ -f jobify/migrations/0018_board_health.sql ] || echo "WARN: 0018_board_health.sql missing — check session 54 report."
ls jobify/migrations/ | sort | tail -4
echo ""
echo "ALL GREEN. Next: cockpit applies 0018 live, then git push origin main && (cd web && npx vercel --prod)."
echo "Do NOT push before 0018 is applied — discovery/health expect it."
