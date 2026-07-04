#!/usr/bin/env bash
#
# setup-hosted-wave3.sh — stage Hosted wave 3: H5 (feed UI) and H6 (cost
# rails: hard caps, global pool, BYO keys) as two parallel Claude Code
# sessions, each in its own worktree/branch.
#
# Prereq: waves 1–2 merged to main (H1–H4) + the 0005 invite-claim fix.
# Live Supabase project exists (vujlecpmurismvnjebcf) — H5 dev wants its URL
# + anon key in web/.env.local (get keys from the dashboard; never commit).
#
# For each session: creates the worktree off main if missing, opens a Terminal
# tab, cd's in, launches claude, and PASTES the directive WITHOUT pressing
# Return (review, then Return to start).
#
# Run from anywhere:  bash setup-hosted-wave3.sh
# Requirements: macOS + Terminal.app; Terminal Accessibility for the auto-paste.
#
# H6 is the LAUNCH BLOCKER — no friend invites until it merges.
# After wave 3: H7 (beta hardening + invites). H0 (publish gate, prompt 09)
# remains open and independent.

set -euo pipefail

JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"

command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
[ -d "$JOBIFY/.git" ] || { echo "ERROR: jobify repo not found at $JOBIFY"; exit 1; }

git -C "$JOBIFY" merge-base --is-ancestor \
  "$(git -C "$JOBIFY" rev-parse feat/hosted-h4-worker)" \
  "$(git -C "$JOBIFY" rev-parse main)" \
  || { echo "ERROR: wave 2 (H4) not merged to main yet — merge first."; exit 1; }
[ -f "$JOBIFY/jobify/migrations/0005_invite_claim_fn.sql" ] \
  || { echo "ERROR: 0005 invite-claim fix missing from the checkout — pull main first."; exit 1; }

SESSIONS=(
  "H5 feed UI|feat/hosted-h5-feed|$JOBIFY/planning/session-prompts/14_h5_feed_ui.md"
  "H6 cost rails|feat/hosted-h6-cost-rails|$JOBIFY/planning/session-prompts/15_h6_cost_rails.md"
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

  local directive="Read $prompt and implement it exactly on $branch in this worktree. Respect its parallel-safety file boundaries — another session owns the rest of the repo this wave (both sessions touch web/, so the boundaries matter more than usual). Commit as you go; push the branch when done; do NOT merge to main (review-then-merge). Do not begin until I confirm."

  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$wt' && echo '──────── Hosted wave 3 · $name · $branch ────────' && claude --permission-mode bypassPermissions" in front window
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

Staged Hosted wave 3 — two sessions, directives PASTED not submitted:
  1. H5 feed UI      feat/hosted-h5-feed         planning/session-prompts/14_h5_feed_ui.md
  2. H6 cost rails   feat/hosted-h6-cost-rails   planning/session-prompts/15_h6_cost_rails.md

Review each directive, press Return to start.

At merge review (Cowork): apply 0006 to the live project, re-run the live
RLS battery (incl. H5's feed state transitions + H6's api_keys DELETE
policy), verify the cross-runtime crypto fixture. Merge order: either works
(disjoint web/ subtrees); H6 before invites, always.

After wave 3: H7 (beta hardening — invite minting, telemetry, admin cost
view) and the H0 publish gate (prompt 09).
DONE
