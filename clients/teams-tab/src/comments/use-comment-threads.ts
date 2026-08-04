/**
 * The comments panel's data: `epic.listCommentThreads`,
 * `epic.replyToCommentThread`, `epic.setCommentThreadResolved`.
 *
 * All three are on the RELEASED FLOOR, so there is no "host lacks the method"
 * state to model here — unlike `use-settings.ts`, whose notification-config
 * pair is off-floor and needs one:
 *
 * ```sh
 * grep -nE '"epic\.(listCommentThreads|replyToCommentThread|setCommentThreadResolved)"' \
 *   protocol/src/host/released-floor.ts
 * #   all three present
 * ```
 *
 * WHY NOT MOBILE'S HOOKS, given the extract-on-demand rule. Mobile's
 * `use-comment-threads.ts` / `use-comment-thread-mutations.ts` are
 * `@tanstack/react-query` wrappers, and **`clients/teams-tab` does not depend
 * on react-query at all** (`grep tanstack clients/teams-tab/package.json` →
 * nothing). Moving them to `clients/shared` would drag that dependency into a
 * bundle that loads inside a Teams iframe, to replace ~5 lines of
 * `client.request` per call. The `useCallback`-invoked-from-an-effect shape
 * below is `use-settings.ts`'s, which is this package's established way to
 * load over RPC without tripping `react-hooks/set-state-in-effect`. What IS
 * genuinely shared — the plain-text `JsonContent` builder — is imported from
 * `clients/shared` rather than retyped.
 *
 * PULL-BASED, and that is the protocol's shape rather than a simplification:
 * there is no push stream for comments, so a write is only reflected once the
 * refetch it triggers lands. Every write therefore re-reads rather than
 * patching local state — the host's list is the only thing that knows whether
 * the write took.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HostRequester } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import { plainTextContent } from "@traycer-clients/shared/epic/comment-content";
import type {
  CommentThreadWire,
  ListCommentThreadsRequest,
} from "@traycer/protocol/host/epic/unary-schemas";

/** Only `request` is needed; kept narrow so tests inject a fake. */
export type CommentThreadsClient = Pick<HostRequester<HostRpcRegistry>, "request">;

/**
 * Which artifact's threads to read.
 *
 * Structurally `ListCommentThreadsRequest`, and declared as it rather than
 * re-typed, so the three write RPCs — which take the same three fields plus a
 * `threadId` — cannot drift from the read.
 */
export type CommentThreadsScope = ListCommentThreadsRequest;

export type CommentThreadsState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      /**
       * MAY be empty, and that is a real answer about an artifact nobody has
       * commented on — the opposite of `error`, which is no answer at all.
       * `CommentsPanel` renders the two differently.
       */
      readonly threads: readonly CommentThreadWire[];
      /** The thread whose write is in flight, so its controls can disable. */
      readonly busyThreadId: string | null;
      /** Set when the last write failed. Cleared when the next one starts. */
      readonly actionError: string | null;
    }
  | { readonly kind: "error"; readonly detail: string };

