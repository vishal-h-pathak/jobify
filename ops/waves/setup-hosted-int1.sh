#!/usr/bin/env bash
# setup-hosted-int1.sh — stage Hosted INT-1 (interview v2, resume-first) -
# parallel-safe with ADM-2 and SGN-1.
# PREREQ: wave 8 (ADM-2) merged to main — this script refuses to run before.
# Run from anywhere:  bash setup-hosted-int1.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
BRANCH="feat/hosted-int1-interview"
PROMPT="$JOBIFY/planning/session-prompts/24_interview_v2.md"
WT="$WT_ROOT/hosted-int1-interview"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
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
  do script "cd '$WT' && echo '──────── INT-1 · interview v2 · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged INT-1 (Sonnet). Review directive, press Return."
echo "Reviewer close-out: no migration; vercel --prod after merge."
