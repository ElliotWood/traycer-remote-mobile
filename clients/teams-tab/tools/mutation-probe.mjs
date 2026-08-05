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
/**
 * `clients/shared`, for the entries below that break a behaviour the tab
 * depends on but does not own.
 *
 * Those need their own `pkg`, because a shared test cannot be run by the tab's
 * vitest: `vitest.config.ts` includes only `src/**\/*.test.ts` under this
 * package, so pointing a mutation at a shared test path would run ZERO tests,
 * exit 0, and be reported as SURVIVED — a mutation that was never measured,
 * indistinguishable in the output from one the suite genuinely misses. Same
 * failure shape the "literal, never regex" rule above exists to prevent.
 */
const SHARED = resolve(TAB, "..", "shared");

/** @type {{label: string, file: string, from: string, to: string, test: string, pkg?: string}[]} */
const MUTATIONS = [
  {
    // THE ONE THIS FILE EXISTS FOR, on the epic create. `use-create-epic` is a
    // near-copy of `use-create-agent`, and this word is the only difference
    // that matters. Carried across by a copy-paste it would tell someone a
    // create they could not confirm is safe to repeat.
    label: "epic create: retry advice copied from the idempotent chat create",
    file: "src/authoring/epic-create-rules.ts",
    from: 'export const EPIC_CREATE_RETRY: RetrySafety = "may-duplicate";',
    to: 'export const EPIC_CREATE_RETRY: RetrySafety = "idempotent";',
    test: "src/authoring/__tests__/epic-create-rules.test.ts",
  },
  {
    label: "epic create: a missing user id no longer blocks the create",
    file: "src/authoring/epic-create-rules.ts",
    from: 'if (input.userId.trim().length === 0) return "no-user";',
    to: "",
    test: "src/authoring/__tests__/epic-create-rules.test.ts",
  },
  {
    label: "epic create: a whitespace-only host id passes the gate",
    file: "src/authoring/epic-create-rules.ts",
    from: 'if (input.configuredHostId.trim().length === 0) return "no-host";',
    to: 'if (input.configuredHostId.length === 0) return "no-host";',
    test: "src/authoring/__tests__/epic-create-rules.test.ts",
  },
  {
    // Ordering, not presence: every gate still fires, but a tab with no host
    // configured is told to type something first — a loop that cannot
    // terminate, because the real fault is in the build.
    //
    // FIRST ATTEMPT AT THIS ENTRY SURVIVED, and the test was right. It swapped
    // `in-flight` with `no-title` — both ATTEMPT faults — and asserted a hole
    // that does not exist: the order WITHIN a group is not load-bearing (no
    // caller reads the reason yet; the hook uses it as a boolean), so nothing
    // should pin it. The property that matters is deployment-before-attempt,
    // which is what the test states and what this now breaks.
    label: "epic create: an attempt fault is reported before the deployment fault",
    file: "src/authoring/epic-create-rules.ts",
    from: '  if (!input.hasClient) return "no-client";',
    to: '  if (input.title === null) return "no-title";\n  if (!input.hasClient) return "no-client";',
    test: "src/authoring/__tests__/epic-create-rules.test.ts",
  },
  {
    pkg: SHARED,
    // The whole basis of the create being buildable from Teams at all.
    label: "shared: the epic create stops being folderless",
    file: "epic/create-epic.ts",
    from: 'export const FOLDERLESS_WORKSPACE_MODE = "folderless";',
    to: 'export const FOLDERLESS_WORKSPACE_MODE = "worktree";',
    test: "epic/__tests__/create-epic.test.ts",
  },
  {
    pkg: SHARED,
    label: "shared: a workspace path is invented for the host to bind",
    file: "epic/create-epic.ts",
    from: "    workspaces: [],",
    to: '    workspaces: [{ workspacePath: "/" }],',
    test: "epic/__tests__/create-epic.test.ts",
  },
  {
    pkg: SHARED,
    // Would remint on retry, forfeiting the only shape a host-side dedupe
    // could absorb — while the UI still says the same thing.
    label: "shared: the pending epic id is cleared after an unconfirmed create",
    file: "epic/create-epic.ts",
    from: 'return outcome.kind === "created" ? null : attemptedEpicId;',
    to: "return null;",
    test: "epic/__tests__/create-epic.test.ts",
  },
  {
    pkg: SHARED,
    // `createdBy` drives the ownership filter: the epic would exist and be
    // invisible to the person who made it.
    label: "shared: the epic is filed under the host id instead of the creator",
    file: "epic/create-epic.ts",
    from: "      createdBy: input.createdBy,",
    to: "      createdBy: input.hostId,",
    test: "epic/__tests__/create-epic.test.ts",
  },
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
  const pkg = m.pkg ?? TAB;
  const path = resolve(pkg, m.file);
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
    cwd: pkg,
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
