#!/usr/bin/env bash
# setup-intsim-merge.sh — Session 46: reconcile feat/intsim with main (union
# merge of complementary fixes) + one real cooperative-persona sim as the
# validation gate. One SONNET session, operating on the MAIN checkout
# directly (a merge session needs main, not a worktree). Does not push.
# Run from anywhere:  bash setup-intsim-merge.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
command -v claude >/dev/null 2>&1 || { echo "ERROR: 'claude' CLI not on PATH."; exit 1; }
PROMPT="$JOBIFY/planning/session-prompts/46_intsim_merge.md"
[ -f "$PROMPT" ] || { echo "ERROR: prompt not found: $PROMPT"; exit 1; }
[ -z "$(git -C "$JOBIFY" status --porcelain)" ] || { echo "ERROR: main tree not clean — commit cockpit assets first."; exit 1; }
git -C "$JOBIFY" fetch origin feat/intsim:feat/intsim 2>/dev/null || git -C "$JOBIFY" fetch origin feat/intsim || true
DIRECTIVE="Read $PROMPT and execute it exactly. You are working directly on the main checkout: merge feat/intsim into local main as a UNION (no fix from either side lost), verify, run the one-persona sim gate, commit locally, do NOT push. Report per the prompt's format. Do not begin until I confirm."
osascript <<OSA
tell application "Terminal"
  activate
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$JOBIFY' && echo '──────── INTSIM-MERGE · union + sim gate · SONNET ────────' && claude --permission-mode bypassPermissions --model sonnet" in front window
end tell
OSA
sleep 6
osascript <<OSA
set the clipboard to "$DIRECTIVE"
tell application "Terminal" to activate
delay 0.3
tell application "System Events" to keystroke "v" using command down
OSA
echo "Staged INTSIM-MERGE. Review the directive, press Return."
echo "NOTE: web/.env.local must still hold CLAUDE_CODE_OAUTH_TOKEN for the sim gate"
echo "(copy it from the intsim worktree: cp ~/dev/jarvis/jobify-wt/intsim/web/.env.local web/.env.local)."
echo "After its report: owner reviews here, then git push origin main + vercel --prod."
