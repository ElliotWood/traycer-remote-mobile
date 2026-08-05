/**
 * MOVED to `@traycer-clients/shared/host-client/action-tracker` when the
 * Teams tab needed owner actions from a user session.
 *
 * Re-exported so no call site here moved, and its tests continue to exercise
 * the shared implementation — which is what verifies the move.
 */
export {
  ActionTracker,
  type ActionOutcome,
  type ChatSnapshotView,
  type SettledCheck,
} from "@traycer-clients/shared/host-client/action-tracker";
