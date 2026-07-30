import { CardFactory } from "@microsoft/agents-hosting";
import type { Attachment } from "@microsoft/agents-activity";
import type { RefusalReason } from "@traycer-clients/shared/identity-registry/types";
import type {
  ActionOutcome,
  AgentSummary,
  ChatStatus,
  EpicSummary,
  PendingApproval,
  PendingInterview,
} from "./bridge-types";
import type { BridgeCliFailureReason } from "./bridge-cli";

/**
 * Adaptive Card builders.
 *
 * STYLING RULE, corrected. The earlier version of this file said "no
 * theming (Fluent comes from the Teams host; hand-styling would break it)"
 * and then used nothing but plain `TextBlock`s. That over-applied a good
 * rule into blandness: 55 agents rendered as 110 undifferentiated grey
 * lines with `active` and `idle` visually identical.
 *
 * The rule that is actually correct:
 *   - NEVER hand-pick hex colours, fonts, or sizes. Those fight the host
 *     theme and break light/dark/high-contrast.
 *   - DO use the schema's own SEMANTIC tokens — `color: good|warning|
 *     attention`, `Container.style`, `separator`, `spacing`, `weight`,
 *     `size`, `isSubtle`, `FactSet`. These are host-themed by definition;
 *     using them is how you GET Fluent, not how you break it.
 * There is not one hex value or font name in this file, by design.
 *
 * RESPONSIVE BY CONSTRUCTION, not by `targetWidth`. `targetWidth` is
 * ignored on Teams iOS and is reported (unconfirmed by Microsoft) to render
 * both branches at once, i.e. duplicated content on a phone — worse than
 * omitting it. So instead: reflowing `ColumnSet`, `wrap: true` on anything
 * that can overflow, short labels, no fixed wide layouts.
 */

const ADAPTIVE_CARD_SCHEMA =
  "http://adaptivecards.io/schemas/adaptive-card.json";
/**
 * 1.5 gives us `Container.style`, `FactSet`, `separator` and `selectAction`,
 * all of which render on desktop and web.
 *
 * DOCUMENTED CONSTRAINT, not a settled verification: Microsoft's docs state
 * Teams **mobile** supports Adaptive Cards only up to **1.2**, so this pin
 * is above that cap and mobile rendering is UNVERIFIED. The failure
 * signature to look for is the card rendering as "We're sorry, this card
 * couldn't be displayed." Desktop-first was an explicit user decision; do
 * not claim mobile works, and do not redesign for 1.2 until someone has
 * actually looked at a phone.
 */
const ADAPTIVE_CARD_VERSION = "1.5";

/**
 * Verbs carried in action `data` so the handler routes on a field rather
 * than parsing button titles.
 */
export const APPROVE_VERB = "traycer/approve";
export const REJECT_VERB = "traycer/reject";
export const OPEN_CHAT_VERB = "traycer/openChat";

/**
 * `Action.Submit`, NOT `Action.Execute` — deliberate, and the reasoning is
 * load-bearing enough to record here.
 *
 * `Action.Execute` (Universal Actions) is the "better" choice on paper: it
 * supports per-user in-place card refresh, so a resolved approval updates
 * rather than leaving live buttons. But it is **broken on Teams iOS and
 * Android**, and it fails in the worst possible way — the button renders,
 * the user taps it, and **no invoke is ever sent to the bot**. No error, no
 * toast, nothing in our logs. A button that lies.
 * (microsoft/AdaptiveCards#9315, MicrosoftDocs/msteams-docs#13924.)
 *
 * `Action.Submit` works on every surface. The cost is no in-place refresh,
 * so the pressed card keeps its buttons. That is mitigated, not ignored:
 *   - the bot immediately posts an outcome card saying what happened, so the
 *     result is never ambiguous, and
 *   - the host itself dedupes a repeated decision (measured during the
 *     bridge's work: a duplicate action acks `accepted` and applies once),
 *     so a double-press cannot double-apply.
 * A working button with a follow-up message beats a prettier button that
 * silently does nothing on half our surfaces.
 */
