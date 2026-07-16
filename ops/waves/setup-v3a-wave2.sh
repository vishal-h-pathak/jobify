#!/usr/bin/env bash
# setup-v3a-wave2.sh — V3a wave 2: V3A-B1 (intake orchestration UI) and
# V3A-B3 (the dossier), two parallel SONNET
# sessions on the feat/v3a INTEGRATION BRANCH (not main — main stays
# deployable-v2 until after Saturday's friend test).
# Run from anywhere:  bash setup-v3a-wave2.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

# Create the integration branch off main if missing, and push it.
if ! git -C "$JOBIFY" show-ref --verify --quiet refs/heads/feat/v3a; then
  git -C "$JOBIFY" branch feat/v3a main
  git -C "$JOBIFY" push -u origin feat/v3a || echo "WARN: push of feat/v3a failed — push it manually."
fi

SESSIONS=(
  "V3A-B1 intake UI|feat/v3a-b1-intake|$JOBIFY/planning/session-prompts/32_v3a_b1_intake_ui.md"
  "V3A-B3 dossier|feat/v3a-b3-dossier|$JOBIFY/planning/session-prompts/33_v3a_b3_dossier.md"
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
      git -C "$JOBIFY" worktree add -b "$branch" "$wt" feat/v3a
    fi
  fi
  local directive="Read $prompt and implement it exactly on $branch in this worktree. NOTE the branch discipline: you are on the feat/v3a integration branch lineage, NOT main — push your branch, never merge, never touch main. The pinned contract in the prompt is shared with the parallel session — implement/consume it exactly. Commit as you go; push when done. Do not begin until I confirm."
  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$wt' && echo '──────── V3a wave 2 · $name · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
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
echo "Staged V3A-B1 + V3A-B3 (Sonnet, parallel, off feat/v3a). Review directives, press Return in each."
echo "Reviewer merges both into feat/v3a. Wave 3 (setup-v3a-wave3.sh): V3A-B2 LLM modules, gated on B1 merging into feat/v3a."
echo "REMINDER: migration 0011 does NOT get applied to the live DB until v3a lands on main after Saturday."
