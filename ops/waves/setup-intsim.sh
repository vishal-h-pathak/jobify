#!/usr/bin/env bash
# setup-intsim.sh — INTSIM: session 45, the interview simulation harness
# (scripted personas vs the REAL model; loop + recovery invariants; fallback
# telemetry). One SONNET session off MAIN.
# Run from anywhere:  bash setup-intsim.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
PROMPT="$JOBIFY/planning/session-prompts/45_intsim_harness.md"
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
BRANCH="feat/intsim"; WT="$WT_ROOT/intsim"
mkdir -p "$WT_ROOT"
if [ ! -d "$WT" ]; then
  if git -C "$JOBIFY" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$JOBIFY" worktree add "$WT" "$BRANCH"
  else
    git -C "$JOBIFY" worktree add -b "$BRANCH" "$WT" main
  fi
fi
DIRECTIVE="Read $PROMPT and implement it exactly on $BRANCH in this worktree. Branch off main; push your branch; never merge (review-then-merge). The sim must never touch a real database. Commit as you go; push when done. Do not begin until I confirm."
osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT' && echo '──────── INTSIM · sim harness · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged INTSIM (Sonnet, off main). Review the directive, press Return."
echo "COMMIT the prompt + this launcher to main first (clean-tree rule)."
