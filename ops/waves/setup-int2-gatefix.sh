#!/usr/bin/env bash
# setup-int2-gatefix.sh — Session 58: INT2 Findings D/E fixes + final gate.
# One SONNET session on the MAIN checkout (prior gate session was closed;
# its work is committed as 928098c). Run:  bash ops/waves/setup-int2-gatefix.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
PROMPT="$JOBIFY/planning/session-prompts/58_int2_gatefix.md"
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean."; exit 1; }
git -C "$JOBIFY" log --oneline -1 | grep -q . || { echo "ERROR: git broken?"; exit 1; }
grep -q "CLAUDE_CODE_OAUTH_TOKEN" "$JOBIFY/web/.env.local" 2>/dev/null || echo "WARNING: web/.env.local has no CLAUDE_CODE_OAUTH_TOKEN — the gate needs it."

DIRECTIVE="Read $JOBIFY/planning/session-prompts/58_int2_gatefix.md and execute it exactly. You are on the MAIN checkout (local main is ahead of origin, deliberate — do NOT push). Implement Fix D (auth-metadata name seeding, 3-round bounded deferral, harness name bucket) and Fix E (ownership-aware array merges + matching invariant refinement), full suites, then the final 6-run gate. If a new structural finding appears, report and stop. Do not begin until I confirm."

osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$JOBIFY' && echo '──────── INT2-D · session 58 · D/E fixes + final gate · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged INT2-GATEFIX. Review the directive, press Return."
echo "After its report: owner reviews here, then git push origin main + (cd web && npx vercel --prod)."
