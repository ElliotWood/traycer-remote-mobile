/**
 * MOVED to `clients/shared/rate-limits/` (M2 item 5).
 *
 * Relocated rather than forked: the mobile composer needs the same rate-limit
 * severity rules, and two clients disagreeing about when a profile is
 * "exhausted" means one of them tells the user something false about their
 * account. A fork guarantees that drift eventually.
 *
 * This file stays as a re-export so gui-app's twelve consumers and their tests
 * import from the same path as before — the regression gate for the move is
 * those tests passing UNCHANGED. Nothing was renamed while moving.
 */
export * from "@traycer-clients/shared/rate-limits/window-severity";