function submitAction(
  title: string,
  verb: string,
  data: Readonly<Record<string, string>>,
  options: {
    readonly associateInputs: boolean;
    /**
     * `positive` / `destructive` are reported unsupported in Teams — but
     * they are valid schema and an unsupported value degrades to a normal
     * button rather than breaking the card, so setting it is free upside.
     * Crucially it is NOT the only thing distinguishing Approve from
     * Reject: the titles are explicit words, so a host that ignores the
     * style still leaves an unambiguous pair. Colour alone would have been
     * a misclick risk on a destructive action.
     */
    readonly style?: "positive" | "destructive";
  },
): unknown {
  return {
    type: "Action.Submit",
    title,
    data: { ...data, verb },
    ...(options.associateInputs ? { associatedInputs: "auto" } : {}),
    ...(options.style === undefined ? {} : { style: options.style }),
  };
}

function buildCard(
  body: readonly unknown[],
  actions: readonly unknown[],
): Attachment {
  return CardFactory.adaptiveCard({
    $schema: ADAPTIVE_CARD_SCHEMA,
    type: "AdaptiveCard",
    version: ADAPTIVE_CARD_VERSION,
    body,
    ...(actions.length > 0 ? { actions } : {}),
  });
}

const card = (body: readonly unknown[]): Attachment => buildCard(body, []);

type SemanticColor = "default" | "good" | "warning" | "attention" | "accent";
type ContainerStyle = "default" | "emphasis" | "good" | "warning" | "attention";

interface TextOptions {
  readonly weight: "bolder" | "default";
  readonly size: "small" | "default" | "medium" | "large";
  readonly color: SemanticColor;
  readonly isSubtle: boolean;
  readonly wrap: boolean;
  readonly spacing: "none" | "small" | "default" | "medium";
  readonly separator: boolean;
  /**
   * `monospace` is a first-class TextBlock property since Adaptive Cards 1.2
   * and is honoured by Teams. It is NOT markdown — which matters, because
   * Teams' card markdown supports no preformatted text at all.
   */
  readonly fontType: "default" | "monospace";
}

const TEXT_DEFAULTS: TextOptions = {
  weight: "default",
  size: "default",
  color: "default",
  isSubtle: false,
  // `wrap: true` by default, deliberately: the old file set it in only three
  // places and long titles/descriptions were being clipped at phone width.
  // Opt OUT explicitly if you ever need single-line.
  wrap: true,
  spacing: "default",
  separator: false,
  fontType: "default",
};

function text(content: string, options: Partial<TextOptions>): unknown {
  const o: TextOptions = { ...TEXT_DEFAULTS, ...options };
  return {
    type: "TextBlock",
    text: content,
    wrap: o.wrap,
    weight: o.weight,
    size: o.size,
    color: o.color,
    isSubtle: o.isSubtle,
    spacing: o.spacing,
    separator: o.separator,
    ...(o.fontType === "monospace" ? { fontType: "monospace" } : {}),
  };
}

function container(
  items: readonly unknown[],
  options: {
    readonly style?: ContainerStyle;
    readonly separator?: boolean;
    readonly spacing?: "none" | "small" | "default" | "medium";
    readonly selectAction?: unknown;
  },
): unknown {
  return {
    type: "Container",
    items,
    ...(options.style === undefined ? {} : { style: options.style }),
    ...(options.separator === true ? { separator: true } : {}),
    ...(options.spacing === undefined ? {} : { spacing: options.spacing }),
    ...(options.selectAction === undefined
      ? {}
      : { selectAction: options.selectAction }),
  };
}

/** `FactSet` aligns and themes itself — far better than `"a · b · c"` concatenation, which wrapped mid-phrase at 320px. */
function facts(pairs: readonly (readonly [string, string])[]): unknown {
  return {
    type: "FactSet",
    facts: pairs.map(([title, value]) => ({ title, value })),
  };
}

/**
 * A one-glance status marker. Colour does the work so a long list is
 * scannable without reading every line — the single biggest fix to the
 * fleet wall.
 */
