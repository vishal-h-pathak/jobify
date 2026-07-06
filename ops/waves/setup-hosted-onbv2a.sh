#!/usr/bin/env bash
# setup-hosted-onbv2a.sh — Onboarding-v2 wave 1: ONB-A (interview backend) and
# ONB-C (shell/design-system polish), two parallel SONNET sessions.
# Spec: planning/ONBOARDING_REDESIGN.md. Run from anywhere.
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
SESSIONS=(
  "ONB-A backend|feat/hosted-onbv2-backend|$JOBIFY/planning/session-prompts/26_onbv2_backend.md"
  "ONB-C shell polish|feat/hosted-onbv2-shell|$JOBIFY/planning/session-prompts/27_onbv2_shell_polish.md"
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
  local directive="Read $prompt and implement it exactly on $branch in this worktree. It points you at planning/ONBOARDING_REDESIGN.md as the spec — read that first. Respect the file boundaries: the other wave-1 session owns different territory. Commit as you go; push when done; do NOT merge (review-then-merge). Do not begin until I confirm."
  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$wt' && echo '──────── ONB-v2 wave 1 · $name · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
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
echo "Staged ONB-A + ONB-C (Sonnet, parallel). Review directives, press Return in each."
echo "After both merge: bash setup-hosted-onbv2b.sh (ONB-B surface + ONB-D admin/settings)."
