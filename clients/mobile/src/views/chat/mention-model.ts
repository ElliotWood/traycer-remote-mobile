/**
 * M3 item 3 — the pure half of `@`-file mentions: which roots to ask about,
 * what a suggestion serializes to, and what an EMPTY result means.
 *
 * ## The empty result is the whole problem
 *
 * Measured against the live host (`tmp/probe-m3e.mjs`), `workspace.mentionFiles`
 * answers `entries: []` for all of:
 *
 * | condition | count |
 * | --- | --- |
 * | genuine no-match (`query: "zzzznotafilezzzz"`) | 0 |
 * | a path that does not exist on the host | 0 |
 * | `roots: []` | 0 |
 * | a readable but EMPTY directory | 0 |
 *
 * There is no error, no outcome field, no distinguishing shape — an empty
 * success in every case. `workspace.listDirectory` has the same defect.
 * So **any assertion about the empty state is vacuous**: "the empty query
 * renders the empty state" passes against a client that never connected.
 *
 * The canary is the answer, and it is a workaround with a stated removal
 * condition: **delete it when `workspace.searchPaths` reaches the released
 * floor**, because that method carries a typed `root_unavailable` outcome and
 * makes the whole file unnecessary. It is in `registry.ts` and answers
 * `host-missing-method` today.
 *
 * ## Two corrections to the canary as it was specified
 *
 * **It is per root, not per query.** The ticket's canary is a single extra
 * query issued alongside the user's. Measured: `roots: [real, BOGUS]` returns
 * 25 rows, order-independently, and every row carries the real root's
 * `workspacePath`. A half-broken binding is therefore *indistinguishable from
 * full health* under an aggregate canary — which is the same
 * one-of-the-thing blindness the canary was designed to fix, reappearing
 * inside the fix. One canary per root, and it is a property of the ROOT, so it
 * is issued once when the sheet opens rather than on every keystroke.
 *
 * **It reads "unreadable OR empty", not "unreadable".** A readable, empty
 * directory answers 0 to the canary. Left alone, the canary would tell someone
 * with a healthy workspace that it is broken — replacing an ambiguity with a
 * confident wrong answer, which is the worse failure. Contained here by only
 * ever speaking when there is nothing to show anyway, and by wording that is
 * true under both readings (see `mentionEmptyState`).
 */
import type {
  WorktreeBinding,
  WorktreeBindingEntry,
} from "@traycer/protocol/host/worktree-schemas";
import type {
  WorkspaceFileMentionSuggestion,
  WorkspaceFolderMentionSuggestion,
} from "@traycer/protocol/host/workspace/unary-schemas";

export type MentionSuggestion =
  | WorkspaceFileMentionSuggestion
  | WorkspaceFolderMentionSuggestion;

/**
 * The directories to search, one per binding entry.
 *
 * `worktreePath` in preference to `workspacePath`: a bound chat's agent runs
 * IN the worktree, and the two check out different branches — a file that
 * exists only on the chat's branch is absent from the source workspace. The
 * ticket named `workspacePath`; that is the right root only for a `local`-mode
 * entry, where `worktreePath` is null.
 *
 * De-duplicated because two entries can legitimately name the same directory
 * (the same repo bound twice under different modes), and a duplicated root
 * would mean a duplicated canary and duplicated rows.
 */
