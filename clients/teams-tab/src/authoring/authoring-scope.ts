/**
 * Why one authoring surface is built and two are not.
 *
 * Authoring is not one capability. The three creates differ in what they must
 * know about a MACHINE, and that difference decides which are honest to build
 * from a Teams tab.
 *
 *   epic.createArtifact  { epicId, parentId, artifactType, title }
 *                        Nothing machine-specific. BUILT.
 *
 *   epic.createChat      requires a durable `hostId`, stamped FOR LIFE.
 *                        Buildable — but only while naming the host it will
 *                        run on, because this is where "which machine" stops
 *                        being a label on a read-only row and becomes a
 *                        CHOICE the user is making without being told.
 *
 *   epic.create          same `hostId` disclosure as a chat, because it folds
 *                        one in. BUILT — see the correction below.
 *
 * THE DISTINCTION MATTERS. "Unbuilt" invites someone to build it; "blocked on
 * a path a Teams user cannot supply" tells them what to solve first. Recording
 * the second as the first is how a real gap becomes a backlog item that gets
 * picked up and abandoned.
 *
 * ─── CORRECTED 2026-08-01. This file made the opposite error, and its own
 * rule above is what names it. ───────────────────────────────────────────────
 *
 * This docblock previously said `epic.create` "requires `workspaces:
 * [{ workspacePath }]` — ABSOLUTE FILESYSTEM PATHS on a specific machine. NOT
 * built, and not merely unbuilt", and the parity contract carried that forward
 * as the tab's only 🔴 BLOCKED row.
 *
 * The premise was true and the conclusion did not follow. The answer is not to
 * supply a path — it is to need none:
 *
 *   - `createEpicRequestSchema.workspaces` is `z.array(...)` with NO `.min(1)`.
 *     `[]` is a valid request. Asserted by parsing a built request against the
 *     REAL schema in `shared/epic/__tests__/create-epic.test.ts`, so this is
 *     executable rather than a second opinion about the same file.
 *   - Desktop calls it that way itself: gui-app's landing composer has two
 *     tests named "creates a folderless epic without a selected workspace
 *     folder". Folderless is a first-class host flow, not a client degradation.
 *   - `epic.create` is on the released floor, so no host lacks it.
 *
 * So a capability that was BUILDABLE sat recorded as BLOCKED — the exact
 * inversion the paragraph above warns about, and more costly in this direction:
 * "unbuilt" invites someone to look, while "blocked on a precondition" tells
 * them not to bother. It stood for two days and was believed because the
 * reasoning was sound everywhere except its one unchecked premise.
 *
 * WHAT REMAINS TRUE. A Teams user still cannot browse the host's disk, and no
 * RPC lists workspaces. That is why the create is folderless and cannot be
 * anything else from here — the constraint was real, only its consequence was
 * wrong. An epic that needs a bound repo still has to be made where the paths
 * are known.
 */

/** What a chat create must disclose before it stamps a host for life. */
export interface HostDisclosure {
  /** The host this client is bound to, or `null` when none is configured. */
  readonly hostId: string | null;
  /**
   * Whether creation may proceed.
   *
   * `false` when no host id is configured. Creating anyway would stamp the
   * local UI LABEL as the chat's durable host — mobile's own comment records
   * where that leads: "a chat created that way renders as an unreachable host
   * on desktop, a real protocol gap". Refusing is the honest outcome, because
   * the alternative writes a permanent wrong answer rather than a temporary
   * one.
   */
  readonly canCreate: boolean;
  /** Shown at the point of creation, never discovered afterwards. */
  readonly notice: string;
}

export function hostDisclosure(configuredHostId: string): HostDisclosure {
  if (configuredHostId.trim().length === 0) {
    return {
      hostId: null,
      canCreate: false,
      notice:
        "This app doesn’t know which Traycer host it’s connected to, so a new agent can’t be given one. It needs redeploying with its host configured — nothing is wrong with your account.",
    };
  }
  return {
    hostId: configuredHostId,
    canCreate: true,
    notice: `This agent will run on the host this tab is connected to (${configuredHostId.slice(0, 8)}), and that can’t be changed later.`,
  };
}

/**
 * What an epic create must disclose. Two facts, and the second is the one
 * nobody would guess.
 *
 * The host binding is the same permanent choice a chat create makes, because
 * `epic.create` folds a first chat in and that chat carries `hostId` for life.
 *
 * The FOLDERLESS part is disclosed because it is a real limitation on what the
 * new agent can do, and it is invisible at the moment of creation — the epic
 * looks like any other in the fleet. Someone who creates an epic here expecting
 * it to be able to read their repository would find out only when the agent
 * could not, which is the "the button did nothing" failure one layer up: it
 * works, and does less than the user believed they asked for.
 */
export function epicCreateDisclosure(
  configuredHostId: string,
  userId: string,
): HostDisclosure {
  const host = hostDisclosure(configuredHostId);
  if (!host.canCreate) return host;
  if (userId.trim().length === 0) {
    // `createdBy` is what `epic.listTasks`' ownership filter compares against,
    // so creating before the identity resolves makes an epic the user cannot
    // see in their own fleet. Refusing is recoverable; that is not.
    return {
      hostId: host.hostId,
      canCreate: false,
      notice:
        "Still confirming who you’re signed in as. A new epic would be filed under the wrong owner and wouldn’t appear in your list — this should clear in a moment.",
    };
  }
  return {
    hostId: host.hostId,
    canCreate: true,
    notice: `This epic will run on the host this tab is connected to (${configuredHostId.slice(0, 8)}). It won’t be bound to a folder on that machine, so its agents can plan and answer questions but can’t read your repository — Teams has no way to browse the host’s disk.`,
  };
}
