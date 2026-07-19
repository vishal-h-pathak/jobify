#!/usr/bin/env bash
# setup-ux1.sh — UX-1: session 43 (UX1-A: the intake gate — completion helper,
# route guard, nav states, empty states) and session 44 (UX1-B: portable
# dossier export + paper cuts), two parallel SONNET sessions off MAIN.
# Spec: planning/UX1_DESIGN.md. Pinned contract: intakeComplete() — 43 ships
# it, 44 gates on it.
# Run from anywhere:  bash setup-ux1.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

SESSIONS=(
  "UX1-A gate|feat/ux1-gate|$JOBIFY/planning/session-prompts/43_ux1_gate.md"
  "UX1-B dossier|feat/ux1-dossier-export|$JOBIFY/planning/session-prompts/44_ux1_dossier_export.md"
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
  local directive="Read $prompt and implement it exactly on $branch in this worktree. Branch off main; push your branch; never merge (review-then-merge). The pinned intakeComplete contract is shared with the parallel session — implement/consume it exactly. Commit as you go; push when done. Do not begin until I confirm."
  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$wt' && echo '──────── UX-1 · $name · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
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
echo "Staged UX1-A + UX1-B (Sonnet, parallel, off main). Review directives, press Return in each."
echo "COMMIT planning/UX1_DESIGN.md + prompts 43/44 + this launcher to main FIRST (clean-tree rule)."
echo "No migrations this wave. After review-merge: push + 'cd web && vercel --prod'."
