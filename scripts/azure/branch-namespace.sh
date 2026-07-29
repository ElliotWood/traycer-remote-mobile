#!/usr/bin/env bash
# Validates and constructs the branch name Traycer uses when it creates a
# per-chat worktree in the shared Azure repo: `u/<identity>/<chat-id>`.
#
# Why the `u/` prefix and not bare `<identity>/<chat-id>` (A4 contract, B2):
# a flat branch literally named `<identity>` (created by anyone with shell
# access to the shared repo - any agent, per the project's already-accepted
# same-OS-user risk) permanently blocks every future worktree for that
# identity, because git refuses a ref that is simultaneously a leaf and a
# namespace directory. Reserving one prefix token narrows the collision
# surface from N identity names to a single documented token nobody should
# use directly - it does NOT eliminate the vector (a flat `u` or `u/<identity>`
# branch is still possible from a shell), so the pre-flight check below is a
# diagnostic that fails loudly with a specific reason, not a guarantee.
#
# `identity` is A2's `hostId` (revised by the Evaluator/A2 during this
# build - NOT the AAD object id: A2 declined to hand over oids on privacy
# grounds, since an oid correlates a person across every AAD-integrated
# system and a GUID welded into git branch history outlives the branch).
# `hostId` carries no meaning outside this deployment and is the reverse-
# lookup key for `resolveIdentity(hostId)`.
#
# A2's registry (`registry-config.ts`) enforces `hostId` against the exact
# same allow-list at LOAD TIME and refuses to load a non-conforming value -
# so this script's identity check is now an ASSERTION of an invariant A2
# already guarantees, not primary defense (unlike the chat-id check below,
# which remains primary defense against a genuinely untrusted value). Kept
# rather than dropped because it's cheap, and asserting an invariant that's
# supposed to already hold is exactly how a violation elsewhere gets caught
# instead of silently propagating.
#
# STATED ASSUMPTION this script (and the whole branch-name-as-identity
# design) depends on but cannot enforce: a retired `hostId` is never
# reissued. Branch history outlives the tenant it named, so a recycled
# hostId would silently attribute a departed colleague's branches to
# whoever gets that id next. This is a config-issuance-time concern A2's
# registry has no visibility into - it belongs to A1/A3. Written down here,
# not enforced here.
#
# `chat_id` is client-supplied per protocol
# (protocol/src/host/epic/unary-schemas.ts:924-925: "Client-supplied. The
# host resolver is idempotent on this id.") with no format constraint beyond
# `z.string()`. This script is therefore the only thing standing between an
# untrusted chat-id and git - see the -D/--force flag-injection finding
# below. Git's own validation is NOT a safety net (A4 contract, B1): a branch
# name starting with `-` is parsed as an option by git's own arg parser and
# can delete an unrelated branch while reporting failure. This script rejects
# a leading `-` before either segment ever reaches a git invocation.
set -euo pipefail

readonly SEGMENT_RE='^[a-z0-9][a-z0-9-]{0,63}$'
readonly RESERVED_PREFIX="u"

