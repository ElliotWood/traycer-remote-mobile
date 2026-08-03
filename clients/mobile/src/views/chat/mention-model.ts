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
 * What gets spliced into the textarea, and it is the payload.
 *
 * Mobile sends plain text, so the token has to be the exact string desktop's
 * mention node serializes to for the agent. That is `@<relPath>` —
 * workspace-relative and POSIX-separated — from
 * `json-content-serializer.ts:368-372` (`atRef(attrs.relPath || attrs.id)`),
 * NOT the label and NOT the absolute path. Folder `relPath` already carries
 * its trailing slash by convention, so folders need no special case.
 *
 * Worth stating because the claim "a token IS the payload" was cited to the
 * WORKTREE schema's docblock, which serializes an ABSOLUTE `@<worktreePath>`.
 * Files are the opposite. Reading that citation as covering files would have
 * shipped absolute paths to the agent.
 *
 * A relPath containing a space produces a token the agent will read as ending
 * at the space. Desktop's LLM serializer does not quote either, so this is
 * parity rather than a regression, and quoting unilaterally would emit a
 * string desktop never emits.
 */
export function mentionToken(suggestion: MentionSuggestion): string {
  return `@${suggestion.relPath}`;
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