function statusBadge(
  label: string,
  color: SemanticColor,
  detail: string | null,
): unknown {
  // A separate `●` column was tried and rejected: at `width: "auto"` the
  // glyph clipped at phone width (visible in the 320px screenshot). The
  // coloured, bolded label alone carries the signal, needs no glyph, and
  // cannot clip.
  const columns: unknown[] = [
    {
      type: "Column",
      width: "auto",
      verticalContentAlignment: "center",
      items: [
        text(label, {
          size: "small",
          color,
          spacing: "none",
          weight: "bolder",
          wrap: false,
        }),
      ],
    },
  ];
  if (detail !== null) {
    columns.push({
      type: "Column",
      width: "stretch",
      verticalContentAlignment: "center",
      items: [text(detail, { isSubtle: true, size: "small", spacing: "none" })],
    });
  }
  return { type: "ColumnSet", spacing: "small", columns };
}

/** Full UUIDs wrap across two lines at 320px and carry no meaning to a reader — show a stable prefix. */
function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

/** Long fleets are truncated with an honest count rather than dumped as N uniform rows. */
const FLEET_ROW_LIMIT = 12;

/**
 * A raw UUID is not a title. `title ?? agentId` used to fall through to the
 * id, so an untitled agent rendered as
 * `d0cf1e5a-0000-4000-8000-0000000000ff` — caught in a screenshot, invisible
 * in the code. Show something a human can read, and keep a short id fragment
 * so the row is still identifiable.
 */
export function agentDisplayName(agent: AgentSummary): string {
  if (agent.title !== null && agent.title.trim().length > 0) {
    return agent.title;
  }
  const shortId = agent.agentId.slice(0, 8);
  const kind = agent.harnessId ?? agent.surface;
  return `Untitled ${kind} agent (${shortId})`;
}

export function buildFleetCard(agents: readonly AgentSummary[]): Attachment {
  if (agents.length === 0) {
    return card([
      text("Fleet", { weight: "bolder", size: "medium" }),
      text("No agents in this epic yet.", { isSubtle: true }),
    ]);
  }

  const active = agents.filter((a) => a.active).length;
  // Active first: with 55 agents the interesting rows must be at the top,
  // because the tail is what gets truncated. Stable within each group so the
  // order doesn't churn between refreshes.
  const sorted = [...agents].sort(
    (a, b) => Number(b.active) - Number(a.active),
  );
  const shown = sorted.slice(0, FLEET_ROW_LIMIT);

  const header = [
    text("Fleet", { weight: "bolder", size: "medium", spacing: "none" }),
    text(
      `${String(agents.length)} agent${agents.length === 1 ? "" : "s"} · ${String(active)} active`,
      { isSubtle: true, size: "small", spacing: "none" },
    ),
  ];

  const rows = shown.map((agent) =>
    container(
      [
        text(agentDisplayName(agent), {
          weight: "bolder",
          spacing: "none",
        }),
        statusBadge(
          agent.active ? "Active" : "Idle",
          agent.active ? "good" : "default",
          `${agent.harnessId ?? "unknown"} · ${agent.surface}`,
        ),
      ],
      {
        style: agent.active ? "emphasis" : "default",
        separator: true,
        spacing: "small",
        // Whole row tappable — the natural gesture is "tap the agent to see it".
        selectAction: submitAction(
          agentDisplayName(agent),
          OPEN_CHAT_VERB,
          { chatId: agent.agentId },
          { associateInputs: false },
        ),
      },
    ),
  );

  const overflow =
    agents.length > FLEET_ROW_LIMIT
      ? [
          text(
            `+${String(agents.length - FLEET_ROW_LIMIT)} more not shown — use "chat <id>" for a specific one.`,
            { isSubtle: true, size: "small", separator: true },
          ),
        ]
      : [];

  return card([...header, ...rows, ...overflow]);
}

function runStatusColor(runStatus: ChatStatus["runStatus"]): SemanticColor {
  switch (runStatus) {
    case "running":
      return "good";
    case "stopping":
      return "warning";
    case "idle":
      return "default";
  }
}

/**
 * CONTRACT, unchanged and still enforced by a test: when `connected` is
 * `false` every other field may be stale, so this returns a visibly
 * different card and never renders the live view. Now a `warning`-styled
 * Container rather than a bold line with an emoji.
 */
