#!/usr/bin/env bash
# setup-v3b-wave1.sh — V3b wave 1: S1 (tailor worker) and
# S2 (web plumbing + PDF ingestion), two parallel SONNET
# sessions off MAIN (integration branch retired — everything ships to main
# now, per owner direction).
# Run from anywhere:  bash setup-v3b-wave1.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

SESSIONS=(
  "V3B-S1 worker|feat/v3b-s1-worker|$JOBIFY/planning/session-prompts/36_v3b_s1_worker.md"
  "V3B-S2 plumbing|feat/v3b-s2-plumbing|$JOBIFY/planning/session-prompts/37_v3b_s2_plumbing.md"
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
  local directive="Read $prompt and implement it exactly on $branch in this worktree. Branch off main; push your branch; never merge (review-then-merge). The pinned contract in the prompt is shared with the parallel session — implement/consume it exactly. Commit as you go; push when done. Do not begin until I confirm."
  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$wt' && echo '──────── V3b wave 1 · $name · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
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
echo "Staged V3B-S1 + V3B-S2 (Sonnet, parallel, off main). Review directives, press Return in each."
echo "Reviewer merges both into feat/v3a. Wave 2 (mirror/voice/metrics + dossier + intake UI) follows the Fable design pass."
echo "REMINDER: migration 0011 does NOT get applied to the live DB until v3a lands on main after Saturday."
