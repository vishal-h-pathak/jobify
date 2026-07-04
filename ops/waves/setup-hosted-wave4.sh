#!/usr/bin/env bash
#
# setup-hosted-wave4.sh — stage Hosted wave 4: the single H7 launch session
# (wrap-ups + beta hardening + deploy). Two-part prompt with a hard stop:
# Part A is code (review-then-merge as usual); Part B is operations (Vercel
# deploy, GHA secrets, E2E smoke) and only starts after the Part-A merge —
# it has several human gates, so keep this Terminal tab around.
#
# Prereq: waves 1–3 merged to main (H1–H6) and pushed; live Supabase project
# vujlecpmurismvnjebcf has migrations 0001–0006 applied.
#
# Run from anywhere:  bash setup-hosted-wave4.sh

set -euo pipefail

JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
BRANCH="feat/hosted-h7-launch"
PROMPT="$JOBIFY/planning/session-prompts/16_h7_launch.md"
WT="$WT_ROOT/hosted-h7-launch"

command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
[ -d "$JOBIFY/.git" ] || { echo "ERROR: jobify repo not found at $JOBIFY"; exit 1; }
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }

git -C "$JOBIFY" merge-base --is-ancestor \
  "$(git -C "$JOBIFY" rev-parse feat/hosted-h6-cost-rails)" \
  "$(git -C "$JOBIFY" rev-parse main)" \
  || { echo "ERROR: wave 3 (H6) not merged to main yet — merge first."; exit 1; }

mkdir -p "$WT_ROOT"
if [ ! -d "$WT" ]; then
  echo "Creating worktree $WT on $BRANCH (off main)…"
  if git -C "$JOBIFY" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$JOBIFY" worktree add "$WT" "$BRANCH"
  else
    git -C "$JOBIFY" worktree add -b "$BRANCH" "$WT" main
  fi
fi

DIRECTIVE="Read $PROMPT and implement it exactly on $BRANCH in this worktree. It is a TWO-PART prompt: complete Part A (code), commit, push, then STOP for review-then-merge — do not start Part B (operations) until I explicitly confirm the merge. Part B has human gates: ask and wait at each one. Never echo a full secret. Do not begin until I confirm."

osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT' && echo '──────── Hosted wave 4 · H7 launch · $BRANCH ────────' && claude --permission-mode bypassPermissions" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA

cat <<DONE

Staged Hosted wave 4 — H7 launch session, directive PASTED not submitted.
Review it, press Return to start.

Flow: Part A code → push → Cowork review → merge → tell the session to run
Part B (deploy + secrets + E2E smoke, human gates throughout).

After H7: friends get invites. Still open and independent: H0, the Phase F
single-user publish gate (planning/session-prompts/09_merge_and_publish.md).
DONE
