#!/usr/bin/env bash
# setup-v3a-wave3.sh — stage Hosted V3a wave 3: V3A-B2 (LLM modules) -
# voice+metrics+mirror, single SONNET session. Gated on B1.
# PREREQ: wave 8 (ADM-2) merged to main — this script refuses to run before.
# Run from anywhere:  bash setup-v3a-wave3.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
BRANCH="feat/v3a-b2-llm"
PROMPT="$JOBIFY/planning/session-prompts/34_v3a_b2_llm_modules.md"
WT="$WT_ROOT/v3a-b2-llm"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor \
  "$(git -C "$JOBIFY" rev-parse feat/v3a-b1-intake)" \
  "$(git -C "$JOBIFY" rev-parse feat/v3a)" \
  || { echo "ERROR: B1 not merged into feat/v3a yet — merge wave 2 first."; exit 1; }
mkdir -p "$WT_ROOT"
if [ ! -d "$WT" ]; then
  if git -C "$JOBIFY" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$JOBIFY" worktree add "$WT" "$BRANCH"
  else
    git -C "$JOBIFY" worktree add -b "$BRANCH" "$WT" feat/v3a
  fi
fi
DIRECTIVE="Read $PROMPT and implement it exactly on $BRANCH in this worktree. Decisions are made — implement faithfully; the explainer must match the docs it cites and contain zero operator-identifying strings (CI scrub gate). Commit as you go; push when done; do NOT merge (review-then-merge). Do not begin until I confirm."
osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT' && echo '──────── V3a wave 3 · B2 LLM modules · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged V3A-B2 (Sonnet). Review directive, press Return."
echo "Reviewer close-out: no live migration until v3a lands on main post-Saturday."
