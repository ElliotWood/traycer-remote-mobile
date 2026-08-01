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
  Transcript,
  TranscriptMessage,
  TranscriptPart,
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
 * SETTLED EMPIRICALLY, 2026-07-31, after being wrong at 1.5.
 *
 * This block used to pin 1.5 and carried its own warning: "Microsoft's docs
 * state Teams MOBILE supports Adaptive Cards only up to 1.2, so this pin is
 * above that cap and mobile rendering is UNVERIFIED", with the failure
 * signature to watch for spelled out. We deferred on desktop-first.
 *
 * The install answered it: EVERY card rendered as "Card - access it on
 * go.skype.com/cards.unsupported" in real Teams — and on DESKTOP, not just
 * mobile. So the recorded risk was real and its scope was understated: the
 * cap is not a mobile-only concern.
 *
 * Web Chat rendered all of them correctly throughout. It is a MORE PERMISSIVE
 * client than Teams, so "verified in Web Chat" was a true measurement of the
 * wrong specimen — the same shape as timing a 4MB synthetic doc against a
 * 50.6MB real one. Do not treat Web Chat as a proxy for Teams again.
 *
 * 1.2 COSTS NOTHING. Audited every element and property this file emits:
 *
 *   AdaptiveCard, TextBlock, Container, ColumnSet, Column,
 *   FactSet, Input.Text, Action.Submit                        1.0
 *   verticalContentAlignment                                   1.1
 *   fontType: "monospace"                                      1.2
 *   Container style good / attention / warning                 1.2
 *
 * Nothing above 1.2 is used: no `targetWidth`, no `Action.Execute`, no
 * `Table`, no `RichTextBlock`, no `style: "heading"`. The version was raised
 * for features we never adopted.
 *
 * If something here ever needs 1.4, RAISE IT TO 1.4 — do not drop a feature
 * to hit a lower number. The rule is "the lowest version that renders what we
 * actually emit", not "the lowest number".
 */
const ADAPTIVE_CARD_VERSION = "1.2";

/**
 * Verbs carried in action `data` so the handler routes on a field rather
 * than parsing button titles.
 */
export const APPROVE_VERB = "traycer/approve";
export const REJECT_VERB = "traycer/reject";
export const OPEN_CHAT_VERB = "traycer/openChat";
/**
 * Verbs that replace typed commands. Each one carries the id it needs in the
 * action's `data`, so NO id is ever shown to a person or typed by one.
 *
 * `traycer/reply` deliberately does not open an inline `Action.ShowCard`
 * composer: Teams does not support `ShowCard` inside an `ActionSet`, and a
 * card that renders in our harness and not in Teams is the exact failure that
 * shipped 1.5. It round-trips to the existing composer card instead — one
 * more hop, and it works where it has to.
 */
export const REPLY_VERB = "traycer/reply";
export const LOG_VERB = "traycer/log";
export const WAITING_VERB = "traycer/waiting";
export const NEW_AGENT_VERB = "traycer/newAgent";
export const SHOW_ALL_VERB = "traycer/showAll";
export const FLEET_VERB = "traycer/fleet";
/**
 * The route the USER confirmed, carried in the button. The handler must read
 * these fields rather than re-running `classify` — see `buildClarifyCard`.
 */
export const CONFIRM_ROUTE_VERB = "traycer/confirmRoute";
export const CLARIFY_OTHER_VERB = "traycer/clarifyOther";
export const SEND_VERB = "traycer/send";

/**
 * Plain Unicode, NOT emoji: no variation selector, no colour font, no image
 * URL to host. It survives a host that drops action styling, which is the
 * whole point — see {@link submitAction}. Emoji were rejected because their
 * rendering varies by platform and they read as decorative; these read as
 * affordances.
 */
export const APPROVE_TITLE = "✓ Approve";
export const REJECT_TITLE = "✕ Reject";
export const SEND_TITLE = "➤ Send";
/**
 * ↑/↓ rather than ⌃/⌄: the arrowhead glyphs fell back to a plain caret and
 * "v" in the render, which reads as a typo. Caught in a screenshot — the
 * card JSON was correct and the font simply had no glyph.
 */
