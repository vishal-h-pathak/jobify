#!/usr/bin/env bash
# setup-v3b-wave2.sh — stage Hosted V3b wave 2: S3 (tailor surface) -
# side-by-side viewer + honesty drawer, single SONNET session. Gated on S1+S2.
# PREREQ: wave 8 (ADM-2) merged to main — this script refuses to run before.
# Run from anywhere:  bash setup-v3b-wave2.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
BRANCH="feat/v3b-s3-ui"
PROMPT="$JOBIFY/planning/session-prompts/38_v3b_s3_ui.md"
WT="$WT_ROOT/v3b-s3-ui"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor \
  "$(git -C "$JOBIFY" rev-parse feat/v3b-s1-worker)" \
  "$(git -C "$JOBIFY" rev-parse main)" \
  || { echo "ERROR: S1 not merged to main yet — merge V3b wave 1 first."; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor \
  "$(git -C "$JOBIFY" rev-parse feat/v3b-s2-plumbing)" \
  "$(git -C "$JOBIFY" rev-parse main)" \
  || { echo "ERROR: S2 not merged to main yet — merge V3b wave 1 first."; exit 1; }
mkdir -p "$WT_ROOT"
if [ ! -d "$WT" ]; then
  if git -C "$JOBIFY" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$JOBIFY" worktree add "$WT" "$BRANCH"
  else
    git -C "$JOBIFY" worktree add -b "$BRANCH" "$WT" main
  fi
fi
DIRECTIVE="Read $PROMPT and implement it exactly on $BRANCH in this worktree. Decisions are made — implement faithfully; the explainer must match the docs it cites and contain zero operator-identifying strings (CI scrub gate). Commit as you go; push when done; do NOT merge (review-then-merge). Do not begin until I confirm."
osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT' && echo '──────── V3b wave 2 · S3 tailor UI · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged V3B-S3 (Sonnet). Review directive, press Return."
echo "Reviewer close-out: close-out: 0012 live if pending, bucket check, vercel --prod, live E2E tailor."
