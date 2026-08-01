/**
 * The screenshot harness's bundle entry — SEPARATE from `cards.ts` on purpose.
 *
 * The fixtures were briefly re-exported from `cards.ts` so the harness could
 * reach them through the bundle it already imported. That worked, and it also
 * meant `bot.cjs` — the thing that actually ships and runs in front of users —
 * carried eight fake agents in it forever.
 *
 * A test fixture inside a production bundle is dead weight at best, and at
 * worst it is invented data one import away from a real code path. So the
 * harness gets its own entry: it re-exports the card builders and the
 * fixtures, and nothing in `src/index.ts`'s graph ever reaches this file.
 */
export * from "../cards";
export { SHOOT_AGENTS } from "./shoot-agents";
