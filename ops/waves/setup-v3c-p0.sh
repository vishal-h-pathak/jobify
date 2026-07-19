#!/usr/bin/env bash
# setup-v3c-p0.sh — V3c P0: session 40 (V3C-PACKET: application profile +
# 0013 + submit packet backend) and session 39 (V3C-KIT: submitter onboarding
# + submit kit UI), two parallel SONNET sessions off MAIN.
# Spec: planning/V3C_DESIGN.md v2.1 §9 (P0). Shared API contract pinned
# verbatim in both prompts — 40 implements it, 39 consumes it.
# Run from anywhere:  bash setup-v3c-p0.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

SESSIONS=(
  "V3C-PACKET backend|feat/v3c-packet|$JOBIFY/planning/session-prompts/40_v3c_packet.md"
  "V3C-KIT ui|feat/v3c-kit|$JOBIFY/planning/session-prompts/39_v3c0_submit_kit.md"
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
  do script "cd '$wt' && echo '──────── V3c P0 · $name · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
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
echo "Staged V3C-PACKET + V3C-KIT (Sonnet, parallel, off main). Review directives, press Return in each."
echo "Reviewer merges both to main; THEN applies 0013 live VERBATIM from the merged file"
echo "(git show main:jobify/migrations/0013_v3c_submit.sql — never a reconstruction),"
echo "then the owner pushes + 'cd web && vercel --prod'. E1 (extension engine) follows review."
