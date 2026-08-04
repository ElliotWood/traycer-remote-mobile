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
const TILE = "src/canvas/artifact-tile.tsx";

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
    what: "the artifact branch falls back to the placeholder — the pre-commit behaviour exactly",
    file: CANVAS,
    /*
     * REWRITTEN. This previously mutated the placeholder's `detail` string to
     * argue the wording was load-bearing. That placeholder is gone — a pane
     * renders a real artifact now — so the old pattern matches zero times and
     * the probe would ABORT rather than pass. Recorded because an aborting
     * probe and a passing one are easy to conflate in a scroll-back, and the
     * abort is the guard working, not the probe being broken.
     *
     * The claim worth falsifying moved with the code: not "the placeholder
     * says the right thing" but "there is no placeholder here any more".
     */
    from:
      "        <ArtifactTile\n" +
      "          entry={deps.artifactEntry(tile.id)}\n" +
      "          registry={deps.artifactRooms}\n" +
      "          listReady={deps.epicContentReady}\n" +
      "          title={tileTitle(tile)}\n" +
      "        />",
    to:
      "        <TilePlaceholder\n" +
      "          tile={tile}\n" +
      "          detail=\"Open this from the epic's Artifacts list for now.\"\n" +
      "        />",
    catcher:
      "'renders real agent-authored content from a real Y.Doc, inside a tile'; " +
      "'an artifact tile no longer sends the user somewhere else'",
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
  {
    id: "MUT-5",
    what: "the two null-entry branches are swapped — a deleted artifact spins, a slow one says it is gone",
    file: TILE,
    from: "        {listReady ? (",
    to: "        {!listReady ? (",
    catcher:
      "'before the list lands, a missing row is LOADING, not gone'; " +
      "'once the list has landed, a missing row is GONE, not loading'",
    /*
     * The mutation the `listReady` prop exists for. Both branches render
     * plausible, well-formed text, so nothing about the SHAPE of the output
     * distinguishes them — this is the "a defect that lands in a legitimate
     * state is invisible by construction" case from the parity contract,
     * arriving on a two-way branch. Only an assertion that names which
     * sentence belongs to which input can tell them apart.
     */
  },
  {
    id: "MUT-6",
    what: "the tile's body renders nothing — the absence assertions met by an empty pane",
    file: TILE,
    from: "      <ArtifactTileBody entry={entry} registry={registry} />",
    to: "      {null}",
    catcher: "'renders real agent-authored content…'; 'the pane adds no second breadcrumb and no repeated title'",
    /*
     * MUT-4's argument, one file over. "No second breadcrumb" and "the title
     * appears once" are both satisfied by a pane that renders NOTHING, so
     * without this the chrome assertions in `artifact-tile.test.tsx` would be
     * decoration. Each is paired with a positive that this mutation reddens.
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
    "NOT COVERED, and each of these is a different gap:\n" +
      "\n" +
      "1. That a chat pane shows a real TRANSCRIPT. Every test here runs with\n" +
      "   `streamConnection: null`, so the chat body proves it is a chat by\n" +
      "   reporting it has no host. A real transcript in a pane needs a live\n" +
      "   `chat.subscribe`, and nothing has opened one from the canvas yet.\n" +
      "\n" +
      "2. That the values `EpicSession` passes are CORRECT. These suites render\n" +
      "   `CanvasScreen` directly and hand it the lookups themselves, so\n" +
      "   nothing here sees the route at all. The SHAPE of that wiring is\n" +
      "   covered elsewhere — `route-dispatch-contract.test.ts` asserts one\n" +
      "   `useEpicAgents()` call site, both epic-scoped routes rendering\n" +
      "   `EpicSession`, and no `chatEntry={() => null}`, all three shown\n" +
      "   falsifiable by mutation. That is a lexical check: it proves the\n" +
      "   plumbing exists, not that the right row comes out of it. Closing the\n" +
      "   remainder needs `App` mounted with auth, config and a host stubbed —\n" +
      "   the instrument `canvas-screen.test.tsx` declines to build.\n" +
      "\n" +
      "3. That any of it works against a REAL host. A real `Y.Doc` through the\n" +
      "   real registry is the strongest fixture available in jsdom and it is\n" +
      "   still a fixture. Per parity-contract's standard this stays amber\n" +
      "   until an artifact opens in a pane in the deployed tab.",
  );
} else {
  console.error(`${survivors.length} SURVIVOR(S):`);
  for (const s of survivors) {
    console.error(`  ${s.id}  ${s.what}`);
    console.error(`        expected catcher: ${s.catcher}`);
  }
}
process.exit(survivors.length === 0 ? 0 : 1);
