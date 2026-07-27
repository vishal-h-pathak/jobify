#!/usr/bin/env bash
# setup-authflow.sh — Session 60: the universal auth-routing rule.
# One SONNET session, worktree feat/authflow. Run:  bash ops/waves/setup-authflow.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
PROMPT="$JOBIFY/planning/session-prompts/60_authflow.md"
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets first."; exit 1; }

mkdir -p "$WT_ROOT"
git -C "$JOBIFY" worktree add "$WT_ROOT/authflow" -b feat/authflow 2>/dev/null || echo "note: worktree authflow exists — reusing"

DIRECTIVE="Read $JOBIFY/planning/session-prompts/60_authflow.md and execute it exactly. Worktree feat/authflow, web-only. ONE routing rule enforced in ONE place: signed-out always goes to /login with a sanitized next param and lands on the original target after Google; the invite screen has exactly one door (authenticated, no access). Every row of the acceptance matrix becomes a test. Also declare @next/env explicitly. Commit on your branch; no push, no merge. Do not begin until I confirm."

osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT_ROOT/authflow' && echo '──────── AUTHFLOW · session 60 · one rule, every path · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged AUTHFLOW. Review the directive, press Return."
echo "After its report: cockpit reviews, then git merge --no-ff feat/authflow + suites, push, deploy."
echo "Acceptance after deploy: open /admin in a fresh Safari window -> login -> land on /admin."
