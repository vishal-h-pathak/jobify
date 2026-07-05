#!/usr/bin/env bash
# setup-hosted-wave5b.sh — stage Hosted wave 5b: UX-2 (landing/auth) and
# UX-3 (conversational onboarding) as two parallel SONNET sessions.
# Prereq: wave 5a (UX-1 design system) merged to main.
# Run from anywhere:  bash setup-hosted-wave5b.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"; WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor \
  "$(git -C "$JOBIFY" rev-parse feat/hosted-ux1-shell)" \
  "$(git -C "$JOBIFY" rev-parse main)" \
  || { echo "ERROR: wave 5a (UX-1) not merged to main yet — merge first."; exit 1; }
SESSIONS=(
  "UX-2 landing/auth|feat/hosted-ux2-landing|$JOBIFY/planning/session-prompts/18_ux_landing_auth.md"
  "UX-3 onboarding|feat/hosted-ux3-onboarding|$JOBIFY/planning/session-prompts/19_ux_onboarding_chat.md"
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
  local directive="Read $prompt and implement it exactly on $branch in this worktree. Design decisions are made — implement faithfully. Respect the file boundaries: the other wave-5b session owns other parts of web/. Use the merged web/components/ui primitives; do not fork or restyle them. Commit as you go; push when done; do NOT merge (review-then-merge). Do not begin until I confirm."
  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$wt' && echo '──────── Wave 5b · $name · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
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
echo "Staged UX-2 + UX-3 (Sonnet, parallel). Review directives, press Return in each."