export function buildChatCard(status: ChatStatus, epicId: string): Attachment {
  if (!status.connected) {
    return card([
      container(
        [
          text("Host unreachable", { weight: "bolder", color: "warning" }),
          text(
            "The status below could not be refreshed, so it is not shown. Try again shortly.",
            { isSubtle: true, spacing: "small" },
          ),
        ],
        { style: "warning" },
      ),
      text(status.title ?? status.chatId, {
        weight: "bolder",
        separator: true,
      }),
    ]);
  }

  const approvals = status.pendingApprovals;
  const interviews = status.pendingInterviews;
  const needsAttention = approvals.length > 0 || interviews.length > 0;

  // Header is ALWAYS `emphasis`, never `attention`. An `attention`-styled
  // (error-red) container wrapping a green "Running" badge reads as
  // self-contradictory — is it fine or is it broken? The needs-input signal
  // belongs on the block that actually describes what is pending, below.
  const body: unknown[] = [
    container(
      [
        text(status.title ?? shortId(status.chatId), {
          weight: "bolder",
          size: "medium",
          spacing: "none",
        }),
        statusBadge(
          status.runStatus === "running"
            ? "Running"
            : status.runStatus === "stopping"
              ? "Stopping"
              : "Idle",
          runStatusColor(status.runStatus),
          null,
        ),
      ],
      { style: "emphasis" },
    ),
  ];

  // Name WHAT is pending, not just how many. A FactSet reading
  // "Pending approvals: 1" tells the user nothing about what they would be
  // approving, so they have to go and look — which defeats the point of the
  // card. Caught by a failing test after a FactSet refactor dropped the
  // tool name; the fix is to restore the information, not relax the test.
  if (approvals.length > 0) {
    const first = approvals[0];
    const more = approvals.length - 1;
    body.push(
      container(
        [
          text(
            more > 0
              ? `Waiting on you: ${first.toolName} (+${String(more)} more)`
              : `Waiting on you: ${first.toolName}`,
            { weight: "bolder", color: "attention", spacing: "none" },
          ),
          text(summariseDescription(first.description), { spacing: "small" }),
        ],
        { style: "attention", separator: true },
      ),
    );
  }

  if (interviews.length > 0) {
    body.push(
      container(
        [
          text(
            interviews.length === 1
              ? "An interview is waiting for an answer"
              : `${String(interviews.length)} interviews waiting for answers`,
            { weight: "bolder", color: "attention", spacing: "none" },
          ),
        ],
        { style: "attention", separator: true },
      ),
    );
  }

  if (!needsAttention) {
    body.push(
      text("Nothing waiting on you.", {
        isSubtle: true,
        size: "small",
        separator: true,
      }),
    );
  }

  // Epic context: an approval is a decision prompt, and with several epics
  // in play "approve this" is ambiguous without saying approve-it-in-what.
  body.push(
    facts([
      ["Epic", shortId(epicId)],
      ["Chat", shortId(status.chatId)],
    ]),
  );
  return card(body);
}

/**
 * Renders AGENT-AUTHORED description text, which is the one string on these
 * cards this bot does not control the shape of. Agents write diffs, patches
 * and fenced code into it routinely.
 *
 * Why this exists: Teams' Adaptive Card markdown supports no preformatted
 * text, no headers, no tables and no blockquotes. A fenced block handed
 * straight to a `TextBlock` renders its ``` delimiters as literal characters
 * in proportional type — the diff is still readable-ish, but it looks broken,
 * and alignment (the entire point of a diff) is gone.
 *
 * So the constructs Teams cannot render are taken OUT of markdown's hands
 * before it ever sees them, and rendered with real card properties instead:
 *
 *   fenced code   -> `fontType: "monospace"` TextBlocks in an `emphasis`
 *                    container. Alignment survives; the ``` never shows.
 *   pipe tables   -> the same monospace treatment. Markdown collapses a
 *                    table's newlines into ONE paragraph, so the pipes and
 *                    `---` run together into unreadable soup; monospace keeps
 *                    the rows on their own lines and the columns lined up.
 *   headings      -> a bolder TextBlock, without the leading `#`.
 *   blockquotes   -> subtle text without the leading `>`.
 *
 * Everything between those runs stays markdown, so bold, italic, lists and
 * links — which Teams DOES support — still work.
 */

/** Longest line an unwrapped monospace block can hold at phone width. */
const CODE_LINE_LIMIT = 42;
/** Lines beyond this are dropped with a count, rather than eating the card. */
const CODE_BLOCK_MAX_LINES = 14;

