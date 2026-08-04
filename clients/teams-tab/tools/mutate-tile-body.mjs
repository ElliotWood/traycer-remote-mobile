#!/usr/bin/env node
/**
 * Mutation probe for the tile body switch and the chat screen's chrome.
 *
 * A PROBE, NOT A GATE. It writes to source and restores, so it is deliberately
 * unwired from CI — a gate that edits the tree is a gate that can lose work.
 * Run it by hand after touching `canvas-screen.tsx`, `chat-tile.tsx` or
 * `chat-screen.tsx`.
 *
 *   node tools/mutate-tile-body.mjs
 *
 * ─── Why this change needs a probe more than most ───
 *
 * **Half the assertions it adds are assertions of ABSENCE** — no breadcrumb,
 * no repeated title, no ProseMirror string. Absence assertions pass when the
 * component renders nothing at all, so the suite could be green because the
 * pane chrome works or because the pane renders a blank div, and those look
 * identical from the outside. The test file pairs every absence with a
 * positive assertion for that reason; MUT-3 and MUT-4 below are what argue
 * the pairing actually bites.
 *
 * The other half is the older hazard on this branch: `renderTile` was uniform
 * for eleven bundles and every kind rendered a placeholder. A chat branch that
 * silently fell back to the placeholder would look exactly like the code
 * before it — MUT-1 reproduces precisely that.
 *
 * ─── The contract ───
 *
 * Every mutation ABORTS unless its pattern matches EXACTLY ONCE. On this
 * branch three separate mutation attempts have reported green from code that
 * was never mutated. **A probe that did not run is indistinguishable from a
 * probe that passed**, so the match count is checked before anything is
 * written and a miss is a hard abort.
 *
 * Matching is LF-normalised because this tree checks out CRLF.
 *
 * Exit 0 = every mutation was caught. Exit 1 = a survivor, named.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = resolve(TAB, "..", "..", "node_modules", "vitest", "vitest.mjs");

/*
 * BOTH suites, because the change spans them: the canvas suite covers the
 * switch, the chat suite covers the chrome. Running only one would let every
 * mutation in the other file survive unseen.
 */
const SUITES = ["src/canvas/__tests__", "src/chat/__tests__"];

const CANVAS = "src/canvas/canvas-screen.tsx";
const CHAT = "src/chat/chat-screen.tsx";

/**
 * Each mutation names the specific claim it falsifies. A mutation whose
 * expected catcher is "some test somewhere" is not evidence about coverage.
 */
const MUTATIONS = [
  {
    id: "MUT-1",
    what: "the chat branch falls back to the placeholder — the pre-commit behaviour exactly",
    file: CANVAS,
    from: "    case \"chat\":\n      return (\n        <ChatTile",
    to: "    case \"chat\":\n      return (\n        <TilePlaceholderIgnored\n          tile={tile}\n          detail=\"placeholder\"\n        />\n      );\n    case \"never-taken\":\n      return (\n        <ChatTile",
    catcher: "'a chat tile renders a CHAT, not a placeholder'",
    /*
     * This mutation makes the file fail to COMPILE (`TilePlaceholderIgnored`
     * does not exist and `"never-taken"` is not a TileRef member). vitest
     * transpiles without typechecking, so the unknown component still renders
     * — as a React unknown-element error — and the suite goes red either way.
     * Recorded because a reader running tsc against a mutated tree would
     * otherwise think the probe was broken.
     */
    compileBreaks: true,
  },
  {
    id: "MUT-2",
    what: "the artifact placeholder goes back to a generic 'arrives later' message",
    file: CANVAS,
    from: "          detail=\"Artifact bodies need a Y.Doc-to-markdown step that only the mobile client has; it carries a ProseMirror stack this tab does not. Open it in Traycer for now.\"",
    to: "          detail=\"This tab is a placeholder. Tile bodies arrive with the opener.\"",
    catcher: "'an artifact tile names its actual blocker, not placeholder'",
  },
  {
    id: "MUT-3",
    what: "pane chrome draws the breadcrumb anyway — the naive 'render the screen in a pane' wiring",
    file: CHAT,
    from: "      {chrome.kind === \"screen\" ? (",
    to: "      {chrome.kind === \"screen\" || true ? (",
    catcher: "'draws NO breadcrumb'; 'draws no second breadcrumb inside the pane'",
    /*
     * `chrome.onBack` is read inside the branch and does not exist on the pane
     * member, so this too breaks tsc while running fine under vitest — it is
     * `undefined`, and an undefined onClick is legal. That is the point: the
     * defect this guards is one a type error would NOT have caught at the
     * composition, because the pane case simply never supplies the callback.
     */
    compileBreaks: true,
  },
  {
    id: "MUT-4",
    what: "the absence assertions are met by rendering nothing at all",
    file: CHAT,
    from: "      {state.kind === \"loading\" ? (",
    to: "      {true ? null : state.kind === \"loading\" ? (",
    catcher: "every `expectTheChatActuallyRendered()` pairing; the transcript test",
    /*
     * The one that argues the whole file is worth having. If this SURVIVES,
     * the absence assertions are decoration: a chat screen that renders no
     * body would satisfy "no breadcrumb" and "title not repeated" while being
     * completely broken.
     */
  },
];

function readLf(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function suiteIsGreen() {
  try {
    execFileSync(process.execPath, [VITEST, "run", ...SUITES], {
      cwd: TAB,
      stdio: "pipe",
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

console.log("baseline: running the canvas + chat suites unmutated");
if (!suiteIsGreen()) {
  console.error(
    "ABORT: the suite is RED before any mutation. A probe run from a red\n" +
      "       baseline reports every mutation as caught and means nothing.",
  );
  process.exit(1);
}
console.log("baseline green\n");

const survivors = [];
for (const mutation of MUTATIONS) {
  const path = resolve(TAB, mutation.file);
  const original = readFileSync(path, "utf8");
  const normalised = readLf(path);

  const hits = normalised.split(mutation.from).length - 1;
  if (hits !== 1) {
    console.error(
      `ABORT ${mutation.id}: pattern matched ${hits} time(s), expected exactly 1.`,
    );
    console.error(
      "       Nothing was written. A pattern that misses would otherwise\n" +
        "       print a pass about unmutated code.",
    );
    writeFileSync(path, original);
    process.exit(1);
  }

  writeFileSync(path, normalised.replace(mutation.from, mutation.to));
  const caught = !suiteIsGreen();
  writeFileSync(path, original);

  if (readFileSync(path, "utf8") !== original) {
    console.error(`ABORT ${mutation.id}: restore failed — check the tree`);
    process.exit(1);
  }

  console.log(`${caught ? "caught  " : "SURVIVED"} ${mutation.id}  ${mutation.what}`);
  if (!caught) survivors.push(mutation);
}

console.log("");
if (survivors.length === 0) {
  console.log(`${MUTATIONS.length} mutation(s), 0 survivors.`);
  console.log(
    "NOT COVERED: that a chat pane shows a real TRANSCRIPT. Every test here\n" +
      "runs with `streamConnection: null`, so the chat body proves it is a chat\n" +
      "by reporting it has no host. A real transcript in a pane needs a live\n" +
      "`chat.subscribe`, and nothing has opened one from the canvas yet —\n" +
      "there is still no opener, so no user can reach this surface at all.",
  );
} else {
  console.error(`${survivors.length} SURVIVOR(S):`);
  for (const s of survivors) {
    console.error(`  ${s.id}  ${s.what}`);
    console.error(`        expected catcher: ${s.catcher}`);
  }
}
process.exit(survivors.length === 0 ? 0 : 1);