azure_validate_segment() {
  # Force byte-wise ASCII collation on EVERY call, not just once when this
  # file is sourced. Under a UTF-8 locale (e.g. en_US.UTF-8, the common
  # Linux server default), glibc collation interleaves case (a A b B c C
  # ...), so the bracket expression [a-z] matches uppercase letters too -
  # `ALICE` passes a `[a-z0-9]`-anchored pattern under `en_US.UTF-8` but is
  # correctly rejected under `C`/`C.UTF-8` (verified empirically across all
  # three; see branch-namespace.test.sh).
  #
  # This is LOAD-BEARING beyond this script's own correctness (A4 contract
  # B3 amendment): A2's `registry-config.ts` enforces the identical regex
  # string `^[a-z0-9][a-z0-9-]{0,63}$` in JS, where character ranges are
  # code-point-based and locale-independent - JS rejects "ALICE" always. If
  # this shell check ran under an inherited UTF-8 locale, it would ACCEPT
  # "ALICE" while A2's registry REJECTS it: the two layers would silently
  # disagree about what a valid identity looks like, exactly the
  # cross-layer drift the Evaluator flagged. Forcing `LC_ALL=C` here is what
  # makes this check mean the same thing as A2's JS check, not just a local
  # footgun fix. `local` scopes it to the function so it does not leak the
  # caller's locale for anything else they do afterward.
  local LC_ALL=C
  local label="$1" value="$2"
  if [ -z "$value" ]; then
    echo "azure-branch-namespace: ${label} must not be empty" >&2
    return 1
  fi
  if [ "${#value}" -gt 64 ]; then
    echo "azure-branch-namespace: ${label} '${value}' exceeds 64 characters" >&2
    return 1
  fi
  if [[ "$value" == -* ]]; then
    echo "azure-branch-namespace: ${label} '${value}' starts with '-' - rejected outright (flag-injection risk into git's own arg parser, e.g. '-D', '--force', '-b', '--track' can delete or reconfigure an unrelated branch; see A4 contract B1)" >&2
    return 1
  fi
  if [[ "$value" == "$RESERVED_PREFIX" ]]; then
    echo "azure-branch-namespace: ${label} '${value}' collides with the reserved namespace prefix '${RESERVED_PREFIX}'" >&2
    return 1
  fi
  if ! [[ "$value" =~ $SEGMENT_RE ]]; then
    echo "azure-branch-namespace: ${label} '${value}' fails the allow-list ${SEGMENT_RE} (ASCII lowercase letters, digits, internal hyphens only - no '/', no uppercase under any locale, no non-ASCII/homoglyph/zero-width characters)" >&2
    return 1
  fi
}

# Pre-flight check: walk every ancestor ref path component and fail loudly,
# naming the blocking branch, if any ancestor already exists as a flat leaf
# ref (the D/F conflict from A4 contract B2/B1's D/F test). This is a
# diagnostic, not a guarantee - it races with concurrent branch creation
# elsewhere in the shared repo, and it cannot stop a flat `u` or `u/<identity>`
# branch from being created by a later, out-of-band `git branch` call. The
# actual creation still goes through git, whose own atomic ref lock is the
# real safety net against a *race*; this check only makes the common,
# already-existing case fail with a useful message instead of git's generic
# "cannot lock ref" two layers down.
azure_preflight_ancestors() {
  local repo_dir="$1" identity="$2"
  local -a ancestors=("$RESERVED_PREFIX" "$RESERVED_PREFIX/$identity")
  local ancestor
  for ancestor in "${ancestors[@]}"; do
    if git -C "$repo_dir" show-ref --verify --quiet "refs/heads/${ancestor}"; then
      echo "azure-branch-namespace: a flat branch 'refs/heads/${ancestor}' already exists and blocks the '${ancestor}/...' namespace - rename or remove it before this identity can get any worktree" >&2
      return 1
    fi
  done
}

# azure_branch_name <repo-dir> <identity> <chat-id>
# Prints the validated branch name to stdout on success. On failure, prints a
# specific reason to stderr and returns non-zero - never prints a partial or
# best-effort name.
azure_branch_name() {
  local repo_dir="$1" identity="$2" chat_id="$3"
  # Each check's exit status is propagated EXPLICITLY with `||`, not left to
  # `set -e`: a caller that invokes this function inside an `if`/`&&`/`||`
  # context (exactly what "reject bad input" tests do) suspends `set -e` for
  # the whole call chain per bash semantics, so an unchecked failing
  # sub-call would silently fall through to the final `echo` and return
  # success anyway. Caught by this suite's own B1 regression tests failing
  # against the first version of this function - a real bug, not a
  # hypothetical one.
  azure_validate_segment "identity" "$identity" || return 1
  azure_validate_segment "chat-id" "$chat_id" || return 1
  azure_preflight_ancestors "$repo_dir" "$identity" || return 1
  echo "${RESERVED_PREFIX}/${identity}/${chat_id}"
}

# Allow standalone CLI use: `branch-namespace.sh <repo-dir> <identity> <chat-id>`
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  if [ "$#" -ne 3 ]; then
    echo "usage: branch-namespace.sh <repo-dir> <identity> <chat-id>" >&2
    exit 2
  fi
  azure_branch_name "$1" "$2" "$3"
fi
