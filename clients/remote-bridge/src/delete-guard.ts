/**
 * May this chat be deleted?
 *
 * A pure function rather than three `if`s inside the CLI action, because a
 * guard that cannot be run in a test is a guard nobody knows works — and this
 * is the one verb in the bridge with no undo. Its failure modes deserve to be
 * exercised without a host.
 *
 * WHAT IT IS GUARDING AGAINST. `epic.deleteChat` takes an id and deletes
 * whatever that id names. A chat id is a UUID, so nothing about it is
 * checkable by eye: a transposed character does not fail, it addresses
 * somebody else's agent. The caller therefore states what they believe they
 * are deleting and this compares that belief against the host's own title.
 * The id says WHICH; the title says WHAT, and only the title can be wrong in
 * a way a human notices.
 */
import type { AgentSummary } from "./action-surface";

export type DeleteCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

export function checkDeleteTarget(
  agents: readonly AgentSummary[],
  chatId: string,
  expectTitle: string,
): DeleteCheck {
  const match = agents.find((a) => a.agentId === chatId);
  if (match === undefined) {
    /*
     * NOT "already deleted, nothing to do".
     *
     * `agent.list` is scoped, so absence is ambiguous between "gone" and "not
     * visible to me" — and treating an ambiguous absence as success is how a
     * command reports that it cleaned something up while the thing is still
     * there. Refusing is recoverable; a confident wrong answer is not.
     */
    return {
      ok: false,
      reason: `no chat ${chatId} visible in this epic — refusing to delete an id I cannot see`,
    };
  }
  if (match.title !== expectTitle) {
    return {
      ok: false,
      reason: `expected title ${JSON.stringify(expectTitle)}, host says ${JSON.stringify(match.title)}`,
    };
  }
  return { ok: true };
}