export function mentionRootsForBinding(
  binding: WorktreeBinding | null,
): readonly string[] {
  if (binding === null) return [];
  const roots: string[] = [];
  for (const entry of binding.entries) {
    const root = rootForEntry(entry);
    if (root.length > 0 && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

function rootForEntry(entry: WorktreeBindingEntry): string {
  return entry.worktreePath ?? entry.workspacePath;
}

/**
 * The root the agent's process actually runs in — i.e. what a bare relative
 * path resolves against.
 *
 * `isPrimary` is the host's own word for this: *"which directory an AGENT runs
 * in"* (`worktree-schemas.ts:496`). It is what makes a `@<relPath>` token
 * resolvable, and it is the only thing that distinguishes the root where that
 * token works from the roots where it silently cannot.
 *
 * Returns `null` when the binding names no primary entry AND has more than one
 * root. That is a state this host has never produced (`isPrimary` is a required
 * boolean, and every multi-root chat measured reports exactly one), and the
 * `null` is deliberately routed to the OLD behaviour by `mentionToken` rather
 * than to the new one: if we cannot say which root is primary we cannot say
 * which are secondary either, and inventing a divergence from desktop in a
 * state nobody has observed is worse than carrying a defect that only shows up
 * in the same state.
 *
 * A single root is primary by construction whether or not the flag says so —
 * there is nowhere else for the agent to be running.
 */
export function primaryMentionRoot(binding: WorktreeBinding | null): string | null {
  if (binding === null) return null;
  const flagged = binding.entries.find((entry) => entry.isPrimary);
  if (flagged !== undefined) return rootForEntry(flagged);
  const roots = mentionRootsForBinding(binding);
  return roots.length === 1 ? roots[0] : null;
}

/**
 * What gets spliced into the textarea, and it is the payload.
 *
 * Mobile sends plain text, so the token has to be a string the agent can
 * actually resolve. There is no attachment, no node, no second channel: the
 * token is the whole mechanism.
 *
 * ## What a mention token really is, measured
 *
 * `@<relPath>` does not "resolve a mention" anywhere — on either client. It
 * hands the agent a path and the agent reads it **relative to its own cwd**.
 * That is why it works: cwd is the primary root. Measured live, with the
 * agent's own words: `@wrangler.toml`, offered by this sheet from a SECONDARY
 * binding root, reached the host as inert prose (*"it wasn't provided in the
 * system input"*), and the agent then reached for its Read tool against cwd
 * and errored. A primary-root file in the same chat "passed" — by the same cwd
 * fallback, not by any mention machinery. **One root is a check that cannot
 * fail; two roots is an experiment.**
 *
 * So a secondary root does not break mentions. It is the first case that makes
 * them observable.
 *
 * ## Why this is not a divergence from desktop
 *
 * Desktop's serializer has the identical defect, in shared code:
 * `protocol/src/common/json-content-serializer.ts:369-372` emits
 * `atRef(attrs.relPath || attrs.id)` for File and Folder — a bare relPath —
 * although the node's attrs carry `absolutePath`. **Its own `Worktree` arm two
 * lines below emits the ABSOLUTE path**, with the comment *"a worktree lives
 * outside the workspace root, so its absolute directory is the only path that
 * resolves for the agent."* A secondary workspace root is the same condition
 * and the same fix; it just was not applied there. (The `Chat`/`TerminalAgent`
 * arm settles that the string is the whole channel: the agent id was already
 * in the attrs and still had to be written INTO the text for the runtime to
 * have it — `json-content-serializer-agent-mentions.test.ts:9-20`.)
 *
 * That defect is filed against the shared line. Both clients converge on this
 * behaviour; only the shipping vehicles differ — mobile emits its own string,
 * so the fix lands here first. **If a later parity sweep finds mobile ahead of
 * `json-content-serializer.ts:369-372`, that is this fix arriving first, not
 * mobile drifting. Do not revert it to match.**
 *
 * ## The rule
 *
 * Primary root → `@<relPath>`, byte-identical to desktop, because cwd resolves
 * it. Any other root → `@<absolutePath>`, mirroring the `Worktree` arm's
 * precedent exactly rather than inventing a policy.
 *
 * Classification is an exact string comparison, and that is measured rather
 * than assumed: `workspace.mentionFiles`/`mentionFolders` echo the REQUESTED
 * root back verbatim in `workspacePath` (`tmp/probe-mention-roots.mjs`: 25
 * exact-echo rows per root, and the distinct `workspacePath` values on the
 * wire are exactly the two strings requested). The roots we compare against
 * are the same strings the request was built from, so no normaliser is needed
 * — and a case-folding one would be wrong on a POSIX host.
 *
 * Folders need the one special case. Measured on the same host, a folder's
 * `relPath` carries its trailing slash (`scripts/`) and its `absolutePath`
 * does NOT (`…\scripts`), so the separator is re-appended — taking the one the
 * path already uses rather than picking one, since the agent is told the
 * absolute path in the host's own separator convention.
 *
 * A relPath containing a space produces a token the agent will read as ending
 * at the space. Desktop's LLM serializer does not quote either, so this is
 * parity rather than a regression, and quoting unilaterally would emit a
 * string desktop never emits.
 */
export function mentionToken(
  suggestion: MentionSuggestion,
  primaryRoot: string | null,
): string {
  if (primaryRoot === null) return `@${suggestion.relPath}`;
  if (suggestion.workspacePath === primaryRoot) return `@${suggestion.relPath}`;
  if (suggestion.absolutePath.length === 0) return `@${suggestion.relPath}`;
  return `@${withTrailingSeparatorLike(suggestion.absolutePath, suggestion.relPath)}`;
}

/**
 * Re-applies `relPath`'s trailing separator to an absolute path that lost it.
 *
 * The separator is read off the absolute path itself — the host answers
 * Windows roots in backslashes and POSIX roots in slashes, and appending the
 * other one produces a path in neither convention.
 */
function withTrailingSeparatorLike(absolutePath: string, relPath: string): string {
  const trailing = relPath.endsWith("/") || relPath.endsWith("\\");
  if (!trailing) return absolutePath;
  if (absolutePath.endsWith("/") || absolutePath.endsWith("\\")) return absolutePath;
  return `${absolutePath}${absolutePath.includes("\\") ? "\\" : "/"}`;
}

/**
 * A root's state, INCLUDING an arm for "we cannot tell".
 *
 * `unknown` exists because of a defect the Evidence Gate found in the first
 * version of this file, which had only the first three arms. With no way to
 * say *ignorance*, an unknown state has to collapse into one of the others,
 * and it collapsed both possible ways at once:
 *
 * - a probe that never answered stayed `checking` forever — correct, but
 *   indistinguishable from a slow probe, with no copy able to say which;
 * - a client that was not connected produced NO statuses, and the verdict
 *   inferred `unavailable` from the empty list — **"your workspace is
 *   unreadable" when the true fact was "the socket is not connected"**.
 *
 * The second is exactly the confusion the transport-failure `catch` in
 * `use-mention-files.ts` was written to refuse. That guard was on the throwing
 * path; the ignorant path reached the same wrong conclusion without passing
 * through it. **A guard on the exception is not a guard on the ignorance.**
 *
 * It is also the third missing-`unknown`-arm defect in this epic (M2's
 * rate-limit model was the first two), and the most pointed: the canary exists
 * to remove an unfalsifiable state and had reintroduced one in its own verdict.
 */
export type RootHealth = "checking" | "readable" | "unavailable" | "unknown";

export interface MentionRootStatus {
  readonly root: string;
  readonly health: RootHealth;
}

/**
 * What to show when there is nothing to list. Total over the four things that
 * can actually be true, rather than inferred from a list's length.
 *
 * `"unavailable"` is the canary's verdict and is only reachable when a root
 * genuinely answered zero — so the readable-but-empty false positive can only
 * surface where there was nothing to mention anyway, and the copy is true
 * under both readings.
 */
export type MentionEmptyState =
  | "loading"
  | "no-matches"
  | "unavailable"
  | "undetermined"
  | null;

export interface MentionEmptyInput {
  /** False when there is no host client — ignorance, never a verdict about a root. */
  readonly connected: boolean;
  readonly loading: boolean;
  readonly suggestions: readonly MentionSuggestion[];
  readonly statuses: readonly MentionRootStatus[];
}

export function mentionEmptyState(input: MentionEmptyInput): MentionEmptyState {
  const { connected, loading, suggestions, statuses } = input;
  if (suggestions.length > 0) return null;
  // Ordered so that every arm is justified by evidence the previous arms
  // could not have produced. Nothing here reads a LENGTH as a verdict.
  if (!connected) return "undetermined";
  if (loading) return "loading";
  // No canary has reported yet — the first render after the trigger goes
  // active, since both effects run post-commit. Silence is not a finding.
  if (statuses.length === 0) return "loading";
  if (statuses.some((s) => s.health === "checking")) return "loading";
  // One root that genuinely answered is enough to make "no matches" true: the
  // query reached a readable workspace and matched nothing.
  if (statuses.some((s) => s.health === "readable")) return "no-matches";
  if (statuses.every((s) => s.health === "unavailable")) return "unavailable";
  // Nothing readable, and at least one root we could not determine. Claiming
  // either verdict here would be asserting something no probe established.
  return "undetermined";
}

/**
 * Roots that failed the canary while at least one other passed.
 *
 * This is the partial failure that an aggregate canary cannot see: results
 * come back, the sheet looks healthy, and one of the user's repositories is
 * silently contributing nothing. Empty when every root failed — that case is
 * the empty state above, not a footnote on a populated list.
 */
export function partiallyUnavailableRoots(
  statuses: readonly MentionRootStatus[],
): readonly string[] {
  const unavailable = statuses.filter((s) => s.health === "unavailable");
  if (unavailable.length === 0) return [];
  // "Every root is broken" is the empty state, not a footnote on a populated
  // list. Compared against a verdict count rather than `statuses.length` so an
  // `unknown` sibling cannot make an all-broken binding look partial — that
  // would name one root while implying the others were fine, which is the
  // ignorance-as-verdict mistake in miniature.
  const determined = statuses.filter((s) => s.health !== "unknown");
  if (unavailable.length === determined.length) return [];
  return unavailable.map((s) => s.root);
}
