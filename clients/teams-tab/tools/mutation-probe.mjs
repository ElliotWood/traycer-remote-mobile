/**
 * Does the tab's suite MEASURE anything?
 *
 * A passing suite proves nothing on its own — this epic has repeatedly
 * produced checks that report success while measuring nothing, and a test
 * written from the same reading of the source as the code it covers can agree
 * with a bug. So each entry below breaks one load-bearing behaviour in the
 * source and asserts that a specific test file goes RED. A mutation that
 * survives is a hole in the suite, not a curiosity.
 *
 * Literal string replacement, never regex, because the mutations contain
 * regex metacharacters and a silently-unapplied patch would report "NOT
 * CAUGHT" for a mutation that was never made — a false alarm indistinguishable
 * from a real one. Each patch asserts it changed the file.
 *
 * Run from `clients/teams-tab`, under node (not bun — vitest breaks zod's ESM
 * resolution under bun's runtime):
 *
 *   node tools/mutation-probe.mjs
 *
 * Each file is restored from the bytes read immediately before the patch, and
 * the restore is verified before moving on, so uncommitted work survives and a
 * crash mid-run leaves at most one file to fix by hand.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TAB = resolve(import.meta.dirname, "..");
const VITEST = resolve(TAB, "..", "..", "node_modules/vitest/vitest.mjs");

/** @type {{label: string, file: string, from: string, to: string, test: string}[]} */
const MUTATIONS = [
  {
    label: "route: a dangling /chats becomes a chat with an empty id",
    file: "src/router/route.ts",
    from: 'if (segments[2] === "chats" && typeof segments[3] === "string") {',
    to: 'if (segments[2] === "chats") {',
    test: "src/router/__tests__/route.test.ts",
  },
  {
    label: "route: BASE drifts from the Vite --base",
    file: "src/router/route.ts",
    from: 'export const BASE = "/tab";',
    to: 'export const BASE = "/teams-tab";',
    test: "src/router/__tests__/base-drift.test.ts",
  },
  {
    label: "route: the nginx SPA fallback points at the wrong prefix",
    file: "deploy/vm-serve-tab.sh",
    from: 'try_files $uri $uri/ /tab/index.html;',
    to: 'try_files $uri $uri/ /index.html;',
    test: "src/router/__tests__/base-drift.test.ts",
  },
  {
    label: "route: the built bundle drops the /tab/ asset prefix",
    file: "vite.config.ts",
    from: 'base: "/tab/",',
    to: 'base: "/",',
    test: "src/router/__tests__/base-drift.test.ts",
  },
  {
    label: "action-state: unconfirmed leaves the buttons dead",
    file: "src/chat/action-state.ts",
    from: 'return phase.kind === "idle" || phase.kind === "unconfirmed";',
    to: 'return phase.kind === "idle";',
    test: "src/chat/__tests__/action-state.test.ts",
  },
  {
    label: "action-state: unconfirmed claims the action failed",
    file: "src/chat/action-state.ts",
    from: 'return "Couldn’t confirm this. It may have gone through — check the chat before deciding again.";',
    to: 'return "That didn’t happen.";',
    test: "src/chat/__tests__/action-state.test.ts",
  },
  {
    label: "action-state: a settled action re-arms the buttons",
    file: "src/chat/action-state.ts",
    from: 'return phase.kind === "idle" || phase.kind === "unconfirmed";',
    to: 'return phase.kind !== "pending";',
    test: "src/chat/__tests__/action-state.test.ts",
  },
  {
    label: "actionability: the two gates are checked in the wrong order",
    file: "src/chat/actionability.ts",
    from: 'if (access.role === "viewer") return { kind: "viewer" };\n  if (!access.canAct) return { kind: "stream-not-live" };',
    to: 'if (!access.canAct) return { kind: "stream-not-live" };\n  if (access.role === "viewer") return { kind: "viewer" };',
    test: "src/chat/__tests__/actionability.test.ts",
  },
  {
    label: "actionability: an unknown host is treated as actionable",
    file: "src/chat/actionability.ts",
    from: 'case "unknown":\n      return { kind: "unknown" };',
    to: 'case "unknown":\n      return { kind: "actionable" };',
    test: "src/chat/__tests__/actionability.test.ts",
  },
  {
    label: "actionability: other-host and unknown collapse onto one sentence",
    file: "src/chat/actionability.ts",
    from: '    case "unknown":\n      return "We can’t tell which machine this agent runs on yet, so approving from here might not reach it. Try again in a moment.";',
    to: '    case "unknown":\n      return "This agent runs on another machine, so it can’t be approved from here. Open it on that host, or from Traycer on your desktop.";',
    test: "src/chat/__tests__/actionability.test.ts",
  },
  {
    label: "authoring: a whitespace-only host id is accepted as a host",
    file: "src/authoring/authoring-scope.ts",
    from: "if (configuredHostId.trim().length === 0) {",
    to: "if (configuredHostId.length === 0) {",
    test: "src/authoring/__tests__/authoring-scope.test.ts",
  },
  {
    label: "authoring: an unconfigured build is allowed to create anyway",
    file: "src/authoring/authoring-scope.ts",
    from: "      hostId: null,\n      canCreate: false,",
    to: "      hostId: null,\n      canCreate: true,",
    test: "src/authoring/__tests__/authoring-scope.test.ts",
  },
  {
    label: "theme: high contrast is mapped onto the dark theme",
    file: "src/theme/teams-theme.ts",
    from: "return teamsHighContrastTheme;",
    to: "return teamsDarkTheme;",
    test: "src/theme/__tests__/teams-theme.test.ts",
  },
  {
    label: "theme: an unknown theme name falls into high contrast",
    file: "src/theme/teams-theme.ts",
    from: '  return "default";',
    to: '  return "contrast";',
    test: "src/theme/__tests__/teams-theme.test.ts",
  },
  {
    label: "fleet time: the future-timestamp clamp is dropped",
    file: "src/fleet/fleet-grid.tsx",
    from: "Math.max(0, Math.round((now - at) / 1000))",
    to: "Math.round((now - at) / 1000)",
    test: "src/fleet/__tests__/fleet-time.test.ts",
    all: true,
  },
  {
    label: "fleet time: an absent timestamp renders as a real time",
    file: "src/fleet/fleet-grid.tsx",
    from: '  if (at === null) return "—";\n  const seconds',
    to: '  if (at === null) return "now";\n  const seconds',
    test: "src/fleet/__tests__/fleet-time.test.ts",
    all: true,
  },
  {
    label: "config: a relative authn base URL is accepted",
    file: "src/config.ts",
    from: "} else if (!/^https?:",
    to: "} else if (false && !/^https?:",
    test: "src/__tests__/config.test.ts",
  },
  {
    label: "config: a missing host id is not reported",
    file: "src/config.ts",
    from: 'if (CONFIGURED_HOST_ID === "") {',
    to: "if (false) {",
    test: "src/__tests__/config.test.ts",
  },
  {
    label: "connection: locality is judged against the local UI label",
    file: "src/host/connection.ts",
    from: "return hostId !== CONFIGURED_HOST_ID;",
    to: "return hostId !== TAB_HOST_LABEL;",
    test: "src/host/__tests__/connection.test.ts",
  },
  {
    label: "connection: an unreplicated hostId is reported as foreign",
    file: "src/host/connection.ts",
    from: "if (hostId === null) return false;",
    to: "if (hostId === null) return true;",
    test: "src/host/__tests__/connection.test.ts",
  },
  {
    label: "fleet: an unsendable agent is reported as idle",
    file: "src/fleet/fleet-types.ts",
    from: 'if (!agent.capabilities.sendMessage) return "remote";',
    to: "",
    test: "src/fleet/__tests__/fleet-types.test.ts",
  },
];

