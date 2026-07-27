#!/usr/bin/env bash
# setup-feedq.sh — Session 59: verdict integrity + rubric determinism +
# comms catalog (U2 feed-quality fixes). One SONNET session, worktree
# feat/feedq-1. Run:  bash ops/waves/setup-feedq.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
PROMPT="$JOBIFY/planning/session-prompts/59_feedq_u2.md"
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets first."; exit 1; }

mkdir -p "$WT_ROOT"
git -C "$JOBIFY" worktree add "$WT_ROOT/feedq-1" -b feat/feedq-1 2>/dev/null || echo "note: worktree feedq-1 exists — reusing"

DIRECTIVE="Read $JOBIFY/planning/session-prompts/59_feedq_u2.md and execute it exactly. Worktree feat/feedq-1. Four fixes driven by live second-user evidence: direction-explicit verdict comp rendering, a verdict quality floor (negative verdicts never surface), deterministic rubric gates copied from profile.yml in code, and a live-verified marketing-comms catalog pack + tag vocabulary extension. Fixtures use Alex Quinn shapes, never real user data. Commit on your branch; no push, no merge. Report per the prompt, ending with the cockpit ops runbook. Do not begin until I confirm."

osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT_ROOT/feedq-1' && echo '──────── FEEDQ-1 · session 59 · verdict integrity + comms catalog · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged FEEDQ-1. Review the directive, press Return."
echo "After its report: cockpit reviews, then merge (git merge --no-ff feat/feedq-1 + suites), push, deploy, and the cockpit runs the U2 runbook."
