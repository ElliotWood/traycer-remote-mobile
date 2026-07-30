/**
 * Builds every card with realistic data and screenshots it.
 *
 * Imports the REAL card builders (via a bundled copy, since they're TS), so
 * what is screenshotted is what the bot actually sends — not a hand-written
 * approximation that could drift.
 *
 * Usage:
 *   bun x esbuild src/read-surface/cards.ts --bundle --format=esm \
 *     --platform=node --outfile=/tmp/cards.mjs \
 *     --banner:js='import{createRequire as __cr}from "node:module";const require=__cr(import.meta.url);'
 *   node tools/shoot.mjs /tmp/cards.mjs <outDir> [--dark]
 *
 * The banner is not optional: `CardFactory` pulls in `@microsoft/agents-*`,
 * which is CJS and calls `require("crypto")` at load. Without it the bundle
 * dies with `Dynamic require of "crypto" is not supported` before a single
 * card is built.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { renderCards } from "./render-cards.mjs";

const [, , bundlePath, outDir] = process.argv;
if (!bundlePath || !outDir) {
  console.error("usage: node tools/shoot.mjs <bundle.mjs> <outDir> [--dark]");
  process.exit(1);
}

// `import()` of an absolute Windows path needs a file:// URL, otherwise Node
// rejects it with ERR_UNSUPPORTED_ESM_URL_SCHEME.
const C = await import(pathToFileURL(resolve(bundlePath)).href);

// Realistic fixtures. 8 agents rather than 2: the fleet card's real problem
// only appears at length, and a real epic can have dozens.
const AGENTS = [
  {
    agentId: "a1000000-0000-4000-8000-000000000001",
    title: "Investigate flaky integration suite",
    harnessId: "claude",
    surface: "gui",
    active: true,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000002",
    title: "Review: streaming reconnect logic",
    harnessId: "claude",
    surface: "gui",
    active: false,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000003",
    title: "Research: cache invalidation strategy",
    harnessId: "claude",
    surface: "gui",
    active: false,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000004",
    title: "Migrate config loader to zod",
    harnessId: "claude",
    surface: "gui",
    active: true,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000005",
    title: "Audit: dependency licence report",
    harnessId: "codex",
    surface: "tui",
    active: false,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000006",
    title: null,
    harnessId: null,
    surface: "tui",
    active: false,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000007",
    title: "Prototype: offline draft sync",
    harnessId: "claude",
    surface: "gui",
    active: true,
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000008",
    title: "Refactor the notification queue",
    harnessId: "claude",
    surface: "gui",
    active: false,
  },
];

const APPROVAL = {
  approvalId: "ap-7f3c1e",
  toolName: "Edit",
  description:
    "Write clients/teams-bot/src/read-surface/cards.ts (+165 −4). Adds Action.Execute approval cards.",
  requestedAt: Date.now() - 90_000,
};

/**
 * Markdown-hostile fixtures. `approval.description` is AGENT-AUTHORED text
 * flowing straight into a `TextBlock`, and Teams card markdown supports no
 * headers, tables, preformatted text or blockquotes. Every fixture above is
 * clean prose, so it probes none of that — the risk has been "covered" four
 * times while measuring zero. These two make the images answer the question
 * instead of leaving it asserted.
 */
const APPROVAL_FENCED = {
  approvalId: "ap-fence1",
  toolName: "Edit",
  description:
    "Apply this patch:\n```ts\nconst x: number = 1;\nif (x > 0) { run(); }\n```\nThen run `bun test --filter cards`.",
  requestedAt: Date.now() - 30_000,
};

const APPROVAL_TABLE = {
  approvalId: "ap-table1",
  toolName: "Write",
  description:
    "# Summary\n\n| File | Change |\n| --- | --- |\n| cards.ts | +165 −4 |\n| dispatch.ts | +22 |\n\n> Blockquote: needs review before merge.",
  requestedAt: Date.now() - 45_000,
};

const STATUS_LIVE = {
  chatId: "a1000000-0000-4000-8000-000000000004",
  title: "Migrate config loader to zod",
  runStatus: "running",
  pendingApprovals: [APPROVAL],
  pendingInterviews: [{ blockId: "iv-22", requestedAt: Date.now() - 30_000 }],
  connected: true,
};

