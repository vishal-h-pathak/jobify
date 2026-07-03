#!/usr/bin/env bash
#
# setup-hosted-wave2.sh — stage Hosted wave 2: H3 (web scaffold + onboarding
# chat) and H4 (shared discovery worker + scoring ladder) as two parallel
# Claude Code sessions, each in its own worktree/branch.
#
# Prereq: wave 1 merged to main (H1 schema + H2 profile backend) — worktrees
# are created off main and both prompts assume those exist.
#
# For each session: creates the worktree off main if missing, opens a Terminal
# tab, cd's in, launches claude, and PASTES the directive WITHOUT pressing
# Return (review, then Return to start).
#
# Run from anywhere:  bash setup-hosted-wave2.sh
# Requirements: macOS + Terminal.app; Terminal Accessibility for the auto-paste.
#
# Wave 3 after these merge: H5 (feed UI, in H3's web/ app) + H6 (cost rails).
# H0 (Phase F publish gate, prompt 09) remains open and independent.

set -euo pipefail

JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"

command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
[ -d "$JOBIFY/.git" ] || { echo "ERROR: jobify repo not found at $JOBIFY"; exit 1; }

git -C "$JOBIFY" merge-base --is-ancestor \
  "$(git -C "$JOBIFY" rev-parse feat/hosted-h2-profile-backend)" \
  "$(git -C "$JOBIFY" rev-parse main)" \
  || { echo "ERROR: wave 1 (H2) not merged to main yet — merge first."; exit 1; }

SESSIONS=(
  "H3 web+onboarding|feat/hosted-h3-onboarding-web|$JOBIFY/planning/session-prompts/12_h3_onboarding_web.md"
  "H4 worker+ladder|feat/hosted-h4-worker|$JOBIFY/planning/session-prompts/13_h4_worker_ladder.md"
)

for entry in "${SESSIONS[@]}"; do
  IFS='|' read -r _name _branch prompt <<<"$entry"
  [ -f "$prompt" ] || { echo "ERROR: prompt not found: $prompt"; exit 1; }
done

mkdir -p "$WT_ROOT"

stage_session() {
  local name="$1" branch="$2" prompt="$3"
  local wt="$WT_ROOT/${branch##*/}"

  if [ ! -d "$wt" ]; then
    echo "Creating worktree $wt on $branch (off main)…"
    if git -C "$JOBIFY" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$JOBIFY" worktree add "$wt" "$branch"
    else
      git -C "$JOBIFY" worktree add -b "$branch" "$wt" main
    fi
  fi

  local directive="Read $prompt and implement it exactly on $branch in this worktree. Respect its parallel-safety file boundaries — another session owns the rest of the repo this wave. Commit as you go; push the branch when done; do NOT merge to main (review-then-merge). Do not begin until I confirm."

  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$wt' && echo '──────── Hosted wave 2 · $name · $branch ────────' && claude --permission-mode bypassPermissions" in front window
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
  stage_session "$name" "$branch" "$prompt"
done

cat <<DONE

Staged Hosted wave 2 — two sessions, directives PASTED not submitted:
  1. H3 web+onboarding   feat/hosted-h3-onboarding-web   planning/session-prompts/12_h3_onboarding_web.md
  2. H4 worker+ladder    feat/hosted-h4-worker           planning/session-prompts/13_h4_worker_ladder.md

Review each directive, press Return to start.

Merge order when both report: either order is safe (disjoint files: web/ vs
jobify/), but review H4's profile_loader parameterization fix carefully — it
touches the wave-1 H2 code.

Wave 3 after merge: H5 (feed UI) + H6 (cost rails; launch blocker before invites).
Supabase infra flag: no live project yet — new Pro org (~\$25/mo) when H5/H6 needs it.
DONE
