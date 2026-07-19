#!/usr/bin/env bash
# merge-v3c-e1.sh — V3c E1 reviewer merge: feat/v3c-e1-engine + feat/v3c-e1-shell
# into main, then the full union verification INCLUDING the real extension
# build — the first time engine/ and shell/ exist in one tree, which proves
# session 42's "jobify-engine" import seam resolves against session 41's
# real package. No migration this wave (0013 is already live). Stops before
# push; owner pushes + 'cd web && vercel --prod' (handoff emitter + ready
# route are web-side changes).
#
# Reviewer note baked in: extension/shell/src/types/jobify-engine.d.ts MUST
# be kept post-merge — the bare "jobify-engine" specifier only type-checks
# through that ambient declaration (tsc has no paths mapping for it); the
# bundler resolves it separately via build.mjs's alias. Do not "clean it up".
# Run from anywhere:  bash merge-v3c-e1.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
cd "$JOBIFY"

echo "── preflight ──"
git rev-parse --verify feat/v3c-e1-engine >/dev/null
git rev-parse --verify feat/v3c-e1-shell >/dev/null
git checkout main
[ -z "$(git status --porcelain)" ] || { echo "ERROR: main working tree not clean — commit cockpit assets first."; exit 1; }

echo "── merge engine, then shell (disjoint: engine/ vs everything else) ──"
git merge --no-ff feat/v3c-e1-engine -m "Merge V3C-E1A: fill engine core — survey, widget drivers, read-back, L0+Workday maps"
git merge --no-ff feat/v3c-e1-shell -m "Merge V3C-E1B: MV3 shell — manifest, token handoff, ready list, panel fill flow"

echo "── engine package: install + tests + tsc ──"
( cd extension/engine && npm ci && npx vitest run && npx tsc --noEmit )

echo "── shell package: install + tests + tsc ──"
( cd extension/shell && npm ci && npx vitest run && npx tsc --noEmit )

echo "── the seam proof: real extension build (engine + shell in one dist) ──"
set +u; set -a; [ -f .env.hosted ] && source .env.hosted; set +a; set -u
export JOBIFY_SUPABASE_URL="${JOBIFY_SUPABASE_URL:-${SUPABASE_URL:-}}"
export JOBIFY_SUPABASE_ANON_KEY="${JOBIFY_SUPABASE_ANON_KEY:-${SUPABASE_ANON_KEY:-}}"
export JOBIFY_APP_ORIGIN="${JOBIFY_APP_ORIGIN:-https://jobify-swart.vercel.app}"
if [ -n "$JOBIFY_SUPABASE_URL" ] && [ -n "$JOBIFY_SUPABASE_ANON_KEY" ]; then
  ( cd extension && npm ci && npm run build )
  echo "extension/dist built — THIS is the folder to load unpacked."
else
  echo "WARNING: Supabase URL/anon key not found in env or .env.hosted —"
  echo "skipped the dist build. Run it manually before loading unpacked:"
  echo "  cd extension && JOBIFY_SUPABASE_URL=... JOBIFY_SUPABASE_ANON_KEY=... JOBIFY_APP_ORIGIN=https://jobify-swart.vercel.app npm run build"
fi

echo "── web + python union verification ──"
( cd web && npx vitest run && npx tsc --noEmit && npm run build )
if [ -f .venv/bin/activate ]; then ( source .venv/bin/activate && pytest -q ); else pytest -q; fi
bash scripts/scrub_gate.sh

echo ""
echo "ALL GREEN — next steps, in order:"
echo "  1. git push origin main"
echo "  2. cd web && vercel --prod    (handoff emitter + /api/submit/ready must be live"
echo "     BEFORE the extension can sign in)"
echo "  3. chrome://extensions -> Developer mode -> Load unpacked -> extension/dist"
echo "  4. Open the live app once (handoff fires), then open a Greenhouse posting from"
echo "     your feed's ready list and click 'Fill this page' — the first live fill."
echo "NOT pushed — this script changes only the local main. No DB changes this wave."
