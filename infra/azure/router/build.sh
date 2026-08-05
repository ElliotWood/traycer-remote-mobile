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
# WHAT IS AND IS NOT BUNDLED, and why that changed.
#
# `ws` and `zod` are EXTERNAL. They used to be bundled, which made the output
# 600,246 bytes - too large to ship through any first-boot mechanism Azure
# offers, and the reason the router existed only as a manual change on the
# running VM while a rebuild would have silently reproduced the pre-A2
# single-tenant relay. External, the same bundle is 16,431 bytes: ordinary
# text that the provisioning payload carries like any other script.
#
# The security argument for bundling is untouched. It was never about third-
# party packages - it was that `IdentityRegistry` must not be reimplemented in
# a deploy script, because a second implementation of the security control is
# what hands one engineer another engineer's credentials. That code is still
# compiled in from clients/shared. Only `ws` and `zod` moved, and they move to
# an `npm install` bootstrap.sh already performs in the very directory this
# artifact is deployed to.
#
# So the VM needs `ws` and `zod` present alongside the output - see
# bootstrap.sh's "installing the tenant router" phase, which installs both.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# Default output is TRACKED, not dist/. The VM has no TypeScript toolchain
# (see above), so a compiled artifact has to travel with the IaC - and the
# only alternatives were a build artifact fetched from somewhere outside the
# repo, or the status quo where the router existed on the VM and nowhere in
# the deploy path. A tracked 16 KB ESM file is readable in review and cannot
# go missing at deploy time.
#
# It CAN go stale, which is the honest cost. verify-iac-parity.sh rebuilds
# from source and refuses if the tracked file's sha256 differs, so staleness
# is a checked invariant rather than something a reviewer has to notice.
OUT="${1:-${REPO_ROOT}/infra/azure/router/tenant-router.generated.mjs}"

BUN="${BUN:-$(command -v bun || echo "${HOME}/.bun/bin/bun")}"
if [ ! -x "$BUN" ]; then
  echo "build: bun not found (set \$BUN or install to ~/.bun/bin/bun)" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

# 🔴 THE BUILD MUST RUN FROM THE REPO ROOT, AND THIS IS NOT TIDINESS.
#
# `bun build` writes each module's path into the output as a comment, RELATIVE
# TO THE PROCESS CWD. So the same sources produce different bytes depending on
# where the caller happened to be standing:
#
#   cwd = repo root   // infra/azure/router/tenant-router.ts              16,431 bytes
#   cwd = anywhere    // ../../worktrees/<machine-specific path>/…        17,103 bytes
#
# verify-iac-parity.sh's step 0 rebuilds from source and compares against the
# tracked artifact, so without this `cd` its verdict depends on the caller's
# directory: run it from the repo root and the bundle is "ok", run it from a
# scratch directory and the SAME COMMIT is reported STALE. Measured, both ways,
# during the A0 scratch deploy - it is what that run hit first.
#
# The failure is worse than a false red, because the check tells you to act on
# it: "Rebuild it and commit the result." Doing that commits one machine's
# directory layout into a tracked file, which then reads STALE for everyone
# else - a flip-flop that never converges, and a local path leaked into the
# repo on top of it.
#
# `$OUT` is made absolute FIRST: it may have been passed relative to the
# caller's cwd (verify-iac-parity.sh passes a mktemp path), and resolving it
# after the `cd` would write the bundle somewhere nobody looks.
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
cd "$REPO_ROOT"

"$BUN" build "${REPO_ROOT}/infra/azure/router/tenant-router.ts" \
  --target=node \
  --format=esm \
  --external ws \
  --external zod \
  --outfile="$OUT"

echo "build: wrote $OUT" >&2