const STATUS_STALE = { ...STATUS_LIVE, connected: false };

/**
 * A real epic id, not "epic-1": the point of shooting these is to see what a
 * 36-character identifier does to a 320px card, so the fixture has to be one.
 */
const EPIC_ID = "e0000000-0000-4000-8000-0000000000e1";

const cards = [];
const failures = [];
/**
 * A builder that throws used to be logged and skipped, which meant a card
 * dropped out of the set silently and the contact sheet still looked
 * complete. Failures are collected and the run exits non-zero instead.
 */
const add = (name, fn) => {
  try {
    cards.push({ name, card: fn().content });
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};

add("01-fleet", () => C.buildFleetCard(AGENTS));
add("02-fleet-empty", () => C.buildFleetCard([]));
add("03-chat-live", () => C.buildChatCard(STATUS_LIVE, EPIC_ID));
add("04-chat-disconnected", () => C.buildChatCard(STATUS_STALE, EPIC_ID));
add("05-help", () => C.buildHelpCard());
add("06-epic-not-bound", () => C.buildEpicNotBoundCard());
add("07-access-denied", () =>
  C.buildPrincipalRefusedCard("unmapped_principal"),
);
add("08-bridge-unavailable", () =>
  C.buildBridgeUnavailableCard(
    "spawn_timed_out",
    "traycer-remote-bridge list did not exit within 20000ms",
  ),
);
add("09-epic-picker", () =>
  C.buildEpicPickerCard([
    { epicId: "e1000000-0000-4000-8000-000000000001", title: "Traycer Teams" },
    {
      epicId: "e1000000-0000-4000-8000-000000000002",
      title: "Traycer Remote (mobile)",
    },
    { epicId: "e1000000-0000-4000-8000-000000000003", title: null },
  ]),
);
const CHAT_REF = { chatId: STATUS_LIVE.chatId, title: STATUS_LIVE.title };

add("10-approval", () =>
  C.buildApprovalCard(CHAT_REF, EPIC_ID, APPROVAL, Date.now()),
);
add("11-outcome-applied", () =>
  C.buildActionOutcomeCard({ kind: "applied" }, "approve"),
);
add("12-outcome-rejected", () =>
  C.buildActionOutcomeCard(
    { kind: "rejected", reason: "not this file — see the epic", code: null },
    "reject",
  ),
);
add("13-outcome-failed", () =>
  C.buildActionOutcomeCard(
    { kind: "failed", reason: "reconcile window expired after 45s" },
    "approve",
  ),
);
add("14-usage", () =>
  C.buildUsageCard("epic <id> — select an epic for this chat"),
);
add("15-interview", () =>
  C.buildInterviewCard(
    CHAT_REF,
    EPIC_ID,
    { blockId: "iv-22", requestedAt: Date.now() - 30_000 },
    Date.now(),
  ),
);
add("16-epic-bound", () => C.buildEpicBoundCard(EPIC_ID));
add("17-identity-unavailable", () =>
  C.buildIdentityUnavailableCard("demo_identity_not_configured"),
);
add("18-chat-idle", () =>
  C.buildChatCard(
    {
      ...STATUS_LIVE,
      runStatus: "idle",
      pendingApprovals: [],
      pendingInterviews: [],
    },
    EPIC_ID,
  ),
);

// P1 send/reply. `21` is the composer as it appears standalone; `22` is the
// long-title case, since the header carries a chat title of unknown length
// and 320px is where that first hurts.
add("21-compose", () => C.buildComposeCard(CHAT_REF, EPIC_ID));
add("22-compose-long-title", () =>
  C.buildComposeCard(
    {
      chatId: STATUS_LIVE.chatId,
      title:
        "Migrate config loader to zod, read surface, approvals and the card quality pass",
    },
    EPIC_ID,
  ),
);
add("23-compose-untitled", () =>
  C.buildComposeCard({ chatId: STATUS_LIVE.chatId, title: null }, EPIC_ID),
);
add("24-message-sent", () =>
  C.buildMessageOutcomeCard({ kind: "applied" }, CHAT_REF),
);
add("25-message-unconfirmed", () =>
  C.buildMessageOutcomeCard(
    { kind: "failed", reason: "reconcile window expired after 45s" },
    CHAT_REF,
  ),
);

/**
 * A realistic transcript, NOT tidy prose. Judging paging candidates against
 * clean one-liners would flatter all three equally; the content that breaks
 * layout is a message carrying a fenced block, a message that is nothing but
 * a tool call, and a genuinely long agent answer.
 */
const T0 = Date.now() - 3_600_000;
const msg = (i, role, author, text, parts) => ({
  messageId: `m-${String(i)}`,
  role,
  author,
  timestamp: T0 + i * 240_000,
  text,
  parts: parts ?? [],
});

const TRANSCRIPT_MESSAGES = [
  msg(0, "user", "You", "Can you get the approval cards rendering properly?"),
  msg(
    1,
    "assistant",
    "claude",
    "Looking at it now. The card builds fine but the fenced block in the description renders its delimiters literally, so the diff is unreadable on a phone.",
  ),
  msg(
    2,
    "assistant",
    "claude",
    "Here's the failing case:\n```ts\nconst card = buildApprovalCard(chat, epicId, approval, now);\nexpect(card).toMatchSnapshot();\n```\nTeams card markdown supports no preformatted text at all.",
    [{ kind: "code", label: "cards.test.ts", lines: 4 }],
  ),
  msg(3, "user", "You", "Can we not just escape it?"),
  msg(
    4,
    "assistant",
    "claude",
    "Escaping doesn't help — the constraint isn't the characters, it's that Teams strips the construct. `fontType: \"monospace\"` is a card property rather than markdown, so it sidesteps the whole thing.",
  ),
  msg(5, "assistant", "claude", "", [
    { kind: "command", label: "bun test --filter cards", lines: 0 },
    { kind: "file_change", label: "cards.ts", lines: 165 },
  ]),
  msg(
    6,
    "assistant",
    "claude",
    "That works. All 104 tests pass and the diff keeps its alignment at 320px. I also caught that the table case collapses into one paragraph of run-together pipes, so tables get the same treatment.",
    [{ kind: "table", label: "coverage", lines: 4 }],
  ),
  msg(7, "user", "You", "Ship it."),
  msg(
    8,
    "assistant",
    "claude",
    "Committed. One thing worth flagging before I move on: the action styling we're using for Approve/Reject is documented as unsupported in Teams, so the colours may not appear at all. I've added a glyph and kept the ordering fixed so the distinction survives either way, but you should know the screenshots are more colourful than the product might be.",
    [{ kind: "error", label: "styling unverified", lines: 0 }],
  ),
];

const TRANSCRIPT = {
  chatId: STATUS_LIVE.chatId,
  title: STATUS_LIVE.title,
  totalCount: 214,
  offset: 0,
  messages: TRANSCRIPT_MESSAGES,
};

add("30-transcript-page1", () =>
  C.buildTranscriptCard(
    { ...TRANSCRIPT, messages: TRANSCRIPT_MESSAGES.slice(4) },
    Date.now(),
  ),
);
add("31-transcript-paged-back", () =>
  C.buildTranscriptCard(
    { ...TRANSCRIPT, offset: 40, messages: TRANSCRIPT_MESSAGES.slice(0, 5) },
    Date.now(),
  ),
);
add("32-context-strip", () => C.buildContextStripCard(TRANSCRIPT, Date.now()));
add("33-context-strip-short-chat", () =>
  C.buildContextStripCard(
    { ...TRANSCRIPT, totalCount: 3, messages: TRANSCRIPT_MESSAGES.slice(0, 3) },
    Date.now(),
  ),
);

// The two that answer the open question: what does a fenced code block / a
// markdown table actually LOOK like once Teams card markdown has refused to
// render it? These are the evidence, not the assertion.
add("19-approval-fenced-code", () =>
  C.buildApprovalCard(CHAT_REF, EPIC_ID, APPROVAL_FENCED, Date.now()),
);
add("20-approval-table-and-heading", () =>
  C.buildApprovalCard(CHAT_REF, EPIC_ID, APPROVAL_TABLE, Date.now()),
);

await renderCards(cards, outDir);

if (failures.length > 0) {
  console.error(`\n${failures.length} card(s) failed to build:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
