#!/usr/bin/env bash
# merge-v3c-p0.sh — V3c P0 reviewer merge: feat/v3c-packet + feat/v3c-kit
# into main, apply the one reviewer fixup (reconcile the kit's local pinned-
# contract types to the canonical web/lib/submit/types.ts copy — shapes were
# verified field-identical in review), then run the full union verification.
# Stops BEFORE push and BEFORE any live migration apply — the reviewer applies
# 0013 via Supabase MCP verbatim from the merged file, then the owner pushes
# + 'cd web && vercel --prod'.
# Run from anywhere:  bash merge-v3c-p0.sh
set -euo pipefail
JOBIFY="$HOME/dev/jarvis/jobify"
cd "$JOBIFY"

echo "── preflight ──"
git rev-parse --verify feat/v3c-packet >/dev/null
git rev-parse --verify feat/v3c-kit >/dev/null
git checkout main
[ -z "$(git status --porcelain)" ] || { echo "ERROR: main working tree not clean — stash/commit first (mind untracked prompt copies)."; exit 1; }

echo "── merge packet, then kit (disjoint ownership; conflicts = stop and inspect) ──"
git merge --no-ff feat/v3c-packet -m "Merge V3C-PACKET: application_profiles + 0013 + submit packet endpoint"
git merge --no-ff feat/v3c-kit -m "Merge V3C-KIT: submitter onboarding wizard + submit kit page"

echo "── reviewer fixup: kit types -> re-export of the canonical copy ──"
cat > web/components/submit/types.ts <<'EOF'
// web/components/submit/types.ts
//
// Reconciled at the V3c P0 merge (reviewer fixup): the canonical pinned-
// contract types live in web/lib/submit/types.ts (session 40). The kit
// session (39) coded against its own field-identical local copy per the
// pinned contract; this re-export replaces it so there is exactly ONE
// definition of ApplicationProfile / SubmitPacket in the codebase.
export type { ApplicationProfile, SubmitPacket } from "@/lib/submit/types";
EOF
git add web/components/submit/types.ts
git commit -m "V3C-P0 reviewer fixup: reconcile kit pinned-contract types to canonical web/lib/submit/types.ts"

echo "── union verification on the merged tree ──"
( cd web && npx vitest run && npx tsc --noEmit && npm run build )
if [ -x .venv/bin/pytest ] || [ -f .venv/bin/activate ]; then
  ( source .venv/bin/activate && pytest -q )
else
  pytest -q
fi
bash scripts/scrub_gate.sh

echo "── migration integrity (compare against the reviewer's staged-copy sha) ──"
echo "review-time sha256: dd6439d270de4c979be56910b4c8d0aae19b4d6f9046d878cbcfed0cebdab222"
git show main:jobify/migrations/0013_v3c_submit.sql | shasum -a 256

echo ""
echo "ALL GREEN — next steps, in order:"
echo "  1. Tell the Cowork reviewer 'merge green' — it applies 0013 live via Supabase MCP,"
echo "     VERBATIM from git show main:jobify/migrations/0013_v3c_submit.sql (sha must match above)."
echo "  2. git push origin main"
echo "  3. cd web && vercel --prod   (NO auto-deploy — every merge needs this)"
echo "  4. Walk /submit/setup + one kit page live on the owner account."
echo "NOT pushed, NOT applied — this script changes only the local main."
