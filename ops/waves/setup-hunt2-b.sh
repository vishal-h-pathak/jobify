#!/usr/bin/env bash
# setup-hunt2-b.sh — HUNT2 wave B: sessions 50 (S3 fetcher fleet + metadata)
# and 51 (S4 discovery loop) in parallel worktrees. Two SONNET sessions,
# disjoint surfaces (collision lists pinned in each prompt). Spec:
# planning/HUNT2_SOURCES.md §3.4-3.5 / §4. Requires wave A merged.
# Run:  bash ops/waves/setup-hunt2-b.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }

P50="$JOBIFY/planning/session-prompts/50_hunt2_s3_fetchers.md"
P51="$JOBIFY/planning/session-prompts/51_hunt2_s4_discovery.md"
for f in "$P50" "$P51" "$JOBIFY/planning/HUNT2_SOURCES.md"; do
  [ -f "$f" ] || { echo "ERROR: missing: $f"; exit 1; }
done
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets first."; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor feat/hunt2-s2 main 2>/dev/null || { echo "ERROR: wave A (feat/hunt2-s2) not merged into main — run merge-hunt2-a.sh first."; exit 1; }

mkdir -p "$WT_ROOT"
git -C "$JOBIFY" worktree add "$WT_ROOT/hunt2-s3" -b feat/hunt2-s3 2>/dev/null || echo "note: worktree hunt2-s3 already exists — reusing"
git -C "$JOBIFY" worktree add "$WT_ROOT/hunt2-s4" -b feat/hunt2-s4 2>/dev/null || echo "note: worktree hunt2-s4 already exists — reusing"

D50="Read $JOBIFY/planning/session-prompts/50_hunt2_s3_fetchers.md and execute it exactly. Worktree feat/hunt2-s3. You own migration 0016 and the fetchers/discovery/fanout surface; session 51 runs in parallel — obey the collision list. Every catalog board you add must be live-verified. Commit on your branch; no push, no merge. Report per the prompt. Do not begin until I confirm."
D51="Read $JOBIFY/planning/session-prompts/51_hunt2_s4_discovery.md and execute it exactly. Worktree feat/hunt2-s4. You own migration 0017 and the candidates/feeders/worker/admin-candidates surface; session 50 runs in parallel — obey the collision list (no edits to existing fetchers, discovery.py, or fanout.py). Zero LLM everywhere. Commit on your branch; no push, no merge. Report per the prompt. Do not begin until I confirm."

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

launch "$WT_ROOT/hunt2-s3" "HUNT2-S3 · session 50 · fetcher fleet + metadata" "$D50"
launch "$WT_ROOT/hunt2-s4" "HUNT2-S4 · session 51 · discovery loop" "$D51"

echo "Staged both HUNT2-B sessions. Review each directive in its tab, press Return."
echo "After both reports: cockpit reviews here, then bash ops/waves/merge-hunt2-b.sh."