export const OLDER_TITLE = "↑ Older";
export const NEWER_TITLE = "↓ Newer";

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
     * UNVERIFIED IN TEAMS, and treated as such. Microsoft documents
     * `positive` / `destructive` as unsupported in Teams; our local renderer
     * honours them, so screenshots show a blue Approve and a red Reject that
     * Teams may render as two identical grey buttons. That is exactly the
     * schema-says-yes / Teams-says-no gap that already burned us twice, with
     * `Action.Execute` and `targetWidth`.
     *
     * It is set anyway — an unsupported value degrades to a normal button
     * rather than breaking the card, so it is free upside where it works.
     * But NOTHING is allowed to depend on it. Two identical grey buttons on
     * a destructive decision would be a genuine misclick hazard, so the
     * distinction is carried by things no host can drop:
     *   - opposite-meaning words in the titles, not colour;
     *   - a leading glyph, plain Unicode rather than an emoji or an icon
     *     URL, so it needs no image hosting and no host support;
     *   - fixed order, safe action first.
     * Do not remove any of those on the grounds that the colours make it
     * obvious. They may not exist.
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

/**
 * A row of buttons inside the card body.
 *
 * `ActionSet` is an Adaptive Cards **1.2** element, so it sits exactly at the
 * version we declare — no schema-says-yes / Teams-says-no gamble of the kind
 * that cost us the 1.5 install.
 *
 * WHY BUTTONS AT ALL, given every row already had a `selectAction`.
 *
 * A tappable Container is invisible. It has no affordance, no label, and no
 * keyboard path — so the row LOOKED like a status line and the only
 * discoverable way to act on an agent was to read its id off the screen and
 * type `say <guid> <text>`. That is the CLI-in-a-chat-window Elliot called
 * horrible, and it was one property away from not existing.
 *
 * The `selectAction` stays as the whole-row gesture. These make it visible.
 */
function actionSet(actions: readonly unknown[]): unknown {
  return { type: "ActionSet", actions, spacing: "small" };
}

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
 * "Idle" is a CLAIM, and for a remote agent we have no basis for it.
 *
 * `active` is local-only — the host's activity tracker does not replicate —
 * so it is `false` for every agent running elsewhere no matter what that
 * agent is doing. Measured against the real host: 53 of 56 agents in the
 * epic are remote, and this card was rendering every one of them as "Idle".
 *
 * That is a fleet calmly reporting nothing is happening while agents run,
 * produced without a single dishonest line of code — just a field read as
 * answering a question it does not answer. Say what we actually know.
 */
export interface AgentStatusPresentation {
  readonly label: string;
  readonly color: SemanticColor;
  readonly emphasised: boolean;
}

/**
 * Label AND styling from ONE derivation, so they cannot disagree.
 *
 * They did. The label was moved to the capability and the badge colour was
 * left on `agent.isLocal && agent.active` two lines below — so a row that
 * is remote but sendable rendered the word "Active" in grey, in a default
 * container. Text and styling contradicting each other about the same agent,
 * with no dishonest line of code, exactly like the `attention` container
 * that once wrapped a green "Running" badge.
 *
 * It survived because the two happened to agree on all 56 real rows —
 * `isLocal === sendMessage` today — which is the correlation the docblock
 * two functions up calls "the trap, not the shortcut", and which I then
 * walked into.
 *
 * A test could have caught it. Returning one object means there is nothing
 * left to catch: a caller cannot take the label from here and the colour
 * from somewhere else without deleting a field.
 */
export function agentStatusPresentation(
  agent: AgentSummary,
): AgentStatusPresentation {
  const label = agentStatusLabel(agent);
  /**
   * `good` + emphasis ONLY when activity is both OBSERVABLE and true.
   *
   * `isLocal` is the observability axis and `sendMessage` is the
   * reachability one; they are different questions and this needs the first.
   * An earlier version used `capabilities.sendMessage && agent.active`, which
   * is the same category error one axis over — it would have painted a row
   * green on the strength of an `active` flag that cannot be trusted for a
   * host we cannot see.
   */
  const running = agent.isLocal && agent.active;
  return {
    label,
    color: running ? "good" : "default",
    emphasised: running,
  };
}

export function agentStatusLabel(agent: AgentSummary): string {
  /**
   * THREE axes, deliberately not collapsed into two.
   *
   *   reachable   `capabilities.sendMessage` — can this host act on it
   *   observable  `isLocal`                  — can this host SEE it work
   *   active      `agent.active`             — meaningful ONLY if observable
   *
   * They agree on all 56 rows today, which is exactly why they are kept
   * apart: that correlation is a fact about this deployment, not about the
   * contract.
   *
   * The case that forced the third axis: an agent that is REACHABLE but not
   * OBSERVABLE. A previous version returned "Idle" for it — reading an
   * unobservable as a negative, which is the identical error to the original
   * `active: false` reading that made a fleet of 53 running agents report as
   * idle. We do not know that it is idle. We cannot see it.
   *
   * So: never claim activity we cannot observe. Say what is true instead.
   */
  const reachable = agent.capabilities.sendMessage;
  const observable = agent.isLocal;

  if (!reachable) {
    // Constraint first — that is what the user acts on. Cause second.
    return observable ? "Read-only" : "Read-only — runs on another host";
  }
  if (!observable) {
    return "Activity not visible from here";
  }
  return agent.active ? "Active" : "Idle";
}

