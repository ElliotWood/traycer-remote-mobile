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
 *   epic.create          requires `workspaces: [{ workspacePath }]` —
 *                        ABSOLUTE FILESYSTEM PATHS on a specific machine.
 *                        NOT built, and not merely unbuilt: a person in Teams
 *                        has no way to know or browse a directory on the
 *                        host, and there is no RPC that lists them.
 *
 * THE DISTINCTION MATTERS. "Unbuilt" invites someone to build it; "blocked on
 * a path a Teams user cannot supply" tells them what to solve first. Recording
 * the second as the first is how a real gap becomes a backlog item that gets
 * picked up and abandoned.
 *
 * `epic.create` belongs to the execution-targeting question, not to this
 * client. Single-host is the confirmed direction, so this is NOT an argument
 * for building toward multi-host — it is an argument for not shipping a
 * create flow that silently picks a machine and a directory on the user's
 * behalf.
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