function codeBlock(source: string): unknown {
  const lines = source.replace(/\n+$/, "").split("\n");
  const kept = lines.slice(0, CODE_BLOCK_MAX_LINES).map((line) =>
    // Truncated rather than wrapped: a wrapped diff line is misleading in a
    // way a visibly cut one is not.
    line.length > CODE_LINE_LIMIT
      ? `${line.slice(0, CODE_LINE_LIMIT - 1)}…`
      : line,
  );
  const items: unknown[] = kept.map((line, i) =>
    text(line === "" ? " " : line, {
      fontType: "monospace",
      size: "small",
      wrap: false,
      spacing: i === 0 ? "none" : "none",
    }),
  );
  if (lines.length > CODE_BLOCK_MAX_LINES) {
    items.push(
      text(`… ${String(lines.length - CODE_BLOCK_MAX_LINES)} more lines`, {
        size: "small",
        isSubtle: true,
        spacing: "small",
      }),
    );
  }
  return container(items, { style: "emphasis", spacing: "small" });
}

/** Longest one-line summary before it stops being a summary. */
const SUMMARY_LIMIT = 160;

/**
 * The chat card is a summary, so it gets ONE line — the first line that is
 * actually prose. Fence delimiters, headings and blockquote markers are
 * skipped rather than shown, because a summary reading "```ts" is worse than
 * useless. The full text is on the approval card below it.
 */
