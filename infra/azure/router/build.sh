#!/usr/bin/env bash
# Bundles the tenant router into a single self-contained .mjs for the VM.
#
# WHY BUNDLE AT ALL: the router must resolve tenants through the SAME
# `IdentityRegistry` the rest of the epic uses. That code is TypeScript in
# `clients/shared/`, and the VM has no TypeScript toolchain. The alternative -
# reimplementing the lookup in a hand-written .mjs on the box - would put a
# second implementation of the security control in the deploy path, which is
# precisely the divergence that hands one engineer another engineer's
# credentials. So: one implementation, compiled.
#
# The output has NO runtime dependencies (zod and ws are both bundled in), so
# deploying it is a file copy with no `npm install` on the VM.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="${1:-${REPO_ROOT}/infra/azure/router/dist/tenant-router.mjs}"

BUN="${BUN:-$(command -v bun || echo "${HOME}/.bun/bin/bun")}"
if [ ! -x "$BUN" ]; then
  echo "build: bun not found (set \$BUN or install to ~/.bun/bin/bun)" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
"$BUN" build "${REPO_ROOT}/infra/azure/router/tenant-router.ts" \
  --target=node \
  --format=esm \
  --outfile="$OUT"

echo "build: wrote $OUT" >&2