/**
 * Restores from the bytes read a moment ago, NOT via `git checkout`.
 *
 * `git checkout --` would reset the file to HEAD, silently discarding any
 * uncommitted work in it — and two of the files this probe mutates
 * (`vite.config.ts`, `vitest.config.ts`) are exactly the ones a person is
 * likely to be editing when they reach for this tool.
 */
const restore = (path, before) => writeFileSync(path, before);

let survived = 0;
for (const m of MUTATIONS) {
  const path = resolve(TAB, m.file);
  const before = readFileSync(path, "utf8");
  if (!before.includes(m.from)) {
    console.log(`SKIPPED  (source moved)  ${m.label}`);
    survived += 1;
    continue;
  }
  const after = m.all
    ? before.split(m.from).join(m.to)
    : before.replace(m.from, m.to);
  writeFileSync(path, after);
  const run = spawnSync(process.execPath, [VITEST, "run", m.test], {
    cwd: TAB,
    stdio: "ignore",
  });
  restore(path, before);
  if (readFileSync(path, "utf8") !== before) {
    throw new Error(`failed to restore ${m.file} — fix the tree by hand`);
  }
  if (run.status === 0) {
    console.log(`SURVIVED                 ${m.label}`);
    survived += 1;
  } else {
    console.log(`caught                   ${m.label}`);
  }
}

console.log(
  `\n${String(MUTATIONS.length - survived)}/${String(MUTATIONS.length)} mutations caught.`,
);
process.exit(survived === 0 ? 0 : 1);
