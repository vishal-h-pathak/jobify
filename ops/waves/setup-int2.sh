#!/usr/bin/env bash
# setup-int2.sh — INTERVIEW-2 wave: sessions 55 (engine) + 56 (deck) in
# parallel worktrees. Requires UX-2 + HUNT2 wave C merged into main.
# Run:  bash ops/waves/setup-int2.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
P55="$JOBIFY/planning/session-prompts/55_int2_engine.md"
P56="$JOBIFY/planning/session-prompts/56_int2_deck.md"
for f in "$P55" "$P56" "$JOBIFY/planning/FEEDBACK_U2_2026-07-21.md"; do
  [ -f "$f" ] || { echo "ERROR: missing: $f"; exit 1; }
done
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets first."; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor feat/hunt2-s6 main 2>/dev/null || { echo "ERROR: wave C not merged into main yet."; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor feat/ux2 main 2>/dev/null || { echo "ERROR: feat/ux2 not merged into main yet."; exit 1; }

mkdir -p "$WT_ROOT"
git -C "$JOBIFY" worktree add "$WT_ROOT/int2-engine" -b feat/int2-engine 2>/dev/null || echo "note: worktree int2-engine exists — reusing"
git -C "$JOBIFY" worktree add "$WT_ROOT/int2-deck" -b feat/int2-deck 2>/dev/null || echo "note: worktree int2-deck exists — reusing"

D55="Read $JOBIFY/planning/session-prompts/55_int2_engine.md and execute it exactly. Worktree feat/int2-engine. The engine contract (points 1-8) is pinned — deviations need cockpit sign-off via the owner. Session 56 runs in parallel: module routes/moduleTurns/reactions are off-limits. Do NOT run live sim personas — that is session 57's gate. Commit on your branch; no push, no merge. Do not begin until I confirm."
D56="Read $JOBIFY/planning/session-prompts/56_int2_deck.md and execute it exactly. Worktree feat/int2-deck. One metered deck_gen LLM call, forced tool_choice, never-persist-empty (mirror-incident lesson). Session 55 runs in parallel: handleTurn/interview/turn-route/checklist files are off-limits. Commit on your branch; no push, no merge. Do not begin until I confirm."

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

launch "$WT_ROOT/int2-engine" "INT2-A · session 55 · server-driven engine" "$D55"
launch "$WT_ROOT/int2-deck" "INT2-B · session 56 · conditioned deck" "$D56"

echo "Staged INT2 wave. Review each directive, press Return."
echo "After both reports: cockpit reviews here, then bash ops/waves/setup-int2-merge.sh (session 57)."
