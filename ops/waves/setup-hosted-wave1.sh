#!/usr/bin/env bash
#
# setup-hosted-wave1.sh — stage Hosted wave 1: H1 (multitenant schema + RLS) and
# H2 (DB profile backend + compiled-rubric scorer) as two parallel Claude Code
# sessions, each in its own worktree/branch.
#
# For each session: creates the worktree off main if missing, opens a Terminal
# tab, cd's in, launches claude, and PASTES the directive WITHOUT pressing
# Return (review, then Return to start).
#
# Run from anywhere:  bash setup-hosted-wave1.sh
# Requirements: macOS + Terminal.app; Terminal Accessibility for the auto-paste.
# bypassPermissions = review before Return. If a paste misfires, the prompt
# paths + directives print at the end.
#
# H0 reminder: the Phase F publish/scrub gate (planning/session-prompts/
# 09_merge_and_publish.md) is still open and independent of this wave.

set -euo pipefail

JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"

command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
[ -d "$JOBIFY/.git" ] || { echo "ERROR: jobify repo not found at $JOBIFY"; exit 1; }

# session name | branch | prompt file
SESSIONS=(
  "H1 schema+RLS|feat/hosted-h1-schema|$JOBIFY/planning/session-prompts/10_h1_multitenant_schema.md"
  "H2 profile+rubric|feat/hosted-h2-profile-backend|$JOBIFY/planning/session-prompts/11_h2_profile_db_rubric.md"
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
  do script "cd '$wt' && echo '──────── Hosted wave 1 · $name · $branch ────────' && claude --permission-mode bypassPermissions" in front window
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

Staged Hosted wave 1 — two sessions, directives PASTED not submitted:
  1. H1 schema+RLS          feat/hosted-h1-schema            planning/session-prompts/10_h1_multitenant_schema.md
  2. H2 profile+rubric      feat/hosted-h2-profile-backend   planning/session-prompts/11_h2_profile_db_rubric.md

Review each directive, press Return to start. (bypassPermissions — review first.)

When they report: review the branches, verify H2's profiles-contract code matches
H1's actual table, then merge H1 → main first, H2 second (H2's integration reads
H1's table). Worktrees live under $WT_ROOT — prune via git, never rm.

Wave 2 after merge: H3 (onboarding web) + H4 (worker/ladder) + H5 (feed UI).
Don't forget H0 — the Phase F publish gate (prompt 09) is still the open release item.
DONE
