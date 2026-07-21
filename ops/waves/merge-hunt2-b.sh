#!/usr/bin/env bash
# merge-hunt2-b.sh — merge HUNT2 wave B (feat/hunt2-s3 then feat/hunt2-s4)
# into local main with full verification after EACH merge. Does NOT push.
# Run only after the cockpit has reviewed both session reports.
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
cd "$JOBIFY"

[ -z "$(git status --porcelain)" ] || { echo "ERROR: main tree not clean."; exit 1; }
git rev-parse --verify feat/hunt2-s3 >/dev/null 2>&1 || { echo "ERROR: branch feat/hunt2-s3 not found."; exit 1; }
git rev-parse --verify feat/hunt2-s4 >/dev/null 2>&1 || { echo "ERROR: branch feat/hunt2-s4 not found."; exit 1; }

if [ -x "$JOBIFY/.venv/bin/pytest" ]; then PYTEST="$JOBIFY/.venv/bin/pytest";
else PYTEST="python3 -m pytest"; fi

verify() {
  local stage="$1"
  echo "── verify after $stage ──"
  $PYTEST -q || { echo "FAIL: pytest after $stage"; exit 1; }
  ( cd web && npx tsc --noEmit && npx vitest run && npm run build ) || { echo "FAIL: web suites after $stage"; exit 1; }
  bash scripts/scrub_gate.sh || { echo "FAIL: scrub gate after $stage"; exit 1; }
  echo "── $stage GREEN ──"
}

echo "── merging feat/hunt2-s3 (session 50) ──"
git merge --no-ff feat/hunt2-s3 -m "merge feat/hunt2-s3: HUNT2 S3 fetcher fleet + metadata retention (session 50)"
verify "hunt2-s3"

echo "── merging feat/hunt2-s4 (session 51) ──"
git merge --no-ff feat/hunt2-s4 -m "merge feat/hunt2-s4: HUNT2 S4 discovery loop (session 51)"
verify "hunt2-s4"

[ -f jobify/migrations/0016_posting_metadata.sql ] || echo "WARN: 0016_posting_metadata.sql missing — check session 50 report."
[ -f jobify/migrations/0017_candidate_boards.sql ] || echo "WARN: 0017_candidate_boards.sql missing — check session 51 report."
ls jobify/migrations/ | sort | tail -5

echo ""
echo "ALL GREEN. Next (cockpit-ordered):"
echo "  1. Cockpit applies 0016 then 0017 live (Supabase MCP, verbatim)."
echo "  2. Cockpit re-runs the board_catalog import (expanded seed)."
echo "  3. Owner: git push origin main && (cd web && npx vercel --prod)."
echo "  4. Owner triggers a hunt; measure against HUNT2_SOURCES.md §8."
echo "Do NOT push before migrations are applied — new fanout/worker expect 0016/0017."