export function summariseDescription(description: string): string {
  const lines = description.split("\n");
  let inFence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    // Table rows are skipped too: "| File | Change |" is a header, not a
    // description of what is being approved.
    if (inFence || line.length === 0 || line.startsWith("|")) continue;
    const cleaned = stripInlineCode(line.replace(/^[#>\s]+/, "")).trim();
    if (cleaned.length === 0) continue;
    return cleaned.length > SUMMARY_LIMIT
      ? `${cleaned.slice(0, SUMMARY_LIMIT - 1)}…`
      : cleaned;
  }
  return "(no description provided)";
}

/** A markdown table row: starts with `|` and has at least one more. */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.indexOf("|", 1) !== -1;
}

/**
 * Teams strips inline backticks to nothing useful — they render as literal
 * ` characters. Dropping them reads better than showing them, and the
 * monospace treatment above already covers the case that actually matters.
 */
function stripInlineCode(prose: string): string {
  return prose.replace(/`([^`\n]+)`/g, "$1");
}

export function describeApproval(description: string): unknown[] {
  const blocks: unknown[] = [];
  let prose: string[] = [];

  const flushProse = (): void => {
    const joined = prose.join("\n").trim();
    prose = [];
    if (joined.length > 0) {
      blocks.push(text(stripInlineCode(joined), { spacing: "medium" }));
    }
  };

  const lines = description.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushProse();
      const body: string[] = [];
      i++;
      // An UNCLOSED fence is common in truncated agent output; running to the
      // end of the string is the sane reading, not discarding the block.
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      blocks.push(codeBlock(body.join("\n")));
      continue;
    }

    if (isTableRow(trimmed)) {
      flushProse();
      const rows: string[] = [];
      while (i < lines.length && isTableRow(lines[i].trim())) {
        rows.push(lines[i].trim());
        i++;
      }
      i--;
      blocks.push(codeBlock(rows.join("\n")));
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      flushProse();
      blocks.push(
        text(stripInlineCode(heading[1]), {
          weight: "bolder",
          spacing: "medium",
        }),
      );
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote !== null) {
      flushProse();
      blocks.push(
        text(stripInlineCode(quote[1]), { isSubtle: true, spacing: "small" }),
      );
      continue;
    }

    prose.push(line);
  }
  flushProse();

  // A description that is nothing but whitespace would otherwise render an
  // empty gap where the reason for the approval should be.
  if (blocks.length === 0) {
    blocks.push(
      text("(no description provided)", { isSubtle: true, spacing: "medium" }),
    );
  }
  return blocks;
}

function approvalAgeLabel(requestedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - requestedAt) / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  return `${String(Math.round(minutes / 60))}h ago`;
}

/**
 * Which chat a card belongs to, in the two forms a human and a machine each
 * need: the title is what the reader recognises, the id is what the action
 * payload carries. A short id alone reads as noise — `a1000000…` names
 * nothing — so both travel together.
 */
export interface ChatRef {
  readonly chatId: string;
  readonly title: string | null;
}

/** The title if there is one, else a short id — never a bare 36-char UUID. */
function chatLabel(chat: ChatRef): string {
  const title = chat.title?.trim() ?? "";
  return title.length > 0 ? title : shortId(chat.chatId);
}

/**
 * One pending approval, actionable. `attention`-styled because a blocked
 * agent is the thing the user most needs to see, and the reason the product
 * exists.
 */
export function buildApprovalCard(
  chat: ChatRef,
  epicId: string,
  approval: PendingApproval,
  now: number,
): Attachment {
  const chatId = chat.chatId;
  return buildCard(
    [
      container(
        [
          text("Approval needed", {
            weight: "bolder",
            color: "attention",
            spacing: "none",
          }),
          text(approval.toolName, {
            weight: "bolder",
            size: "medium",
            spacing: "small",
          }),
        ],
        { style: "attention" },
      ),
      ...describeApproval(approval.description),
      facts([
        ["Requested", approvalAgeLabel(approval.requestedAt, now)],
        ["Chat", chatLabel(chat)],
        ["Epic", shortId(epicId)],
      ]),
      {
        type: "Input.Text",
        id: "rejectReason",
        label: "Reason (optional — sent to the agent if you reject)",
        isMultiline: true,
        // Keep it short so the card stays compact at phone width.
        maxLength: 400,
      },
    ],
    [
      submitAction(
        "Approve",
        APPROVE_VERB,
        { approvalId: approval.approvalId, chatId },
        { associateInputs: false, style: "positive" },
      ),
      submitAction(
        "Reject",
        REJECT_VERB,
        { approvalId: approval.approvalId, chatId },
        { associateInputs: true, style: "destructive" },
      ),
    ],
  );
}

/** A pending interview, surfaced so it isn't invisible. Answering it is not built yet, and this says so rather than implying it is. */
export function buildInterviewCard(
  chat: ChatRef,
  epicId: string,
  interview: PendingInterview,
  now: number,
): Attachment {
  return card([
    container(
      [
        text("Interview waiting", {
          weight: "bolder",
          color: "attention",
          spacing: "none",
        }),
      ],
      { style: "attention" },
    ),
    text("The agent is waiting on an answer to continue.", {
      spacing: "medium",
    }),
    facts([
      ["Asked", approvalAgeLabel(interview.requestedAt, now)],
      ["Block", shortId(interview.blockId)],
      ["Chat", chatLabel(chat)],
      ["Epic", shortId(epicId)],
    ]),
    text("Answering interviews from Teams isn't built yet.", {
      isSubtle: true,
      size: "small",
      separator: true,
    }),
  ]);
}

/**
 * Replaces nothing — posted as a follow-up, because `Action.Submit` cannot
 * refresh the card in place (see {@link submitAction}). So this must be
 * unambiguous on its own.
 *
 * `failed` means UNCONFIRMED, not "did not happen": the action may have
 * landed with no way for this process to know. Saying "didn't work" would
 * invite a second press, so it says exactly what it knows and points at
 * re-checking rather than retrying.
 */
export function buildActionOutcomeCard(
  outcome: ActionOutcome,
  decision: "approve" | "reject",
): Attachment {
  const verb = decision === "approve" ? "Approved" : "Rejected";
  switch (outcome.kind) {
    case "applied":
      return card([
        container(
          [
            text(verb, { weight: "bolder", color: "good", spacing: "none" }),
            text("The agent has been told and should continue.", {
              isSubtle: true,
              spacing: "small",
            }),
          ],
          { style: "good" },
        ),
      ]);
    case "rejected":
      return card([
        container(
          [
            text("The host declined this decision", {
              weight: "bolder",
              color: "warning",
              spacing: "none",
            }),
            text(outcome.reason ?? "No reason given.", { spacing: "small" }),
          ],
          { style: "warning" },
        ),
        ...(outcome.code === null ? [] : [facts([["Code", outcome.code]])]),
      ]);
    case "failed":
      return card([
        container(
          [
            text("Couldn't confirm this decision", {
              weight: "bolder",
              color: "attention",
              spacing: "none",
            }),
            text(outcome.reason, { spacing: "small" }),
          ],
          { style: "attention" },
        ),
        text(
          'It may or may not have been applied. Check with "chat <id>" before deciding again rather than pressing again.',
          { isSubtle: true, size: "small", spacing: "medium" },
        ),
      ]);
  }
}

/**
 * Deliberately does NOT advertise `epics` — the bridge has no such command,
 * and the user hit "unknown command 'epics'" three times because this card
 * listed it. Re-add the line in the same change that implements it.
 */
export function buildHelpCard(): Attachment {
  return card([
    text("Traycer Remote", { weight: "bolder", size: "medium" }),
    text("Answer a blocked agent, or check what your fleet is doing.", {
      isSubtle: true,
      size: "small",
      spacing: "none",
    }),
    container(
      [
        facts([
          ["fleet", "agents in the current epic"],
          ["chat <id>", "one chat's status, with any approvals"],
          ["epic <id>", "switch this chat to another epic"],
        ]),
      ],
      { style: "emphasis", separator: true },
    ),
  ]);
}

export function buildEpicPickerCard(epics: readonly EpicSummary[]): Attachment {
  if (epics.length === 0) {
    return card([text("No epics found for your account.", { isSubtle: true })]);
  }
  return card([
    text("Pick an epic", { weight: "bolder", size: "medium" }),
    ...epics.map((epic) =>
      container(
        [
          text(epic.title ?? epic.epicId, {
            weight: "bolder",
            spacing: "none",
          }),
          text(`epic ${epic.epicId}`, {
            isSubtle: true,
            size: "small",
            spacing: "none",
          }),
        ],
        { separator: true, spacing: "small" },
      ),
    ),
  ]);
}

export function buildEpicNotBoundCard(): Attachment {
  return card([
    container(
      [
        text("No epic selected", { weight: "bolder", spacing: "none" }),
        text('Use "epic <id>" to choose one, then "fleet" to see its agents.', {
          isSubtle: true,
          spacing: "small",
        }),
      ],
      { style: "emphasis" },
    ),
  ]);
}

export function buildEpicBoundCard(epicId: string): Attachment {
  return card([
    container(
      [
        text("Epic selected", {
          weight: "bolder",
          color: "good",
          spacing: "none",
        }),
        text(epicId, { isSubtle: true, size: "small", spacing: "small" }),
      ],
      { style: "good" },
    ),
    text('Reply "fleet" to see its agents.', {
      isSubtle: true,
      size: "small",
    }),
  ]);
}

export function buildPrincipalRefusedCard(reason: RefusalReason): Attachment {
  return card([
    container(
      [
        text("Access denied", {
          weight: "bolder",
          color: "attention",
          spacing: "none",
        }),
        text("Your account isn't mapped to a Traycer host.", {
          spacing: "small",
        }),
      ],
      { style: "attention" },
    ),
    facts([["Reason", reason]]),
  ]);
}

export function buildBridgeUnavailableCard(
  reason: BridgeCliFailureReason,
  detail: string,
): Attachment {
  return card([
    container(
      [
        text("Couldn't reach your Traycer host", {
          weight: "bolder",
          color: "warning",
          spacing: "none",
        }),
        text("Nothing was changed. Try again shortly.", {
          isSubtle: true,
          spacing: "small",
        }),
      ],
      { style: "warning" },
    ),
    facts([["Reason", reason]]),
    text(detail, { isSubtle: true, size: "small", wrap: true }),
  ]);
}

/** A recognised command used wrongly — says what was expected instead of silently showing help. */
export function buildUsageCard(usage: string): Attachment {
  return card([
    container(
      [
        text("Not quite", { weight: "bolder", spacing: "none" }),
        text(usage, { spacing: "small" }),
      ],
      { style: "emphasis" },
    ),
    text('Type "help" for all commands.', {
      isSubtle: true,
      size: "small",
    }),
  ]);
}

/** Shown when no verified principal could be obtained. A refusal, not a degraded mode. */
export function buildIdentityUnavailableCard(reason: string): Attachment {
  return card([
    container(
      [
        text("Couldn't verify who you are", {
          weight: "bolder",
          color: "attention",
          spacing: "none",
        }),
        text(reason, { spacing: "small" }),
      ],
      { style: "attention" },
    ),
  ]);
}
