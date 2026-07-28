#!/usr/bin/env bash
# setup-auth2.sh — Session 61: Google one-click sign-in + visible identity.
# One SONNET session, worktree feat/auth2. Run:  bash ops/waves/setup-auth2.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
WT_ROOT="$HOME/dev/jarvis/jobify-wt"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
PROMPT="$JOBIFY/planning/session-prompts/61_auth2_google.md"
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets first."; exit 1; }
git -C "$JOBIFY" merge-base --is-ancestor feat/authflow main 2>/dev/null || { echo "ERROR: session 60 (feat/authflow) not merged — AUTH-2 builds on its routing rule."; exit 1; }

mkdir -p "$WT_ROOT"
git -C "$JOBIFY" worktree add "$WT_ROOT/auth2" -b feat/auth2 2>/dev/null || echo "note: worktree auth2 exists — reusing"

DIRECTIVE="Read $JOBIFY/planning/session-prompts/61_auth2_google.md and execute it exactly. Worktree feat/auth2, web-only. Google provider is already enabled in Supabase. Continue-with-Google primary, magic link demoted+polished, visible identity on every gated state, session-60 routing untouched. The identity-linking verification (existing email users must LINK, never duplicate) is the one item you must be loud about if ambiguous. Commit on your branch; no push, no merge. Do not begin until I confirm."

osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$WT_ROOT/auth2' && echo '──────── AUTH-2 · session 61 · Google sign-in + visible identity · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged AUTH-2. Review the directive, press Return."
echo "After its report: cockpit reviews, merge (git merge --no-ff feat/auth2 + suites), push, deploy."
echo "Owner acceptance: fresh Safari -> Continue with Google (vshlpthk1) -> SAME profile appears."
