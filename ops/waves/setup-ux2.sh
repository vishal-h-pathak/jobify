#!/usr/bin/env bash
# setup-ux2.sh — Session 52: auth flow + hunt-button truth + U2 copy fixes.
# One SONNET session on worktree feat/ux2. Run:  bash ops/waves/setup-ux2.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
PROMPT="$JOBIFY/planning/session-prompts/52_ux2_flow.md"
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
[ -f "$JOBIFY/planning/FEEDBACK_U2_2026-07-21.md" ] || { echo "ERROR: feedback doc missing."; exit 1; }
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets first."; exit 1; }

mkdir -p "$WT_ROOT"
git -C "$JOBIFY" worktree add "$WT_ROOT/ux2" -b feat/ux2 2>/dev/null || echo "note: worktree ux2 already exists — reusing"

DIRECTIVE="Read $JOBIFY/planning/session-prompts/52_ux2_flow.md and execute it exactly. Worktree feat/ux2, web-only, no migrations. Read planning/FEEDBACK_U2_2026-07-21.md first; items 4-7 are OFF-LIMITS (INTERVIEW-2). Part 1 (auth routing) is the live bug — top priority. Commit on your branch; no push, no merge. Report per the prompt. Do not begin until I confirm."

osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT_ROOT/ux2' && echo '──────── UX-2 · session 52 · auth flow + copy · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged UX-2. Review the directive, press Return."
