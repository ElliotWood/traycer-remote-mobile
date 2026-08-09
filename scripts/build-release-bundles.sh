#!/usr/bin/env bash
# Builds the two artefacts the Azure VM actually runs:
#
#   bot.cjs                 the Teams bot, started by traycer-teams-bot.service
#   traycer-remote-bridge   the bridge the bot spawns for every host call
#
# WHY THIS FILE EXISTS. Until now no script produced either one. `vm-deploy.sh`
# pulls both from the `demo/teams-bot-bundle` branch, and that branch was fed by
# hand. The result: on 2026-08-09 the deployed bridge was seven days behind
# `dd6de34e` ("adapt to upstream's new required host-transport fields") and
# nothing surfaced it, because there was no build to run and therefore nothing
# to notice that it had not been run.
#
# A release process that lives only in a shell history is not a release process.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${OUT_DIR:-$ROOT/build/release}"

# bun, not tsc+esbuild by hand: the repo pins `packageManager: bun@1.3.12` and
# uses `workspace:` and `catalog:` protocols that only bun resolves. Building
# with anything else silently resolves different dependency versions.
if ! command -v bun >/dev/null 2>&1; then
  echo "build-release: bun is not on PATH." >&2
  echo "  It installs to ~/.bun/bin and is frequently NOT added to PATH on Windows;" >&2
  echo "  an absent-looking bun is usually an unexported one." >&2
  exit 1
fi

WANT_BUN="$(node -p "require('$ROOT/package.json').packageManager.split('@')[1]" 2>/dev/null || echo '')"
HAVE_BUN="$(bun --version)"
if [ -n "$WANT_BUN" ] && [ "$WANT_BUN" != "$HAVE_BUN" ]; then
  # Not fatal, but it is the single most likely reason a rebuild does not
  # reproduce a previously shipped artefact byte-for-byte.
  echo "build-release: WARNING bun $HAVE_BUN, package.json pins $WANT_BUN." >&2
  echo "  Output may not be byte-reproducible against artefacts built elsewhere." >&2
fi

mkdir -p "$OUT"

# --target=node because both run under the VM's system node, not under bun.
# --format=cjs because the bot is loaded as `bot.cjs` by an ExecStart that
#   names it explicitly, and the bridge is spawned as a plain node script.
# The bridge's `#!/usr/bin/env node` shebang comes from its own source and bun
#   preserves it; do not add a --banner, which would produce two.
build() {
  local entry="$1" outfile="$2" label="$3"
  echo "--- $label"
  bun build "$ROOT/$entry" --target=node --format=cjs --outfile="$OUT/$outfile"
}

build clients/teams-bot/src/index.ts    bot.cjs               "teams-bot"
build clients/remote-bridge/src/index.ts traycer-remote-bridge "remote-bridge"

# The output filename is load-bearing, not cosmetic. `isBridgeCliEntrypoint` in
# clients/remote-bridge/src/index.ts matches the basename against
# `index.ts` / `traycer-remote-bridge` / `traycer-remote-bridge.exe`. Under any
# other name the binary starts and then does nothing useful, which is a far
# worse failure than not starting.
test -f "$OUT/traycer-remote-bridge" || { echo "build-release: bridge missing" >&2; exit 1; }

echo
echo "--- gates"
# A bundle that does not parse is the one failure that must never reach the VM,
# and `node --check` catches it in milliseconds.
node --check "$OUT/bot.cjs"
node --check "$OUT/traycer-remote-bridge"
echo "parse: ok"

# Stronger than parsing: the bridge must actually reach its CLI entrypoint.
# This is what fails if the output is misnamed, so it tests the check above.
if ! node "$OUT/traycer-remote-bridge" --help >/dev/null 2>&1; then
  echo "build-release: bridge built but does not answer --help." >&2
  echo "  Most likely the entrypoint guard did not match the output filename." >&2
  exit 1
fi
echo "bridge --help: ok"

echo
for f in bot.cjs traycer-remote-bridge; do
  printf '%-24s %10s bytes  sha256 %s\n' "$f" \
    "$(wc -c < "$OUT/$f")" "$(sha256sum "$OUT/$f" | cut -c1-16)"
done
echo
echo "built into $OUT"
echo "Record the source commit with the artefacts: $(git -C "$ROOT" rev-parse --short HEAD)"
