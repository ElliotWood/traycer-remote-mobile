#!/bin/bash
set -euo pipefail
runuser -u traycer -- bash -c '
set -euo pipefail
cd /srv/traycer/tenants/a6-canary/test-repo
echo "--- refs before gc ---"
git for-each-ref refs/traycer/rescue/a6-canary/
REF="$(git for-each-ref --sort=-committerdate --format="%(refname)" refs/traycer/rescue/a6-canary/ | head -1)"
echo "checking newest ref: $REF"
SHA_BEFORE="$(git rev-parse "$REF")"
echo "sha before gc: $SHA_BEFORE"
echo "--- running git gc --prune=now --aggressive (as the owning user) ---"
git gc --prune=now --aggressive
echo "--- checking object survives ---"
SHA_AFTER="$(git rev-parse "$REF" 2>&1)"
echo "sha after gc: $SHA_AFTER"
if [ "$SHA_BEFORE" = "$SHA_AFTER" ]; then
  echo "SURVIVED: ref still resolves to the same object after git gc --prune=now"
else
  echo "FAILED: ref resolution changed or object lost"
  exit 1
fi
echo "--- verify the rescued commit actually contains the untracked file ---"
git ls-tree -r "$REF" --name-only | grep -q untracked.txt && echo "untracked.txt present in rescued commit: CONFIRMED"
git show "${REF}:tracked.txt" | grep -q "uncommitted change" && echo "uncommitted modification to tracked.txt present: CONFIRMED"
'
