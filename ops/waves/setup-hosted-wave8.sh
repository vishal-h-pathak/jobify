#!/usr/bin/env bash
# setup-hosted-wave8.sh — stage Hosted wave 8: ADM-2 (admin System screen +
# hunt_cycles telemetry), single SONNET session.
# PREREQ: wave 7 (HNT-1) merged to main — this script refuses to run before.
# Run from anywhere:  bash setup-hosted-wave8.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
BRANCH="feat/hosted-adm2-system"
PROMPT="$JOBIFY/planning/session-prompts/22_admin_system_screen.md"
WT="$WT_ROOT/hosted-adm2-system"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor \
  "$(git -C "$JOBIFY" rev-parse feat/hosted-hnt1-triggers)" \
  "$(git -C "$JOBIFY" rev-parse main)" \
  || { echo "ERROR: wave 7 (HNT-1) not merged to main yet — merge first."; exit 1; }
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
  do script "cd '$WT' && echo '──────── Wave 8 · ADM-2 system screen · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged ADM-2 (Sonnet). Review directive, press Return."
echo "Reviewer close-out: apply 0008 to live project + vercel --prod after merge."