/**
 * A raw UUID is not a title. `title ?? agentId` used to fall through to the
 * id, so an untitled agent rendered as
 * `d0cf1e5a-0000-4000-8000-0000000000ff` — caught in a screenshot, invisible
 * in the code.
 *
 * THE SHORT FRAGMENT IS DELIBERATE AND SHOULD STAY. Its original reason —
 * "so the row is still identifiable" — was written when reading the id off
 * the screen and typing `chat <id>` was the only way to act on a row. That
 * reason expired the moment rows got buttons, and a reason that has expired
 * reads as residue to whoever finds it next.
 *
 * The fragment survives for a different reason: it is the only thing
 * DISTINGUISHING two untitled agents from each other in a list. It is a
 * label, not an input — nobody transcribes it now that Reply is a button —
 * so it does not conflict with "don't make me type ids". Remove it only if
 * something else makes untitled rows tellable apart.
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

  const rows = shown.map((agent) => {
    // One derivation for label and styling — see agentStatusPresentation.
    const presentation = agentStatusPresentation(agent);
    return container(
      [
        text(agentDisplayName(agent), {
          weight: "bolder",
          spacing: "none",
        }),
        statusBadge(
          presentation.label,
          presentation.color,
          `${agent.harnessId ?? "unknown"} · ${agent.surface}`,
        ),
        // The row's actions, carrying the id so nobody has to see it.
        // `Reply` is the one that matters: it was `say <guid> <text>`.
        //
        // GATED ON `capabilities.sendMessage`, for the same reason the tab
        // gates Approve/Reject on `canAct`: offering an action this host
        // cannot perform is a promise the next tap breaks. `Activity` is
        // always offered because reading is not the same permission.
        actionSet([
          ...(agent.capabilities.sendMessage
            ? [
                submitAction("Reply", REPLY_VERB, { chatId: agent.agentId }, {
                  associateInputs: false,
                }),
              ]
            : []),
          submitAction("Activity", LOG_VERB, { chatId: agent.agentId }, {
            associateInputs: false,
          }),
        ]),
      ],
      {
        style: presentation.emphasised ? "emphasis" : "default",
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
    );
  });

  /*
   * NO "Show all", NO "Waiting on you", NO "New agent".
   *
   * All three were here, and none had a handler — pressing any of them
   * returned "Unknown card action". I removed the same button from the help
   * card and left these, which is fixing the instance rather than the class,
   * and they shipped.
   *
   * The rule this card now follows, and the reason `buildFleetCard` has a
   * test asserting it: EVERY verb a card emits must be one
   * `dispatchActionInvoke` handles. A button with no handler is the
   * `Action.Execute` failure — it renders, it is pressable, and it does
   * nothing useful.
   *
   * "+N more" is plain text again rather than a button that lies. It reads as
   * a limit, which it is, instead of an affordance that isn't.
   */
  const overflow =
    agents.length > FLEET_ROW_LIMIT
      ? [
          text(
            `+${String(agents.length - FLEET_ROW_LIMIT)} more not shown.`,
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

export const OLDER_VERB = "traycer/older";
export const NEWER_VERB = "traycer/newer";

/**
 * How a transcript message is rendered INLINE, and why it is not
 * {@link describeApproval}.
 *
 * The two cards have different jobs. An approval card shows one thing you
 * must read completely before making an irreversible decision, so full
 * fidelity is correct there — an unreadable diff means a blind approval. A
 * transcript shows many things you SCAN to orient yourself, and optimising
 * each message for complete fidelity makes the whole unreadable: one 14-line
 * monospace block already dominates a 320px card, and ten of them is not a
 * transcript, it is a wall.
 *
 * So this reuses the segmentation — which is correct and tested — and
 * changes the presentation: prose stays readable, and code, tables and tool
 * output collapse to a marker that says WHAT is there without spending the
 * height. Full fidelity is a drill-in, not an inline concern.
 *
 * One segmentation, two presentations. Deliberately not a second parser.
 */
const TRANSCRIPT_TEXT_LIMIT = 220;
/** The `chat <id>` strip's tighter cap — see `transcriptRow`'s `compact`. */
const CONTEXT_STRIP_TEXT_LIMIT = 100;

export function partMarker(part: TranscriptPart): string {
  const noun =
    part.kind === "file_change"
      ? "file"
      : part.kind === "other"
        ? "content"
        : part.kind;
  const label = part.label.trim();
  const head = label.length > 0 ? `${noun} · ${label}` : noun;
  return part.lines > 0
    ? `⟨${head} · ${String(part.lines)} lines⟩`
    : `⟨${head}⟩`;
}

/**
 * The message's prose, with fences, tables and headings taken out by the
 * SAME segmenter the approval card uses — their content is represented by
 * `parts` markers instead, which the card renders on their own line.
 *
 * Returns `""` for a message that is entirely non-prose; the caller decides
 * what to show, because "nothing to preview" reads differently depending on
 * whether there are parts to name.
 */
export function transcriptPreview(
  message: TranscriptMessage,
  compact: boolean,
): string {
  const limit = compact ? CONTEXT_STRIP_TEXT_LIMIT : TRANSCRIPT_TEXT_LIMIT;
  const prose = describeApproval(message.text)
    .map((block) => {
      // Only TOP-LEVEL TextBlocks: code and tables live inside containers,
      // so skipping non-TextBlocks is exactly what drops them from the
      // preview without a second parser.
      const b = block as { type?: string; text?: string };
      return b.type === "TextBlock" && typeof b.text === "string" ? b.text : "";
    })
    .filter((line) => line.length > 0 && line !== "(no description provided)")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return prose.length > limit ? `${prose.slice(0, limit - 1)}…` : prose;
}

/**
 * One transcript row. Shared by all three paging candidates so the
 * comparison is about PAGING, not about row design.
 *
 * The author line and the body are separate blocks rather than
 * "**Alice:** text": at 320px a bolded prefix and its message wrap into one
 * another and you lose the turn boundary, which is the one thing a
 * transcript has to make obvious.
 */
function transcriptRow(
  message: TranscriptMessage,
  now: number,
  /**
   * The `chat <id>` strip is MORE aggressive than `log <id>`: it has three
   * messages to work with and a pending decision sitting beneath it, so a
   * long agent answer there costs the approval its place above the fold.
   */
  compact: boolean,
): unknown {
  const preview = transcriptPreview(message, compact);
  const items: unknown[] = [
    text(
      `${message.author ?? (message.role === "user" ? "You" : "Agent")} · ${approvalAgeLabel(message.timestamp, now)}`,
      {
        weight: "bolder",
        size: "small",
        color: message.role === "user" ? "accent" : "default",
        isSubtle: message.role !== "user",
        spacing: "none",
      },
    ),
  ];
  if (preview.length > 0) {
    items.push(text(preview, { spacing: "small" }));
  }
  if (message.parts.length > 0) {
    // Markers on their own line: they are metadata about the message, not
    // part of its prose, and running them together reads as if the agent
    // wrote "⟨code · 24 lines⟩".
    items.push(
      text(message.parts.map(partMarker).join("  "), {
        isSubtle: true,
        size: "small",
        fontType: "monospace",
        spacing: preview.length > 0 ? "small" : "none",
      }),
    );
  }
  if (preview.length === 0 && message.parts.length === 0) {
    items.push(text("(no content)", { isSubtle: true, size: "small" }));
  }
  return container(items, {
    style: message.role === "user" ? "emphasis" : undefined,
    separator: true,
    spacing: "small",
  });
}

/** Newest-first ordering, applied at render time. */
function newestFirst(
  messages: readonly TranscriptMessage[],
): readonly TranscriptMessage[] {
  return [...messages].reverse();
}

function transcriptHeader(transcript: Transcript, shown: number): unknown {
  const { totalCount, offset } = transcript;
  const from = totalCount - offset - shown + 1;
  const to = totalCount - offset;
  return container(
    [
      text(chatLabel({ chatId: transcript.chatId, title: transcript.title }), {
        weight: "bolder",
        size: "medium",
        spacing: "none",
      }),
      text(
        totalCount <= shown
          ? `${String(totalCount)} messages`
          : `${String(Math.max(1, from))}–${String(to)} of ${String(totalCount)}`,
        { isSubtle: true, size: "small", spacing: "none" },
      ),
    ],
    { style: "emphasis" },
  );
}

/**
 * The full transcript, on `log <id>`. Chosen over the one-way variant for a
 * reason that turned out to settle it: the second control only renders once
 * `offset > 0`, so on the first page this IS the one-way card. There is no
 * cost to pay for a capability that does not appear until it is needed —
 * and without it, paging back four times leaves re-running the command as
 * the only route to the present.
 *
 * Window size is 5 rather than 9. Nine messages measured ~1050px at 320px
 * wide, which is past where Teams collapses a card behind "see more", and a
 * transcript you must expand before reading defeats the point. UNVERIFIED
 * against a real Teams client — the threshold is inferred from the render,
 * not measured in the product.
 */
export function buildTranscriptCard(
  transcript: Transcript,
  now: number,
): Attachment {
  const shown = newestFirst(transcript.messages);
  const hasOlder =
    transcript.totalCount > transcript.messages.length + transcript.offset;
  const hasNewer = transcript.offset > 0;
  const actions: unknown[] = [];
  if (hasNewer) {
    actions.push(
      submitAction(
        NEWER_TITLE,
        NEWER_VERB,
        {
          chatId: transcript.chatId,
          offset: String(
            Math.max(0, transcript.offset - transcript.messages.length),
          ),
        },
        { associateInputs: false },
      ),
    );
  }
  if (hasOlder) {
    actions.push(
      submitAction(
        OLDER_TITLE,
        OLDER_VERB,
        {
          chatId: transcript.chatId,
          offset: String(transcript.offset + transcript.messages.length),
        },
        { associateInputs: false },
      ),
    );
  }
  return buildCard(
    [
      transcriptHeader(transcript, shown.length),
      ...shown.map((m) => transcriptRow(m, now, false)),
    ],
    actions,
  );
}

/** How many messages the `chat <id>` context strip shows. */
export const CONTEXT_STRIP_SIZE = 3;
/**
 * `log <id>` window. Five rather than nine: nine measured ~1050px at 320px
 * wide, past where Teams collapses a card behind "see more", and a
 * transcript you must expand before reading defeats the point. The
 * threshold is inferred from the render and UNVERIFIED in the product.
 */
export const TRANSCRIPT_PAGE_SIZE = 5;

export const FULL_HISTORY_VERB = "traycer/history";

/**
 * The context strip on `chat <id>` — the last few messages, and nothing else.
 *
 * This was candidate C, which was the wrong answer for the transcript and is
 * the right one HERE. As the whole transcript it just restated the hole
 * politely ("211 earlier messages, not available"); as a strip above a
 * composer it is exactly the shape wanted, because compactness is the
 * requirement rather than a compromise.
 *
 * Why it exists at all: `chat <id>` already returns status, approvals,
 * interviews and a composer, and a full transcript on top would risk pushing
 * the APPROVAL behind Teams' "see more" collapse — the blocked agent hidden
 * under the history that was meant to explain it. Three messages says what
 * the agent was doing when it stopped, without moving the decision below the
 * fold. The rest is one button away.
 */
export function buildContextStripCard(
  transcript: Transcript,
  now: number,
): Attachment {
  const shown = newestFirst(transcript.messages).slice(0, CONTEXT_STRIP_SIZE);
  const remaining = Math.max(0, transcript.totalCount - shown.length);
  return buildCard(
    [
      text("Recently", {
        weight: "bolder",
        size: "small",
        isSubtle: true,
        spacing: "none",
      }),
      ...shown.map((m) => transcriptRow(m, now, true)),
    ],
    remaining > 0
      ? [
          submitAction(
            `↑ Full history (${String(remaining)} more)`,
            FULL_HISTORY_VERB,
            { chatId: transcript.chatId, offset: "0" },
            { associateInputs: false },
          ),
        ]
      : [],
  );
}

/** Matches the host's own composer cap; a longer body is a paste accident. */
export const MAX_MESSAGE_LENGTH = 4000;

export const MESSAGE_INPUT_ID = "messageText";

/**
 * The composer. Deliberately a CARD INPUT rather than "type in the Teams
 * compose box and we'll forward it", and the reason is addressing, not taste.
 *
 * A Teams conversation here is bound to an EPIC, and an epic holds many
 * chats — the fleet card routinely lists a dozen. So a bare typed message has
 * no addressee: there is no single agent it could mean. The card input
 * carries `chatId` in its own `data`, so what you are replying to is whatever
 * card you are typing into, which is both unambiguous and visible.
 *
 * The second reason is that it would be unsafe. `parseCommand` falls through
 * to the help card for anything it does not recognise; if unrecognised text
 * instead meant "send to the agent", every mistyped command (`flet`, `chta`)
 * would be delivered to a running agent, and a message to an agent cannot be
 * unsent. Making the destructive reading the DEFAULT for typos is the wrong
 * way round.
 *
 * There is still a typed path — `say <chatId> <text>` — for people who would
 * rather not hunt for a card. It is explicit about its target, which is the
 * property that matters. What does not exist, on purpose, is an implicit one.
 */
export function buildComposeCard(chat: ChatRef, epicId: string): Attachment {
  return buildCard(
    [
      container(
        [
          text("Reply to", { isSubtle: true, size: "small", spacing: "none" }),
          text(chatLabel(chat), {
            weight: "bolder",
            size: "medium",
            spacing: "none",
          }),
          // Epic sits in the header, NOT between the input and Send. A fact
          // row wedged there separates the button from the thing it acts on,
          // which reads as though it belongs to the button.
          text(`Epic ${shortId(epicId)}`, {
            isSubtle: true,
            size: "small",
            spacing: "small",
          }),
        ],
        { style: "emphasis" },
      ),
      {
        type: "Input.Text",
        id: MESSAGE_INPUT_ID,
        // No `label`: the placeholder already says what this is, and a
        // "Message" label above an obvious message box is one more line of
        // height at the width where height is scarcest.
        placeholder: "Send a message to this agent…",
        isMultiline: true,
        maxLength: MAX_MESSAGE_LENGTH,
      },
    ],
    [
      submitAction(
        SEND_TITLE,
        SEND_VERB,
        // `chatTitle` rides along so the outcome card can name the chat
        // without a second host read. It is display-only — never an identity
        // or routing signal, both of which come from `chatId` and the
        // resolved principal.
        { chatId: chat.chatId, chatTitle: chat.title ?? "" },
        // `associateInputs` is REQUIRED here, unlike on Approve: without it
        // Teams sends the action without the typed text and the message
        // arrives empty.
        { associateInputs: true, style: "positive" },
      ),
    ],
  );
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
        APPROVE_TITLE,
        APPROVE_VERB,
        { approvalId: approval.approvalId, chatId },
        { associateInputs: false, style: "positive" },
      ),
      submitAction(
        REJECT_TITLE,
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
 * The send equivalent of {@link buildActionOutcomeCard}, and separate from it
 * because the honest wording differs. `failed` on an approval means "may or
 * may not have applied — go and look". `failed` on a SEND means the message
 * may or may not have reached the agent, and the safe advice is the opposite
 * of retrying: a resend that turns out to be a duplicate is a second message
 * in the agent's queue, which it will act on.
 */
export function buildMessageOutcomeCard(
  outcome: ActionOutcome,
  chat: ChatRef,
): Attachment {
  switch (outcome.kind) {
    case "applied":
      return card([
        container(
          [
            text("Message sent", {
              weight: "bolder",
              color: "good",
              spacing: "none",
            }),
            text(`Delivered to ${chatLabel(chat)}.`, {
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
            text("The host declined this message", {
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
            text("Couldn't confirm this message", {
              weight: "bolder",
              color: "attention",
              spacing: "none",
            }),
            text(outcome.reason, { spacing: "small" }),
          ],
          { style: "attention" },
        ),
        text(
          'It may already have reached the agent. Check with "chat <id>" before sending again — a duplicate is a second message the agent will act on, not a no-op.',
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
/**
 * What the bot can DO, as buttons — not what to type.
 *
 * This card previously listed five commands in a `FactSet`:
 *
 *     fleet             agents in the current epic
 *     chat <id>         status, approvals, and a reply box
 *     say <id> <text>   message an agent
 *     log <id>          read a chat's history
 *     epic <id>         switch this chat to another epic
 *
 * The one surface whose entire job is teaching the interface was teaching
 * people to read a GUID off a screen and retype it. Every other card could
 * grow buttons and this would still document the CLI as the front door.
 *
 * So it names capabilities and offers them. The commands still work — they
 * are a fallback, not the interface — and are deliberately not listed, because
 * listing them is what made them the interface.
 *
 * "Ask in your own words" is stated because the input is now natural language
 * and nothing else on screen would tell you that. It applies equally in the
 * Chat tab and in a channel with an @mention: same bot, same conversation,
 * same rules.
 */
export function buildHelpCard(): Attachment {
  return card([
    text("Traycer", { weight: "bolder", size: "medium" }),
    text("Ask in your own words, or pick one of these.", {
      isSubtle: true,
      size: "small",
      spacing: "none",
    }),
    /*
     * ONLY BUTTONS THAT WORK.
     *
     * The first version of this card also offered "Waiting on you" — and the
     * bot has no waiting surface at all; that is the TAB's feature. Pressing
     * it would have returned "Unknown card action", which is a card promising
     * something that does not exist. Exactly the defect this whole pass is
     * about, introduced by the change meant to fix it.
     *
     * Add it back in the same change that builds the surface behind it.
     */
    actionSet([
      submitAction("My agents", FLEET_VERB, {}, { associateInputs: false }),
    ]),
    container(
      [
        text("Assess a document", { weight: "bolder", spacing: "none" }),
        text(
          "Attach an RFI or RFP and ask whether it fits — for example, “does this work with SensorMine?”",
          { isSubtle: true, size: "small", spacing: "none" },
        ),
      ],
      { style: "emphasis", separator: true },
    ),
  ]);
}

/**
 * The clarifying question, for when routing is not confident.
 *
 * THE BUTTONS CARRY THE DECISION. Each action's `data` holds the product,
 * intent and skill explicitly, so the handler acts on what was pressed rather
 * than re-running the classifier and reading `suggestion`.
 *
 * That distinction is the whole point. `classify` returns `uncertain` with a
 * suggestion, and a caller that reads the suggestion and dispatches it has
 * quietly converted "ask" into "guess" — the exact failure `classify` has a
 * test against. This card is the most likely place for that to happen, so the
 * decision travels in the button rather than being re-derived after it.
 *
 * The second button matters as much as the first: without a way to say no,
 * the only path forward is the one we guessed, and a confirmation with no
 * alternative is not a question.
 */
export function buildClarifyCard(options: {
  readonly suggestionLabel: string | null;
  readonly product: string | null;
  readonly intent: string | null;
  readonly skill: string | null;
}): Attachment {
  const canSuggest =
    options.suggestionLabel !== null &&
    options.product !== null &&
    options.intent !== null;

  return card([
    text("Before I start", { weight: "bolder", size: "medium" }),
    text(
      canSuggest
        ? `Looks like ${options.suggestionLabel}. Is that right?`
        : "I'm not sure what you'd like me to do with that.",
      { spacing: "none" },
    ),
    actionSet([
      ...(canSuggest
        ? [
            submitAction(
              "Yes, go ahead",
              CONFIRM_ROUTE_VERB,
              {
                // Explicit, so the handler never re-derives the route.
                product: options.product ?? "",
                intent: options.intent ?? "",
                skill: options.skill ?? "",
              },
              { associateInputs: false },
            ),
          ]
        : []),
      submitAction("Something else", CLARIFY_OTHER_VERB, {}, {
        associateInputs: false,
      }),
    ]),
  ]);
}

/**
 * "Started — watch progress here."
 *
 * THE LINK IS THE POINT. The use case's first expected result is *"a link to
 * the agent epic/chats to see progress"*, so an ack without one fails the
 * progress half at step one — a message saying work began with nowhere to
 * look is barely better than silence.
 *
 * `Action.OpenUrl` rather than a markdown link: it renders as a button on
 * every surface, and a markdown link inside a `TextBlock` is styled
 * inconsistently across Teams clients and easy to miss on a phone.
 *
 * The UNCONFIRMED variant says PRESS IT AGAIN, and that wording comes from
 * the contract rather than from optimism: `epic.createChat` is idempotent on
 * a client-supplied `chatId`, which the dispatch mints once and reuses, so a
 * retry cannot produce a second agent. The neighbouring artifact create takes
 * no client id and needs the opposite advice — identical-looking states,
 * opposite correct actions, and the only way to know is to read the contract.
 */
export function buildAssessmentStartedCard(options: {
  readonly title: string;
  readonly deepLink: string | null;
}): Attachment {
  return buildCard(
    [
      text("Assessment started", { weight: "bolder", size: "medium" }),
      text(options.title, { isSubtle: true, spacing: "none" }),
      text(
        options.deepLink === null
          ? "It's running. I'll reply here when it's done."
          : "It's running — open it to watch progress. I'll reply here when it's done.",
        { spacing: "small" },
      ),
    ],
    options.deepLink === null
      ? []
      : [
          {
            type: "Action.OpenUrl",
            title: "Watch progress",
            url: options.deepLink,
          },
        ],
  );
}

/** The dispatch did not confirm. Safe to retry — see the docblock above. */
export function buildAssessmentUnconfirmedCard(reason: string): Attachment {
  return card([
    text("Couldn't confirm it started", {
      weight: "bolder",
      size: "medium",
      color: "warning",
    }),
    text(
      "Ask again the same way — it's the same request, so it can't start a second assessment.",
      { spacing: "none" },
    ),
    text(reason, { isSubtle: true, size: "small", spacing: "small" }),
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
        text(REFUSAL_COPY[reason], { spacing: "small" }),
      ],
      { style: "attention" },
    ),
    // The machine-readable reason is kept as a short CODE, not as the
    // explanation. Someone reporting this needs something exact to quote,
    // but "unmapped_principal" is not an explanation — it is internal
    // vocabulary, and showing it as the reason is the same mistake as
    // printing subprocess output, just smaller.
    facts([["Code", reason]]),
  ]);
}

const REFUSAL_COPY: Record<RefusalReason, string> = {
  unmapped_principal:
    "Your account isn't linked to a Traycer host yet. Ask whoever set this up to add you.",
  unmapped_host_id:
    "The host this conversation points at isn't one we can reach.",
  malformed_principal:
    "Your sign-in didn't carry the details we need. Try signing out of Teams and back in.",
};

/**
 * Recognised failures, in the user's language.
 *
 * Matching on subprocess text is fragile, so it is used ONLY to improve the
 * message — never to decide anything, and never as a reason to show the text
 * itself. An unrecognised failure falls back to the generic sentence for its
 * `reason`, which is always correct if less specific.
 */
const KNOWN_FAILURES: readonly {
  readonly match: RegExp;
  readonly headline: string;
  readonly guidance: string;
}[] = [
  {
    // The one Elliot hit: the bridge's cached credential had expired.
    match: /"exp" claim|jwt expired|token (is )?expired/i,
    headline: "Your host sign-in expired",
    guidance: "Try the same command again — it refreshes automatically.",
  },
  {
    match: /not provisioned|UNAUTHORIZED|not signed in/i,
    headline: "Your host isn't signed in",
    guidance: "Run `traycer login` on the machine running your host.",
  },
  {
    match: /ECONNREFUSED|ENOTFOUND|socket hang up|network/i,
    headline: "Couldn't reach your Traycer host",
    guidance: "It may be asleep or offline. Try again shortly.",
  },
  {
    match: /was not found|no such chat|unknown chat/i,
    headline: "That chat isn't available",
    guidance: 'Run "fleet" to see the chats you can open.',
  },
];

const GENERIC_FAILURE: Record<
  BridgeCliFailureReason,
  { readonly headline: string; readonly guidance: string }
> = {
  spawn_timed_out: {
    headline: "Your host took too long to answer",
    guidance: "Nothing was changed. Try again shortly.",
  },
  nonzero_exit: {
    headline: "Couldn't reach your Traycer host",
    guidance: "Nothing was changed. Try again shortly.",
  },
  malformed_output: {
    headline: "Your host sent something unexpected",
    guidance: "Nothing was changed. This has been logged.",
  },
};

/**
 * NEVER renders `detail`.
 *
 * It used to, and the result was a card containing a JSON log line, an
 * internal stream-client message, a filesystem path and a user id — a stack
 * trace in a product surface, and a data leak to anyone looking at the
 * screen. Subprocess output is diagnostic material: it belongs in the server
 * log, which is where `toReadSurfaceFailure` now puts it.
 *
 * `detail` is still a PARAMETER because it selects the wording — a
 * recognised failure gets a specific, actionable sentence. It is read, never
 * shown.
 */
export function buildBridgeUnavailableCard(
  reason: BridgeCliFailureReason,
  detail: string,
): Attachment {
  const known = KNOWN_FAILURES.find((f) => f.match.test(detail));
  const { headline, guidance } = known ?? GENERIC_FAILURE[reason];
  return card([
    container(
      [
        text(headline, {
          weight: "bolder",
          color: "warning",
          spacing: "none",
        }),
        text(guidance, { isSubtle: true, spacing: "small" }),
      ],
      { style: "warning" },
    ),
  ]);
}

/**
 * Why there is no reply box, said out loud.
 *
 * A missing composer with no explanation is the white-screen failure in
 * miniature: the user assumes the surface is broken rather than that the
 * constraint is real. This costs one line and turns "where's the reply box"
 * into a fact about where the agent runs.
 */
export function buildReadOnlyChatCard(chat: ChatRef): Attachment {
  return card([
    container(
      [
        text("Read-only from here", {
          weight: "bolder",
          spacing: "none",
        }),
        text(
          `You can read ${chatLabel(chat)}, but sending needs the host it runs on.`,
          { isSubtle: true, spacing: "small" },
        ),
      ],
      { style: "emphasis" },
    ),
  ]);
}

/**
 * The id you named isn't a chat we can reach.
 *
 * Exists because `say hi` rendered a composer headed "Reply to hi", bound to
 * nothing. The lesson is worth keeping: the design deliberately refuses to
 * invent a destination, and then a validation gap invented one anyway.
 *
 * Names the id back so the mistake is obvious — someone who typed `say hi`
 * meaning "say hi" needs to SEE that "hi" was read as a destination, or the
 * message won't land.
 */
export function buildUnknownChatCard(chatId: string): Attachment {
  return card([
    container(
      [
        text("That doesn't look like a chat", {
          weight: "bolder",
          color: "warning",
          spacing: "none",
        }),
        text(`No reachable chat matched “${shortId(chatId)}”.`, {
          isSubtle: true,
          spacing: "small",
        }),
      ],
      { style: "warning" },
    ),
    // Short labels: a FactSet's title column is narrow, and "To message an
    // agent" wrapped onto two lines at 320px while its value wrapped too.
    facts([
      ["Message", "say <chat-id> <message>"],
      ["Find ids", "fleet"],
    ]),
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

