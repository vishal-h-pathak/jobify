#!/usr/bin/env bash
# setup-hosted-wave6.sh — stage Hosted wave 6: ADM-1 (admin panel), a single
# SONNET session. Env-driven admin (ADMIN_EMAILS), /admin panel with invite
# minting, users overview, pool health.
# Run from anywhere:  bash setup-hosted-wave6.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
BRANCH="feat/hosted-adm1-panel"
PROMPT="$JOBIFY/planning/session-prompts/20_admin_panel.md"
WT="$WT_ROOT/hosted-adm1-panel"
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
DIRECTIVE="Read $PROMPT and implement it exactly on $BRANCH in this worktree. The security model is decided in the prompt — implement it exactly, no alternative auth schemes, and never write any real email/domain into code or tests. Commit as you go; push when done; do NOT merge (review-then-merge). Do not begin until I confirm."
osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT' && echo '──────── Wave 6 · ADM-1 admin panel · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged ADM-1 (Sonnet). Review directive, press Return."
echo "After merge: set ADMIN_EMAILS on Vercel + redeploy, then sign in with the admin email."
