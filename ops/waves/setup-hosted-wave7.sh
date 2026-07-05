#!/usr/bin/env bash
# setup-hosted-wave7.sh — stage Hosted wave 7: HNT-1 (user-triggered hunts +
# admin routing), single SONNET session. Demo-critical.
# Run from anywhere:  bash setup-hosted-wave7.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
BRANCH="feat/hosted-hnt1-triggers"
PROMPT="$JOBIFY/planning/session-prompts/21_user_triggered_hunts.md"
WT="$WT_ROOT/hosted-hnt1-triggers"
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
DIRECTIVE="Read $PROMPT and implement it exactly on $BRANCH in this worktree. This ships to a live tester today — minimal faithful implementation, flag interpretations rather than inventing. Commit as you go; push when done; do NOT merge (review-then-merge). Do not begin until I confirm."
osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT' && echo '──────── Wave 7 · HNT-1 user-triggered hunts · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged HNT-1 (Sonnet). Review directive, press Return."
echo "While it runs: create the GitHub fine-grained PAT (see chat instructions)."
