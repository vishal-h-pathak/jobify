#!/usr/bin/env bash
# setup-hosted-wave5a.sh — stage Hosted wave 5a: UX-1 (design system + app
# shell), a single SONNET session. Must merge before wave 5b (18/19) starts.
# Run from anywhere:  bash setup-hosted-wave5a.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
BRANCH="feat/hosted-ux1-shell"
PROMPT="$JOBIFY/planning/session-prompts/17_ux_design_shell.md"
WT="$WT_ROOT/hosted-ux1-shell"
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
DIRECTIVE="Read $PROMPT and implement it exactly on $BRANCH in this worktree. The design decisions are all made in the prompt — implement faithfully, don't redesign. Commit as you go; push the branch when done; do NOT merge (review-then-merge). Do not begin until I confirm."
osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT' && echo '──────── Wave 5a · UX-1 shell · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged UX-1 (Sonnet). Review directive, press Return. After merge: bash setup-hosted-wave5b.sh"
