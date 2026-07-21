#!/usr/bin/env bash
# setup-int2-merge.sh — Session 57: union-merge INT2 branches + the real
# sim gate. One SONNET session on the MAIN checkout (session-46 pattern).
# Run AFTER cockpit review of both 55/56 reports:
#   bash ops/waves/setup-int2-merge.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
PROMPT="$JOBIFY/planning/session-prompts/57_int2_merge.md"
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean."; exit 1; }
for b in feat/int2-engine feat/int2-deck; do
  git -C "$JOBIFY" rev-parse --verify "$b" >/dev/null 2>&1 || { echo "ERROR: branch $b not found — run the INT2 sessions first."; exit 1; }
done
grep -q "CLAUDE_CODE_OAUTH_TOKEN" "$JOBIFY/web/.env.local" 2>/dev/null || echo "WARNING: web/.env.local has no CLAUDE_CODE_OAUTH_TOKEN — the sim gate needs a FRESH one (claude setup-token). Add it before confirming the session."

DIRECTIVE="Read $JOBIFY/planning/session-prompts/57_int2_merge.md and execute it exactly. You are on the MAIN checkout: union-merge feat/int2-engine then feat/int2-deck, verify, run the three-persona sim gate + recovery test, commit locally, do NOT push. Invariants must not be weakened to pass. Report per the prompt. Do not begin until I confirm."

osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$JOBIFY' && echo '──────── INT2-C · session 57 · union merge + sim gate · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged INT2-MERGE. Review the directive, press Return."
echo "After its report: owner reviews here, then git push origin main + (cd web && npx vercel --prod)."
