#!/usr/bin/env bash
# merge-hunt2-a.sh — merge HUNT2 wave A (feat/hunt2-s1 then feat/hunt2-s2)
# into local main with full verification after EACH merge. Does NOT push.
# Run only after the cockpit has reviewed both session reports.
#   bash ops/waves/merge-hunt2-a.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
cd "$JOBIFY"

[ -z "$(git status --porcelain)" ] || { echo "ERROR: main tree not clean."; exit 1; }
git rev-parse --verify feat/hunt2-s1 >/dev/null 2>&1 || { echo "ERROR: branch feat/hunt2-s1 not found."; exit 1; }
git rev-parse --verify feat/hunt2-s2 >/dev/null 2>&1 || { echo "ERROR: branch feat/hunt2-s2 not found."; exit 1; }

verify() {
  local stage="$1"
  echo "── verify after $stage ──"
  pytest -q || { echo "FAIL: pytest after $stage"; exit 1; }
  ( cd web && npx tsc --noEmit && npx vitest run && npm run build ) || { echo "FAIL: web suites after $stage"; exit 1; }
  bash scripts/scrub_gate.sh || { echo "FAIL: scrub gate after $stage"; exit 1; }
  echo "── $stage GREEN ──"
}

echo "── merging feat/hunt2-s1 (session 47, P0) ──"
git merge --no-ff feat/hunt2-s1 -m "merge feat/hunt2-s1: HUNT2 P0 stop-the-bleeding (sessions 47)"
verify "hunt2-s1"

echo "── merging feat/hunt2-s2 (session 48, moat pt 1) ──"
git merge --no-ff feat/hunt2-s2 -m "merge feat/hunt2-s2: HUNT2 moat part 1 (session 48)"
verify "hunt2-s2"

# Both sessions wrote migrations — confirm numbering discipline held.
[ -f jobify/migrations/0014_hunt2_funnel.sql ] || echo "WARN: 0014_hunt2_funnel.sql missing — check session 47 report."
[ -f jobify/migrations/0015_board_catalog.sql ] || echo "WARN: 0015_board_catalog.sql missing — check session 48 report."
ls jobify/migrations/ | sort | tail -4

echo ""
echo "ALL GREEN. Local main carries HUNT2 wave A. Next (cockpit-ordered):"
echo "  1. Cockpit applies 0014 then 0015 to the LIVE DB verbatim (Supabase MCP, sha-verified)."
echo "  2. Cockpit runs the board_catalog import + owner reseed (importBoardCatalog.ts, reseedPortals.ts)."
echo "  3. Owner: git push origin main && (cd web && vercel --prod)  — only after 1-2."
echo "  4. Owner triggers a hunt; compare against HUNT2_SOURCES.md §8 targets."
echo "Do NOT push before the migrations are applied — the new fanout expects 0014 columns."
