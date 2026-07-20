#!/usr/bin/env bash
# setup-hunt2-a.sh — HUNT2 wave A: sessions 47 (P0 stop-the-bleeding) and
# 48 (moat part 1) in parallel worktrees. Two SONNET sessions, disjoint file
# surfaces (collision-avoidance section pinned in each prompt). Spec:
# planning/HUNT2_SOURCES.md. Run from anywhere:  bash ops/waves/setup-hunt2-a.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

P47="$JOBIFY/planning/session-prompts/47_hunt2_s1_p0.md"
P48="$JOBIFY/planning/session-prompts/48_hunt2_s2_moat.md"
SPEC="$JOBIFY/planning/HUNT2_SOURCES.md"
for f in "$P47" "$P48" "$SPEC"; do
  [ -f "$f" ] || { echo "ERROR: missing: $f"; exit 1; }
done
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets (spec + prompts + wave scripts) first."; exit 1; }

mkdir -p "$WT_ROOT"
git -C "$JOBIFY" worktree add "$WT_ROOT/hunt2-s1" -b feat/hunt2-s1 2>/dev/null || echo "note: worktree hunt2-s1 already exists — reusing"
git -C "$JOBIFY" worktree add "$WT_ROOT/hunt2-s2" -b feat/hunt2-s2 2>/dev/null || echo "note: worktree hunt2-s2 already exists — reusing"

D47="Read $JOBIFY/planning/session-prompts/47_hunt2_s1_p0.md and execute it exactly. You are in worktree feat/hunt2-s1. Spec: planning/HUNT2_SOURCES.md sections 1-2. Scope P0.1-P0.7 only; P0.1 must not land without P0.7. You own migration 0014 only. Commit on your branch; do not push or merge. Report per the prompt's format. Do not begin until I confirm."
D48="Read $JOBIFY/planning/session-prompts/48_hunt2_s2_moat.md and execute it exactly. You are in worktree feat/hunt2-s2. Spec: planning/HUNT2_SOURCES.md sections 3.1-3.3. You own migration 0015 only; obey the collision-avoidance file list. Commit on your branch; do not push or merge. Report per the prompt's format. Do not begin until I confirm."

launch() {
  local dir="$1" label="$2" directive="$3"
  osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$dir' && echo '──────── $label · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
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

launch "$WT_ROOT/hunt2-s1" "HUNT2-S1 · session 47 · P0 stop-the-bleeding" "$D47"
launch "$WT_ROOT/hunt2-s2" "HUNT2-S2 · session 48 · moat part 1" "$D48"

echo "Staged both HUNT2-A sessions. Review each directive in its tab, press Return to start."
echo "After both reports: owner reviews here, then bash ops/waves/merge-hunt2-a.sh."
