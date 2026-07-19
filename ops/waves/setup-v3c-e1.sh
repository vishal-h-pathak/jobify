#!/usr/bin/env bash
# setup-v3c-e1.sh — V3c E1: session 41 (V3C-E1A: fill engine core — survey,
# widget drivers, read-back, L0+Workday maps) and session 42 (V3C-E1B: MV3
# shell — manifest, token handoff, ready list, panel fill flow), two parallel
# SONNET sessions off MAIN.
# Spec: planning/V3C_DESIGN.md v2.1 §9 (E1). Engine API pinned verbatim in
# both prompts — 41 implements it, 42 consumes it. Directory split is part of
# the contract: 41 owns extension/engine/** only; 42 owns everything else in
# extension/ plus the additive web handoff/ready changes.
# Run from anywhere:  bash setup-v3c-e1.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

SESSIONS=(
  "V3C-E1A engine|feat/v3c-e1-engine|$JOBIFY/planning/session-prompts/41_v3c_e1_engine.md"
  "V3C-E1B shell|feat/v3c-e1-shell|$JOBIFY/planning/session-prompts/42_v3c_e1_shell.md"
)
for entry in "${SESSIONS[@]}"; do
  IFS='|' read -r _n _b prompt <<<"$entry"
  [ -f "$prompt" ] || { echo "ERROR: prompt not found: $prompt"; exit 1; }
done
mkdir -p "$WT_ROOT"
stage() {
  local name="$1" branch="$2" prompt="$3" wt="$WT_ROOT/${2##*/}"
  if [ ! -d "$wt" ]; then
    if git -C "$JOBIFY" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$JOBIFY" worktree add "$wt" "$branch"
    else
      git -C "$JOBIFY" worktree add -b "$branch" "$wt" main
    fi
  fi
  local directive="Read $prompt and implement it exactly on $branch in this worktree. Branch off main; push your branch; never merge (review-then-merge). The pinned engine API + directory split in the prompt are shared with the parallel session — implement/consume them exactly. Commit as you go; push when done. Do not begin until I confirm."
  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$wt' && echo '──────── V3c E1 · $name · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
  sleep 6
  osascript <<OSA
set the clipboard to "$directive"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
  sleep 2
}
for entry in "${SESSIONS[@]}"; do
  IFS='|' read -r name branch prompt <<<"$entry"
  stage "$name" "$branch" "$prompt"
done
echo "Staged V3C-E1A + V3C-E1B (Sonnet, parallel, off main). Review directives, press Return in each."
echo "COMMIT THE PROMPTS + THIS LAUNCHER TO MAIN FIRST (cockpit convention) or the"
echo "merge script's clean-tree preflight will block later, as it did in P0."
echo "Reviewer merges both to main; no migration this wave (0013 already live)."
echo "After merge: owner pushes + 'cd web && vercel --prod' (handoff emitter + ready route),"
echo "then loads extension/dist unpacked and fills one real Greenhouse page — E2 (navigator,"
echo "shadow mode) follows that first live fill."
