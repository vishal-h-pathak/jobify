#!/usr/bin/env bash
# setup-adm3.sh — Session 49: admin panel + onboarding auto-seed hook.
# One SONNET session on worktree feat/adm3, branched from POST-MERGE main
# (HUNT2 wave A must be merged first). Run:  bash ops/waves/setup-adm3.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
PROMPT="$JOBIFY/planning/session-prompts/49_adm3_admin.md"
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets first."; exit 1; }
# Sanity: wave A must already be merged (Part 0 depends on S48's portalsSeed).
git -C "$JOBIFY" merge-base --is-ancestor feat/hunt2-s2 main 2>/dev/null || { echo "ERROR: feat/hunt2-s2 not merged into main yet — run merge-hunt2-a.sh first."; exit 1; }

mkdir -p "$WT_ROOT"
git -C "$JOBIFY" worktree add "$WT_ROOT/adm3" -b feat/adm3 2>/dev/null || echo "note: worktree adm3 already exists — reusing"

DIRECTIVE="Read $JOBIFY/planning/session-prompts/49_adm3_admin.md and execute it exactly. You are in worktree feat/adm3, branched from post-merge main. TIMEBOXED session — functional over pretty; cut from the bottom of Part 2 if needed, never Part 0 or gating. The admin email must never appear in code — ADMIN_EMAILS env only (scrub gate). Commit on your branch; do not push or merge. Report per the prompt's format. Do not begin until I confirm."

osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT_ROOT/adm3' && echo '──────── ADM-3 · session 49 · admin panel + auto-seed hook · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged ADM-3. Review the directive, press Return."
echo "After its report: cockpit reviews, then bash ops/waves/merge-adm3.sh."