export interface CommentThreadsResult {
  readonly state: CommentThreadsState;
  readonly reply: (threadId: string, text: string) => void;
  readonly setResolved: (threadId: string, resolved: boolean) => void;
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

/**
 * Reads and writes one artifact's comment threads.
 *
 * `client` is `null` under any preview and when no host is configured; that
 * renders as an error rather than an eternal spinner, for the reason
 * `use-settings.ts` records — mobile's equivalent leaves a failed read
 * indistinguishable from a pending one and shows "Loading…" forever.
 */
export function useCommentThreads(
  client: CommentThreadsClient | null,
  scope: CommentThreadsScope,
): CommentThreadsResult {
  const [state, setState] = useState<CommentThreadsState>({ kind: "loading" });

  const { epicId, artifactType, artifactId } = scope;

  /**
   * Monotonic, incremented on every load, captured by each in-flight read.
   *
   * THE DEFECT THIS EXISTS FOR: opening artifact A then artifact B before A's
   * response lands. Without it the late A response calls `setState` last and
   * B's panel shows A's threads — under B's title, with B's reply box, so a
   * reply goes to the thread the user is looking at while the list they are
   * reading belongs to something else. Nothing on screen says so.
   *
   * A scope-equality check is NOT sufficient in its place: A → B → A makes the
   * scope equal again while A's first response is still outstanding, so the
   * stale one passes the check. A counter has no such collision.
   */
  const requestSeq = useRef(0);

  /**
   * Whether the host's list has landed, mirrored OUT of state.
   *
   * `beginWrite` needs to know this, and a `setState` updater cannot tell it:
   * the updater is not guaranteed to have run by the time the line after it
   * executes, and React invokes it twice under StrictMode. The first version
   * of this file set a local `permitted` flag inside the updater and returned
   * it — **every write was silently refused**, and the three tests that send
   * one caught it. `use-settings.ts` records the identical hazard for
   * `configRef` in its own words; this is that warning being re-earned.
   *
   * Written in the same three places `state` is, and nowhere else.
   */
  const ready = useRef(false);

  const load = useCallback(() => {
    if (client === null) {
      ready.current = false;
      setState({
        kind: "error",
        detail: "No Traycer host is configured for this build.",
      });
      return;
    }
    requestSeq.current += 1;
    const seq = requestSeq.current;
    client
      .request("epic.listCommentThreads", { epicId, artifactType, artifactId })
      .then((response) => {
        if (seq !== requestSeq.current) return;
        ready.current = true;
        setState({
          kind: "ready",
          // Oldest thread first, stable. Comments WITHIN a thread are left in
          // host order, which is authoritative — only the thread list itself
          // is re-ordered here. Same rule as mobile's hook.
          threads: [...response.threads].sort((a, b) => a.createdAt - b.createdAt),
          busyThreadId: null,
          actionError: null,
        });
      })
      .catch((error: unknown) => {
        if (seq !== requestSeq.current) return;
        ready.current = false;
        setState({ kind: "error", detail: describe(error) });
      });
  }, [client, epicId, artifactType, artifactId]);

  /**
   * Reload when the ARTIFACT changes, not once per mount.
   *
   * `use-settings.ts` guards with a bare `initialised.current` because its
   * three loads take no parameters and can only ever run once. This screen is
   * re-rendered with a new artifact rather than remounted — the same property
   * `EpicScreen` documents for `openedArtifact` — so that guard would pin the
   * panel to whichever artifact happened to be open first.
   *
   * THE KEY IS NUL-SEPARATED, AND THE NUL IS SPELLED AS AN ESCAPE.
   *
   * NUL because it cannot occur inside any of the three ids, so no two
   * distinct scopes can collide on one key. A space can: an id containing one
   * lets `a b` + `c` and `a` + `b c` produce the same string.
   *
   * As an escape because the first version of that line carried two RAW NUL
   * BYTES. Everything compiled and all 474 tests passed — inside a template
   * literal a NUL is just a character — but `grep` then classified the whole
   * file as **binary** and stopped printing matches from it, and the mutation
   * probe's target for the line matched zero times. The probe's occurrence
   * guard caught it (`ABORT MUT-4: target appears 0 times`), doing precisely
   * the job its docblock claims: without that guard an unedited file reports
   * SURVIVED. An invisible control character costs nothing at runtime and
   * breaks every text tool pointed at the file.
   */
  const loadedKey = useRef<string | null>(null);
  const scopeKey = `${epicId}\u0000${artifactType}\u0000${artifactId}`;
  useEffect(() => {
    if (loadedKey.current === scopeKey) return;
    loadedKey.current = scopeKey;
    load();
  }, [scopeKey, load]);

  /**
   * Marks a thread busy and clears the previous error, without disturbing the
   * threads already on screen.
   *
   * Returns whether the write may proceed: a write issued while the read has
   * not landed has no thread list to refetch into and no row to disable, so
   * it is refused rather than sent blind.
   */
  const beginWrite = useCallback((threadId: string): boolean => {
    if (!ready.current) return false;
    setState((prev) =>
      prev.kind === "ready"
        ? { ...prev, busyThreadId: threadId, actionError: null }
        : prev,
    );
    return true;
  }, []);

  const failWrite = useCallback((error: unknown) => {
    setState((prev) =>
      prev.kind === "ready"
        ? { ...prev, busyThreadId: null, actionError: describe(error) }
        : prev,
    );
  }, []);

  const reply = useCallback(
    (threadId: string, text: string): void => {
      if (client === null) return;
      // An empty reply is not a comment. `CommentsPanel` already disables the
      // button, but the guard is here too because the panel's rule is about
      // the control and this one is about the wire.
      if (text.trim().length === 0) return;
      if (!beginWrite(threadId)) return;
      client
        .request("epic.replyToCommentThread", {
          epicId,
          artifactType,
          artifactId,
          threadId,
          // The wire wants rich `JsonContent`, not a string. Built by
          // `clients/shared`'s builder — the same one gui-app and mobile use —
          // rather than a hand-written `{type:"doc"}` literal here, so a
          // schema change lands in one place.
          content: plainTextContent(text.trim()),
        })
        // Deliberately no optimistic append. The host assigns the comment id,
        // the author and the timestamp; a locally invented row would render
        // as replicated state and differ from what the refetch returns.
        .then(() => {
          load();
        })
        .catch(failWrite);
    },
    [client, epicId, artifactType, artifactId, beginWrite, failWrite, load],
  );

  const setResolved = useCallback(
    (threadId: string, resolved: boolean): void => {
      if (client === null) return;
      if (!beginWrite(threadId)) return;
      client
        .request("epic.setCommentThreadResolved", {
          epicId,
          artifactType,
          artifactId,
          threadId,
          resolved,
        })
        /*
         * THE TOGGLE ONLY MOVES ON A SUCCESSFUL REFETCH, and that is the same
         * decision `use-settings.ts` makes for its severity switches. Flipping
         * `resolved` locally on ack would leave the panel claiming a state the
         * host may not hold — and "Resolved" is a claim other people act on,
         * so the optimistic version is worse here than it is for a checkbox.
         */
        .then(() => {
          load();
        })
        .catch(failWrite);
    },
    [client, epicId, artifactType, artifactId, beginWrite, failWrite, load],
  );

  return { state, reply, setResolved };
}
