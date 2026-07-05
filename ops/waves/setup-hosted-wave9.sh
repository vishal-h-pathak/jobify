#!/usr/bin/env bash
# setup-hosted-wave9.sh — stage Hosted wave 9: SGN-1 (friend allowlist -
# codeless signup), single SONNET session.
# PREREQ: wave 8 (ADM-2) merged to main — this script refuses to run before.
# Run from anywhere:  bash setup-hosted-wave9.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
BRANCH="feat/hosted-sgn1-allowlist"
PROMPT="$JOBIFY/planning/session-prompts/23_signup_allowlist.md"
WT="$WT_ROOT/hosted-sgn1-allowlist"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor \
  "$(git -C "$JOBIFY" rev-parse feat/hosted-adm2-system)" \
  "$(git -C "$JOBIFY" rev-parse main)" \
  || { echo "ERROR: wave 8 (ADM-2) not merged to main yet — merge first."; exit 1; }
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
  do script "cd '$WT' && echo '──────── Wave 9 · SGN-1 allowlist · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged SGN-1 (Sonnet). Review directive, press Return."
echo "Reviewer close-out: apply 0009 to live project + vercel --prod after merge."
