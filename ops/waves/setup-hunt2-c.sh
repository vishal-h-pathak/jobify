#!/usr/bin/env bash
# setup-hunt2-c.sh — HUNT2 wave C: sessions 53 (S5 query gen) and 54
# (S6 health/telemetry/fixups) in parallel worktrees. Requires waves A+B
# merged. Run:  bash ops/waves/setup-hunt2-c.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
P53="$JOBIFY/planning/session-prompts/53_hunt2_s5_querygen.md"
P54="$JOBIFY/planning/session-prompts/54_hunt2_s6_health.md"
for f in "$P53" "$P54"; do [ -f "$f" ] || { echo "ERROR: missing: $f"; exit 1; }; done
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets first."; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor feat/hunt2-s4 main 2>/dev/null || { echo "ERROR: wave B not merged — run merge-hunt2-b.sh first."; exit 1; }

mkdir -p "$WT_ROOT"
git -C "$JOBIFY" worktree add "$WT_ROOT/hunt2-s5" -b feat/hunt2-s5 2>/dev/null || echo "note: worktree hunt2-s5 exists — reusing"
git -C "$JOBIFY" worktree add "$WT_ROOT/hunt2-s6" -b feat/hunt2-s6 2>/dev/null || echo "note: worktree hunt2-s6 exists — reusing"

D53="Read $JOBIFY/planning/session-prompts/53_hunt2_s5_querygen.md and execute it exactly. Worktree feat/hunt2-s5. NO migrations; the one LLM call is metered (query_gen); discovery.py is off-limits — work behind query_templates' existing call surface. Session 54 runs in parallel — obey the collision list. Commit on your branch; no push, no merge. Do not begin until I confirm."
D54="Read $JOBIFY/planning/session-prompts/54_hunt2_s6_health.md and execute it exactly. Worktree feat/hunt2-s6. You own migration 0018 and discovery/worker/candidates + the listed web files; query_templates/query_gen/shared llm are session 53's — hands off. Zero LLM. Commit on your branch; no push, no merge. Do not begin until I confirm."

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

launch "$WT_ROOT/hunt2-s5" "HUNT2-S5 · session 53 · query generation" "$D53"
launch "$WT_ROOT/hunt2-s6" "HUNT2-S6 · session 54 · health + telemetry" "$D54"

echo "Staged wave C. Review each directive, press Return."
echo "After reports: cockpit reviews, then bash ops/waves/merge-hunt2-c.sh."
