#!/usr/bin/env bash
#
# Identity / infra scrub gate (Phase F).
#
# Fails the build if any personal or infra identifier from the original
# single-user persona reappears anywhere in the tree, or if a stray résumé
# document lands outside its one legitimate home. This is the gate that
# proves "a stranger can clone this and find no leftover PII."
#
# Two independent checks:
#   1. Identifier scan — grep -rEI (no extension filter, so EVERY text file is
#      scanned regardless of suffix) for the forbidden token list.
#   2. Binary-document scan — grep -I skips binary CONTENT, so binaries are
#      covered separately: any tracked *.pdf / *.docx outside the allowed home
#      fails. (A real résumé PDF once leaked through a merge precisely because
#      an extension-filtered grep skipped it.)
#
# Allowed homes / self-references (legitimately contain the tokens or docs):
#   - onboarding/examples/   neutral "Alex Quinn" golden test persona
#   - profile.example/       shipped neutral example profile
#   - planning/              internal build scaffolding; the session prompts
#                            must name the forbidden tokens to SPECIFY this gate
#                            (see planning/session-prompts/04_...:74, the
#                            canonical gate definition, which excludes planning/)
#   - scripts/scrub_gate.sh  this file (it has to contain the pattern)
#   - .github/workflows/ci.yml  the workflow that invokes this file
#
set -uo pipefail

cd "$(dirname "$0")/.."

PATTERN='vishal|pathak|gtri|thak\.io|papercuts|cape canaveral|sbmsxerwgylpfkkkjtku|vishal-h-pathak'

status=0

echo "== [1/2] identifier scan (text, all extensions) =="
# -r recurse, -E extended regex, -I skip binary content, -i case-insensitive,
# -l list files, -n would add lines but we re-grep hits for the report.
hits=$(grep -rEIl -i "$PATTERN" . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude-dir=onboarding/examples \
  --exclude-dir=profile.example \
  --exclude-dir=planning \
  2>/dev/null \
  | grep -vx './scripts/scrub_gate.sh' \
  | grep -vx './.github/workflows/ci.yml' \
  || true)

if [ -n "$hits" ]; then
  echo "FAIL: forbidden identifier(s) found in:"
  echo "$hits" | sed 's/^/  - /'
  echo
  echo "Offending lines:"
  while IFS= read -r f; do
    [ -n "$f" ] && grep -nEI -i "$PATTERN" "$f" | sed "s|^|  $f:|"
  done <<< "$hits"
  status=1
else
  echo "OK: no forbidden identifiers in tracked text."
fi

echo
echo "== [2/2] binary-document scan (tracked *.pdf / *.docx) =="
# Legit homes for sample documents: resume_templates/ and onboarding/examples/.
docs=$(git ls-files '*.pdf' '*.docx' 2>/dev/null \
  | grep -vE '(^|/)resume_templates/' \
  | grep -vE '(^|/)onboarding/examples/' \
  || true)

if [ -n "$docs" ]; then
  echo "FAIL: tracked binary document(s) outside an allowed home:"
  echo "$docs" | sed 's/^/  - /'
  echo "  (résumé/cover-letter binaries belong only in resume_templates/ or onboarding/examples/)"
  status=1
else
  echo "OK: no stray tracked binary documents."
fi

echo
if [ "$status" -eq 0 ]; then
  echo "scrub gate: PASS"
else
  echo "scrub gate: FAIL"
fi
exit "$status"
