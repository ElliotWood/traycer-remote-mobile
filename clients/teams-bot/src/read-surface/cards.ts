import { CardFactory } from "@microsoft/agents-hosting";
import type { Attachment } from "@microsoft/agents-activity";
import type { RefusalReason } from "@traycer-clients/shared/identity-registry/types";
import type {
  ActionOutcome,
  AgentSummary,
  ChatStatus,
  EpicSummary,
  InterviewQuestion,
  PendingApproval,
  PendingInterview,
  Transcript,
  TranscriptMessage,
  TranscriptPart,
} from "./bridge-types";
import type { BridgeCliFailureReason } from "./bridge-cli";
import {
  speakerLabel as sharedSpeakerLabel,
  humaniseToolName as sharedHumaniseToolName,
  shortenWorkspacePath as sharedShortenWorkspacePath,
} from "@traycer-clients/shared/epic/transcript";

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

/**
 * THE VISUAL SYSTEM, 2026-08-09. Read this before adding a card.
 *
 * The rules above (semantic tokens only, no hex, responsive by construction)
 * were right and are unchanged. What they did not say is HOW MUCH, and the
 * result was a set of cards that each used the vocabulary correctly and
 * looked, together, like a stack of alert boxes. Rendered evidence, at 500px:
 *
 *   - the chat card was three full-bleed colour slabs in a row — grey header,
 *     pink approvals, pink interviews — separated by hairlines, which reads
 *     as a rendering fault rather than as hierarchy;
 *   - the fleet card spent five lines and two buttons per row, so eight
 *     agents measured ~1560px and Teams would collapse it behind "see more";
 *   - the transcript rendered `⟨error · styling unverified⟩ ⟨model · claude⟩`
 *     in monospace angle brackets — debug-console vocabulary in a surface
 *     Altra sales staff use in front of customers;
 *   - identifiers nobody can act on (`Epic e0000000…`) sat in bold FactSet
 *     rows, which is the heaviest treatment the schema has, for the least
 *     useful thing on the card.
 *
 * So three rules, and they are about RESTRAINT rather than about tokens:
 *
 * 1. ONE TONED CONTAINER PER CARD, AT MOST.
 *    `attention` / `warning` / `good` are for a card whose ENTIRE subject is
 *    that state — an outcome, a refusal, a failure. A card that carries a
 *    toned header AND toned content below it has told the reader nothing:
 *    if everything is coloured, colour has stopped marking the exception.
 *    Headers are `emphasis` (neutral) and the semantic signal is carried by
 *    ONE coloured word inside them. See {@link cardHeader}.
 *
 * 2. ONE GRAMMAR FOR HEADERS, ONE FOR FOOTERS.
 *    Header: eyebrow (small, bolder, semantic colour) — what KIND of card
 *    this is; title (medium, bolder) — the subject; subtitle (small, subtle)
 *    — one line of context. Footer: {@link metaLine}, one subtle small line
 *    of `a · b · c`. Identifiers live in the footer, never in a FactSet.
 *    `FactSet` is kept for genuine label/value pairs a reader quotes — the
 *    `Code` row on a refusal — and nothing else.
 *
 * 3. HEIGHT IS A DESIGN PROPERTY.
 *    Teams collapses a tall card behind "see more", and a card you must
 *    expand before reading has failed before it is read. Rows get one
 *    action, not two; lists get a limit that fits; the second action moves to
 *    the card the first one opens.
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
/**
 * NO GLYPH, unlike Approve/Reject, and the difference is the whole rule.
 *
 * The glyphs on Approve and Reject are load-bearing: two opposite,
 * irreversible decisions sitting side by side, whose colour Teams may drop,
 * so the distinction has to survive in something no host can strip. `Send`
 * is a single primary button with nothing to be confused with. A `➤` there
 * is decoration, and decoration applied inconsistently is what made the set
 * look ad hoc — `➤ Send`, `✓ Approve`, `↑ Older`, `My agents`, `Reply`, all
 * on adjacent cards.
 *
 * The test: would removing this glyph make two actions harder to tell
 * apart? On Approve/Reject, yes. Here, no.
 */
export const SEND_TITLE = "Send";
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

/**
 * `FactSet` aligns and themes itself. RESERVED, now, for pairs a reader
 * genuinely compares or quotes — in practice the `Code` row on a refusal.
 *
 * It was carrying rows like `Epic  e0000000…`, and a FactSet title is bold:
 * the heaviest treatment the schema has, spent on the one thing on the card
 * nobody can act on. Identifiers moved to {@link metaLine}.
 */
function facts(pairs: readonly (readonly [string, string])[]): unknown {
  return {
    type: "FactSet",
    facts: pairs.map(([title, value]) => ({ title, value })),
  };
}

/**
 * The one header grammar, used by every card.
 *
 * `emphasis` — NEVER a semantic tone — and the reason is the same one
 * `buildChatCard` already recorded for itself and then nothing else adopted:
 * an `attention`-styled container wrapping a green "Running" badge reads as
 * self-contradictory. Generalised: a header describes the SUBJECT, and the
 * subject's state belongs to one word inside it, not to a slab of colour
 * behind it.
 *
 * `eyebrow` is where the semantic colour goes. It says what kind of card this
 * is — "Approval needed", "Fleet", "Needs your answer" — so a reader who sees
 * six cards in a thread can tell them apart without reading any of them.
 *
 * `tone: null` renders NO container at all, for cards short enough that a
 * grey band would be most of the card.
 */
function cardHeader(options: {
  readonly eyebrow: string | null;
  readonly eyebrowColor?: SemanticColor;
  readonly title: string;
  readonly subtitle?: string | null;
  readonly tone?: ContainerStyle | null;
}): unknown {
  const items: unknown[] = [];
  if (options.eyebrow !== null) {
    items.push(
      text(options.eyebrow, {
        size: "small",
        weight: "bolder",
        color: options.eyebrowColor ?? "default",
        isSubtle: options.eyebrowColor === undefined,
        spacing: "none",
      }),
    );
  }
  items.push(
    text(options.title, {
      weight: "bolder",
      size: "medium",
      spacing: options.eyebrow === null ? "none" : "small",
    }),
  );
  const subtitle = options.subtitle ?? null;
  if (subtitle !== null && subtitle.length > 0) {
    items.push(
      text(subtitle, { isSubtle: true, size: "small", spacing: "small" }),
    );
  }
  const tone = options.tone === undefined ? "emphasis" : options.tone;
  return tone === null
    ? container(items, { spacing: "none" })
    : container(items, { style: tone });
}

/**
 * The one footer grammar: `a · b · c`, subtle, small, last.
 *
 * Everything a reader might need but will not act on — a chat title, an epic
 * id, how long ago something was asked — goes here in one line. Empty and
 * null segments are dropped rather than rendering ` ·  · `, because the
 * callers assemble these from optional fields.
 *
 * WRAPS, unlike the old FactSet. The FactSet's narrow title column forced
 * short labels and then wrapped both columns anyway at 320px; one flowing
 * line degrades to two flowing lines, which is the failure mode you want.
 */
function metaLine(segments: readonly (string | null)[]): unknown {
  const shown = segments.filter(
    (segment): segment is string => segment !== null && segment.length > 0,
  );
  return text(shown.join("  ·  "), {
    isSubtle: true,
    size: "small",
    separator: true,
    spacing: "small",
  });
}

/**
 * An epic id as a footer segment, or `null` when there is nothing to say.
 *
 * The information is kept — an approval is a decision prompt and "approve
 * this" is ambiguous across epics, which is why it was added — but its
 * WEIGHT is not. A truncated UUID in bold was claiming to be a fact someone
 * would use. Here it is what it actually is: something to quote at whoever
 * asks "which epic?".
 */
function epicSegment(epicId: string): string | null {
  return epicId.length === 0 ? null : `Epic ${shortId(epicId)}`;
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

/**
 * Long fleets are truncated with an honest count rather than dumped as N
 * uniform rows.
 *
 * WAS 12, and 12 never fitted. Measured at 500px, the old five-line row came
 * to ~195px, so twelve rows plus a header was ~2400px — several times past
 * where Teams collapses a card behind "see more". A limit that produces a
 * card nobody can read without expanding it is not a limit.
 *
 * The row is now ~85px, so eight rows plus a header land near 750px, which
 * fits. The number is derived from the row height; if the row grows, this
 * shrinks.
 */
const FLEET_ROW_LIMIT = 8;

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
  /**
   * The full, honest label. Unchanged, and still what
   * {@link agentStatusLabel} returns — "Read-only — runs on another host"
   * says the constraint first and the cause second, and both matter.
   */
  readonly label: string;
  /**
   * The same status, SHORT ENOUGH FOR A COLUMN.
   *
   * The fleet row puts status in an `auto`-width column beside the title,
   * and "Read-only — runs on another host" took nearly the full card width
   * there — it collided with the agent's name and pushed it to a sliver.
   * Rendered proof, not a guess.
   *
   * The cause is not dropped; it moves to {@link detail}, which the row
   * prints on its metadata line next to the harness and surface. Same two
   * facts, in the two slots that fit them, rather than one string doing a
   * job it is too long for.
   */
  readonly badge: string;
  /** The cause, when there is one, for the metadata line. `null` otherwise. */
  readonly detail: string | null;
  readonly color: SemanticColor;
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
  /*
   * DERIVED FROM `label`, not computed a second time from the three axes.
   *
   * Recomputing would be the exact defect this function was created to
   * close: the label was moved to the capability and the colour was left on
   * locality two lines below, so a row said "Active" in grey. A second
   * derivation of the same fact is a second thing that can disagree with it.
   *
   * Splitting on the em dash is not string-parsing for its own sake — the
   * em dash is precisely where `agentStatusLabel` puts the constraint/cause
   * boundary, and it says so.
   */
  const [badge, ...cause] = label.split(" — ");
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
    // "Activity not visible from here" has no em dash and is still too long
    // for the column, so it gets the one explicit shortening in here. Every
    // other label is already short or splits on its own.
    badge: badge === "Activity not visible from here" ? "Not visible" : badge,
    detail:
      cause.length > 0
        ? cause.join(" — ")
        : badge === "Activity not visible from here"
          ? "activity not visible from here"
          : null,
    color: running ? "good" : "default",
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
      cardHeader({
        eyebrow: null,
        title: "Fleet",
        subtitle: "No agents in this epic yet.",
        tone: null,
      }),
    ]);
  }

  // What this host can actually SEE the activity of. Replaces a count of
  // `active`, which is local-only and so could never exceed the calling
  // agent — see the header below.
  const observable = agents.filter((a) => a.isLocal).length;
  // Observable first, then active within that. Sorting by `active` alone had
  // the same flaw as counting it: for a fleet on other hosts every value is
  // false, so the sort was a no-op and the rows a user can actually act on
  // were wherever the host happened to return them. Locality is the axis
  // that varies.
  const sorted = [...agents].sort(
    (a, b) =>
      Number(b.isLocal) - Number(a.isLocal) || Number(b.active) - Number(a.active),
  );
  const shown = sorted.slice(0, FLEET_ROW_LIMIT);

  const header = [
    cardHeader({
      eyebrow: null,
      title: "Fleet",
      subtitle:
      /*
       * NO "N active". The count was structurally incapable of being right.
       *
       * `active` is local-only — the host's activity tracker does not
       * replicate — so it is false for every agent running anywhere else.
       * With a fleet spread across hosts the header read "58 agents · 0
       * active" while more than twenty were running. Not wrong on the day:
       * unable to be right on any day.
       *
       * This is the `active: false → "Idle"` finding again. We fixed it in
       * the ROWS, which now say "Activity not visible from here" rather than
       * claiming idle, and left the identical inference in the summary line
       * directly above them.
       *
       * The replacement counts what we can actually observe: how many agents
       * this host can see the activity of. That is a real property, it is
       * derived from the same `isLocal` the rows use, and it degrades
       * honestly — if none are local it says so instead of implying a dead
       * fleet.
       */
      observable === agents.length
          ? `${String(agents.length)} agent${agents.length === 1 ? "" : "s"}`
          : `${String(agents.length)} agent${agents.length === 1 ? "" : "s"} · ${String(observable)} visible from here`,
    }),
  ];

  /*
   * ONE ACTION PER ROW, and the second one did not disappear — it moved.
   *
   * The row carried `Reply` and `Activity`, so eight agents rendered sixteen
   * outlined buttons. Measured at 500px, the button chrome alone was more
   * card height than every agent title put together, and the eye had nothing
   * to land on: a list whose loudest element repeats identically on every row
   * has no scanning order at all.
   *
   * `Open` is the row's one destination, and it is the same thing tapping the
   * row already did — so the button is now the row gesture MADE VISIBLE
   * rather than a third competing affordance. `Reply` and `History` are
   * offered by {@link buildChatCard}, which is where `Open` lands. Two taps
   * to send a message instead of one; a list you can read instead of one you
   * expand.
   *
   * NOT GATED on `capabilities.sendMessage` any more, and that is the point
   * of moving it: `Open` is a read, and every agent here is readable. The
   * gate did not weaken, it went to the card that offers the write — see
   * `buildChatCard`'s `canSend`. Offering a Reply button this host cannot
   * honour was the failure the gate existed to stop, and it still cannot
   * happen; it just cannot happen one screen later.
   */
  const rows = shown.map((agent) => {
    // One derivation for label and styling — see agentStatusPresentation.
    const presentation = agentStatusPresentation(agent);
    return container(
      [
        /*
         * THE WHOLE ROW IS ONE `ColumnSet`: identity, status, action.
         *
         * Stacking them cost three lines and ~147px a row; side by side it
         * is ~78px, so eight agents come to ~640px instead of ~1180px. That
         * is the difference between a card Teams shows and a card Teams
         * collapses behind "see more", which is the only height threshold
         * that matters here.
         *
         * The action sits INSIDE a Column, which is plain element nesting
         * rather than a feature — `ActionSet` is 1.2, `Column.items` takes
         * elements, and neither is above the version we declare. Flagged
         * anyway: this file's whole history is schema-says-yes /
         * Teams-says-no, so if one thing here needs checking in the product
         * first, it is this.
         *
         * `verticalContentAlignment: "center"` on all three is what stops
         * the button floating above a two-line title at 320px.
         */
        {
          type: "ColumnSet",
          spacing: "none",
          columns: [
            {
              type: "Column",
              width: "stretch",
              verticalContentAlignment: "center",
              items: [
                text(agentDisplayName(agent), {
                  weight: "bolder",
                  spacing: "none",
                }),
                text(
                  [
                    agent.harnessId ?? "unknown",
                    agent.surface,
                    presentation.detail,
                  ]
                    .filter((segment): segment is string => segment !== null)
                    .join(" · "),
                  { isSubtle: true, size: "small", spacing: "none" },
                ),
              ],
            },
            {
              type: "Column",
              width: "auto",
              verticalContentAlignment: "center",
              items: [
                text(presentation.badge, {
                  size: "small",
                  weight: "bolder",
                  color: presentation.color,
                  isSubtle: presentation.color === "default",
                  spacing: "none",
                  // The one place `wrap: false` is right: this column is
                  // sized to its content, so wrapping it would mean it had
                  // taken width it then refused to use.
                  wrap: false,
                }),
              ],
            },
            {
              type: "Column",
              width: "auto",
              verticalContentAlignment: "center",
              items: [
                actionSet([
                  submitAction(
                    "Open",
                    OPEN_CHAT_VERB,
                    { chatId: agent.agentId },
                    { associateInputs: false },
                  ),
                ]),
              ],
            },
          ],
        },
      ],
      {
        /*
         * NO PER-ROW CONTAINER STYLE, and the render is why.
         *
         * Active rows were `emphasis` and the rest `default`. Adaptive Cards
         * only pads a Container that HAS a style, so the list came out
         * ragged: three tall padded rows, then five tight unpadded ones,
         * with no visual rule connecting them. Worse, the three adjacent
         * `emphasis` rows merged into one continuous grey block and their
         * separators vanished inside it — the styling meant to distinguish
         * running agents destroyed the row boundaries between them.
         *
         * A green "Active" is already the most scannable thing on the row.
         * Uniform geometry plus one coloured word beats alternating
         * geometry, and it is rule 1 again one level down: the emphasis was
         * a second signal saying what the colour already said.
         */
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
export function buildChatCard(
  status: ChatStatus,
  epicId: string,
  /**
   * Whether this host can send to this chat.
   *
   * NEW, and it is the gate the fleet row used to hold. `Reply` moved here
   * when the row went down to one action, and the promise it makes had to
   * move with it — a Reply button on a chat that cannot receive one is the
   * exact "button that lies" the fleet card's own docblock refused to ship.
   *
   * REQUIRED, with no default — and the repo's `no-restricted-syntax` rule
   * banning default parameters is stating the same thing I wrote here first
   * and then undercut. A `canSend = false` default means a caller who has not
   * established the capability produces a card by omission; the whole point
   * is that establishing it is not optional. `dispatch.ts` reads it from the
   * same `fetchChatCapabilities` it already calls.
   */
  canSend: boolean,
): Attachment {
  if (!status.connected) {
    // The WHOLE subject of this card is the degraded state, so the whole card
    // is toned — that is what rule 1 permits, and the reason it permits it.
    return card([
      cardHeader({
        eyebrow: "Host unreachable",
        eyebrowColor: "warning",
        title: status.title ?? shortId(status.chatId),
        subtitle:
          "The status could not be refreshed, so it is not shown. Try again shortly.",
        tone: "warning",
      }),
    ]);
  }

  const approvals = status.pendingApprovals;
  const interviews = status.pendingInterviews;
  const needsAttention = approvals.length > 0 || interviews.length > 0;

  // Header is ALWAYS `emphasis`, never `attention` — the reason this card
  // recorded for itself, and which {@link cardHeader} now applies to every
  // card: an error-red container wrapping a green "Running" badge reads as
  // self-contradictory. The needs-input signal belongs on the block that
  // describes what is pending, below.
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

  /*
   * ONE pending block, not one per kind — rule 1, and the render is why.
   *
   * An approval and an interview both pending produced TWO `attention`
   * containers stacked directly on top of each other with a hairline
   * between, under a grey one. Three full-bleed slabs in a 600px card. It
   * did not read as two things waiting; it read as a display fault.
   *
   * They are the same fact to the reader — *this agent is blocked on you* —
   * so they are one block, and what is pending is enumerated INSIDE it.
   *
   * Naming WHAT is pending rather than how many is preserved deliberately;
   * it has a test, and the test is right. "Pending approvals: 1" tells you
   * nothing about what you would be approving.
   */
  if (needsAttention) {
    const lines: unknown[] = [
      text("Waiting on you", {
        weight: "bolder",
        color: "attention",
        spacing: "none",
      }),
    ];
    if (approvals.length > 0) {
      const first = approvals[0];
      const more = approvals.length - 1;
      lines.push(
        text(
          more > 0
            ? `${first.toolName} (+${String(more)} more)`
            : first.toolName,
          { weight: "bolder", spacing: "small" },
        ),
        text(summariseDescription(first.description), { spacing: "none" }),
      );
    }
    if (interviews.length > 0) {
      lines.push(
        text(
          interviews.length === 1
            ? "An interview is waiting for an answer."
            : `${String(interviews.length)} interviews are waiting for answers.`,
          { spacing: approvals.length > 0 ? "small" : "none" },
        ),
      );
    }
    body.push(container(lines, { style: "attention", separator: true }));
  } else {
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
  // In the footer now, not a bold FactSet — see `metaLine`.
  body.push(metaLine([epicSegment(epicId), `Chat ${shortId(status.chatId)}`]));

  /*
   * THE ACTIONS THE FLEET ROW GAVE UP.
   *
   * This card had none at all. It announced a blocked agent in a red block
   * and then offered no way to do anything about it — the typed `chat <id>`
   * path happens to append a composer and an approval card AFTER it, so the
   * hole was invisible from the command line and total from a button, since
   * `dispatchActionInvoke` returns exactly one card.
   *
   * `Reply` is gated on `canSend`, which is the fleet row's old gate in its
   * new home. `History` is not gated: reading is not the same permission,
   * which is the distinction the fleet card drew and this one inherits.
   */
  const actions = [
    ...(canSend
      ? [
          submitAction("Reply", REPLY_VERB, { chatId: status.chatId }, {
            associateInputs: false,
          }),
        ]
      : []),
    submitAction("History", LOG_VERB, { chatId: status.chatId }, {
      associateInputs: false,
    }),
  ];
  return buildCard(body, actions);
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

/**
 * A tool's name as a person should read it.
 *
 * Elliot's transcript rendered `⟨tool · mcp__traycer_a2a__traycer_send_message⟩`
 * — an internal MCP identifier in a product surface. That is the same defect
 * as the error card printing raw subprocess output: the label was correct
 * about WHICH tool and told a reader nothing except that we leaked an
 * internal.
 *
 * MCP tools are named `mcp__<server>__<tool>`. The tool half is the part with
 * meaning; the server prefix is routing. Underscores become spaces because
 * `traycer_send_message` is not a phrase either.
 *
 * Anything unrecognised is returned as-is rather than mangled — a label we
 * cannot improve is better than one we corrupt.
 */
export function humaniseToolName(raw: string): string {
  // DELEGATES to `clients/shared`. Written here first; the tab has its own
  // renderer and kept showing bare `[Tool call]` chips afterwards — the same
  // divergence as `speakerLabel`, from the same cause. What a tool call is
  // called is protocol grammar, so the rule lives in shared and this stays
  // as the bot's entry point to it.
  return sharedHumaniseToolName(raw);
}

/**
 * WHO said it. Not what model produced it.
 *
 * A live transcript rendered `default · 15s ago` and, in another chat,
 * `haiku · 50h ago`. Neither is a placeholder: `author` on an ASSISTANT turn
 * is `sender.displayName`, and for an assistant that is the MODEL ALIAS. On a
 * USER turn the same field is the sending agent's title
 * ("Teams P0 — Generator"). So one column carried two different meanings,
 * distinguished only by message direction, with nothing to tell them apart.
 *
 * That is the `active: false` family precisely: a value that is TRUE ABOUT A
 * NEIGHBOURING SUBJECT — `haiku` really is the model — rendered in the slot a
 * reader parses as "who is speaking". And it failed silently for the same
 * reason, because `haiku` reads enough like a name that nothing looks wrong.
 * Only `default` gave it away, and only because that word is obviously not a
 * person.
 *
 * MY FIRST FIX WAS WRONG and worth recording: I treated "default" as a
 * placeholder and mapped it to "Agent". That would have looked correct on
 * this transcript and hidden the defect on every agent whose model happens to
 * read like a name — repairing the one instance that announced itself while
 * preserving the class.
 *
 * So: assistant turns are the agent, and say so. The model is a real fact and
 * moves to the metadata line with the other facts about the turn, where being
 * a model is unambiguous.
 */
export function speakerLabel(message: TranscriptMessage): string {
  // DELEGATES to `clients/shared/epic/transcript`. This rule lived only here,
  // so fixing the model-as-speaker defect in the bot left the tab still
  // showing `haiku` — a one-client fix for a protocol question, and nothing
  // could have told us. "Who said this" is grammar; it belongs in shared.
  //
  // A thin wrapper rather than a direct call at every site: the bot's
  // `TranscriptMessage` is its own type, so this is the one place that
  // adapts it. The RULE is shared; the type mapping is local.
  return sharedSpeakerLabel(message);
}

/**
 * The model, as a metadata chip rather than a speaker.
 *
 * `null` when unknown, so the caller renders nothing rather than a chip
 * saying "unknown".
 */
export function modelMarker(message: TranscriptMessage): string | null {
  if (message.role !== "assistant") return null;
  const model = message.author?.trim() ?? "";
  return model.length > 0 ? model : null;
}

/**
 * A file path a reader can use, without the server's plumbing.
 *
 * A live transcript rendered
 * `⟨file · /srv/traycer/tenants/elliot/work/altra-proof/PROOF.md⟩`. Today
 * that is Elliot's own host in his own client, so nothing is disclosed — but
 * `/srv/traycer/tenants/<name>` embeds a TENANT NAME, and the product's whole
 * direction is Teams users looking at hosts they do not own. The prefix also
 * tells the reader nothing: they cannot open it, and it costs a third of the
 * line on a phone.
 *
 * Trims to the workspace when the shape is recognised, and otherwise returns
 * the path unchanged — a path we cannot confidently shorten is better whole
 * than truncated at a guess.
 */
export function shortenWorkspacePath(raw: string): string {
  // DELEGATES — same reason as the tool name: a path shown to a person is
  // grammar, and the tenant-prefix rule must not exist twice.
  return sharedShortenWorkspacePath(raw);
}

/**
 * What a part is, as a WORD a reader already knows.
 *
 * `part.kind` is protocol vocabulary — `file_change`, `other`, `command` —
 * and it was being printed raw. This maps it to the verb a person would use
 * for the same thing, which is the same move `humaniseToolName` makes one
 * level down.
 */
const PART_NOUN: Record<string, string> = {
  file_change: "Edited",
  file: "Edited",
  code: "Code",
  table: "Table",
  command: "Ran",
  tool: "Used",
  error: "Error",
  other: "Content",
};

/**
 * A VERB takes its object directly; a NOUN needs a colon.
 *
 * Caught in the render, not in review. "Ran bun test --filter cards" and
 * "Edited cards.ts" read as sentences, so the same joiner was used
 * throughout — and produced "Error styling unverified" and "Table coverage",
 * which read as typos. The label after a verb is what was acted on; the
 * label after a noun is what the thing IS, and English punctuates those
 * differently.
 */
const PART_IS_VERB = new Set(["file_change", "file", "command", "tool"]);

/**
 * One part of a message, as a line a salesperson can read.
 *
 * WAS `⟨error · styling unverified⟩` — monospace, angle brackets, a
 * protocol noun and a raw label. Rendered in a live transcript next to
 * `⟨command · bun test --filter cards⟩` and `⟨model · claude⟩`, and the
 * effect is a debug console pasted into a chat. This is the surface Altra
 * sales staff run customer RFP work in.
 *
 * The angle brackets were doing a real job — separating metadata from the
 * agent's own prose so nobody read "⟨code · 24 lines⟩" as something the
 * agent wrote. That job is now done by POSITION and WEIGHT instead: markers
 * live on their own subtle small line beneath the prose, which is the
 * convention every other card here already uses for metadata. Punctuation
 * was carrying styling's weight.
 */
export function partMarker(part: TranscriptPart): string {
  const noun = PART_NOUN[part.kind] ?? "Content";
  const rawLabel = part.label.trim();
  // Only tool labels are identifiers; a heading is already human and must not
  // be run through the humaniser. File paths get their own treatment.
  const label =
    part.kind === "tool"
      ? humaniseToolName(rawLabel)
      : part.kind === "file_change"
        ? shortenWorkspacePath(rawLabel)
        : rawLabel;
  const head =
    label.length === 0
      ? noun
      : PART_IS_VERB.has(part.kind)
        ? `${noun} ${label}`
        : `${noun}: ${label}`;
  // "1 lines" appeared in front of a user. Pluralise.
  return part.lines > 0
    ? `${head} · ${String(part.lines)} line${part.lines === 1 ? "" : "s"}`
    : head;
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
      `${speakerLabel(message)} · ${approvalAgeLabel(message.timestamp, now)}`,
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
  const markers = [
    ...message.parts.map(partMarker),
    // The model belongs here — a fact about the turn — not in the speaker
    // slot. Last, because it is the least interesting of them.
    ...(modelMarker(message) === null ? [] : [modelMarker(message) as string]),
  ];
  if (markers.length > 0) {
    // Markers on their own line: they are metadata about the message, not
    // part of its prose.
    //
    // NO LONGER MONOSPACE. `fontType: "monospace"` was chosen to separate
    // metadata from prose, and it does — into a fixed-width block that reads
    // as terminal output. Monospace is for text whose ALIGNMENT carries
    // meaning, which is a diff, and a transcript row is not one. The subtle
    // small treatment separates them just as well and looks like a product.
    items.push(
      text(markers.join("  ·  "), {
        isSubtle: true,
        size: "small",
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
  return cardHeader({
    eyebrow: "History",
    title: chatLabel({ chatId: transcript.chatId, title: transcript.title }),
    subtitle:
      totalCount <= shown
        ? `${String(totalCount)} messages`
        : `${String(Math.max(1, from))}–${String(to)} of ${String(totalCount)}`,
  });
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
            // `↑` kept: it points the same way `OLDER_TITLE` does, and both
            // mean "further back". Direction is meaning here, not decoration.
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
      // Epic sits in the header, NOT between the input and Send. A fact row
      // wedged there separates the button from the thing it acts on, which
      // reads as though it belongs to the button.
      cardHeader({
        eyebrow: "Reply to",
        title: chatLabel(chat),
        subtitle: epicSegment(epicId),
      }),
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
 * One pending approval, actionable.
 *
 * NO LONGER an `attention`-styled header, and this is rule 1's clearest
 * case. The old card opened with a full-bleed pink slab holding two lines,
 * which is the treatment an ERROR gets. An approval is not an error; it is
 * the product working. A salesperson seeing red across the top of a card
 * reads "something has gone wrong", and then has to read the body to find
 * out that nothing has. The signal is carried by one red word in an
 * otherwise neutral header, which is enough — nothing else on any card is
 * red — and the card stops shouting.
 *
 * "AGENT ACTION" IS LOAD-BEARING, not decoration. Settled 2026-08-09: Teams
 * is intake-only and this bot never authorises a customer-facing document.
 * `Edit` as a bare headline is ambiguous about what is being approved — the
 * eyebrow says which kind of thing it is, on the card where confusing the
 * two would be most expensive. The enumeration test asserts no card verb
 * maps to `authorise.mjs` or `closeout.mjs`; this is the same rule stated
 * where a person can see it.
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
      cardHeader({
        eyebrow: "Agent action · approval needed",
        eyebrowColor: "attention",
        title: humaniseToolName(approval.toolName),
        subtitle: chatLabel(chat),
      }),
      ...describeApproval(approval.description),
      metaLine([
        `Requested ${approvalAgeLabel(approval.requestedAt, now)}`,
        epicSegment(epicId),
      ]),
      /*
       * A `TextBlock` LABEL, not `Input.Text.label` — corrected 2026-08-09.
       *
       * `label` on an input is Adaptive Cards **1.3**, and this card declares
       * 1.2. It was the only 1.3 property in the file, and it had been here
       * long enough to look settled: my own screenshots showed the label
       * rendering perfectly, because the local `adaptivecards` library is
       * current and permissive.
       *
       * That is precisely the measurement this file already has a docblock
       * about — "verified in Web Chat was a true measurement of the wrong
       * specimen". A renderer more permissive than Teams cannot tell you what
       * Teams drops. And a dropped label here is not cosmetic: it leaves an
       * unexplained empty box above Approve and Reject, which invites someone
       * to type their reasoning for APPROVING into a field only Reject sends.
       *
       * Raising the version to 1.3 for one property would be the wrong trade
       * on a file whose recorded history is a 1.5 pin rendering every card as
       * "cards.unsupported" on Teams desktop. A TextBlock is 1.0, needs no
       * version change, and is what the interview card already does for its
       * question headings — so this makes the file consistent rather than
       * adding a second convention.
       *
       * Flagged by the opportunity-intake agent, who hit the same 1.2/1.3
       * boundary building the intake form and stayed on the right side of it.
       */
      text("Reason (optional — sent to the agent if you reject)", {
        size: "small",
        isSubtle: true,
        spacing: "medium",
      }),
      {
        type: "Input.Text",
        id: "rejectReason",
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

export const ANSWER_VERB = "traycer/answer";
/** No glyph, for the reason {@link SEND_TITLE} gives. */
export const ANSWER_TITLE = "Send answers";

/**
 * Input id for question `index`. The index — not the `questionId` — because
 * `questionId` is nullable in the protocol and an Adaptive Card input id
 * must exist and be unique. The mapping back to the real question travels in
 * the submit action's own data (see {@link INTERVIEW_QUESTIONS_KEY}).
 */
export function interviewInputId(index: number): string {
  return `answer_${String(index)}`;
}

/** Carries `[{ index, questionId, question, multiSelect }]` as JSON on the submit action. */
export const INTERVIEW_QUESTIONS_KEY = "interviewQuestions";
export const INTERVIEW_BLOCK_KEY = "interviewBlockId";

/**
 * Adaptive Cards joins a multi-select `Input.ChoiceSet`'s chosen values with
 * this, and there is no option to change it. Exported so the dispatcher
 * splits on the same constant the card was built with rather than a second
 * comma typed somewhere else.
 */
export const CHOICE_VALUE_SEPARATOR = ",";

/** Free-text answers get a bound for the same reason messages do — a card is not a document. */
export const MAX_ANSWER_LENGTH = 2_000;

/**
 * One pending interview, ANSWERABLE.
 *
 * This card used to end with "Answering interviews from Teams isn't built
 * yet", which was true and honest for as long as the questions could not
 * reach it: the `interviewRequested` frame carries a block id and a
 * timestamp, so the bot could announce an interview and never render one.
 * The bridge now resolves the questions off the snapshot it already holds.
 *
 * `questions === null` KEEPS THE OLD CARD, deliberately. Null means we do
 * not know what is being asked — an older bridge binary, or a block the
 * bridge could not find in its snapshot. A form under zero questions would
 * submit `answers: []` to an agent waiting for a real answer, which is "the
 * button did nothing" with extra steps. So the refusal is rendered instead,
 * and it names which of the two it is as far as this side can tell.
 */
export function buildInterviewCard(
  chat: ChatRef,
  epicId: string,
  interview: PendingInterview,
  now: number,
): Attachment {
  // `emphasis`, not `attention` — rule 1. A question is not a fault, and the
  // form below it is the longest content on any card here; opening it with a
  // pink slab set the wrong tone for what is really a short survey.
  //
  // The title falls back to the chat rather than disappearing: a header with
  // no subject was leaving "Needs your answer" floating alone above a form.
  const header = cardHeader({
    eyebrow: "Needs your answer",
    eyebrowColor: "attention",
    title: interview.title ?? chatLabel(chat),
    subtitle: interview.title === null ? null : chatLabel(chat),
  });

  const identity = metaLine([
    `Asked ${approvalAgeLabel(interview.requestedAt, now)}`,
    epicSegment(epicId),
  ]);

  const questions = interview.questions;
  if (questions === null || questions.length === 0) {
    return card([
      header,
      text("The agent is waiting on an answer to continue.", {
        spacing: "medium",
      }),
      identity,
      text(
        questions === null
          ? "This one can't be answered from here — its questions didn't reach the bot. Answer it on the desktop."
          : "This interview arrived with no questions, so there is nothing to answer here.",
        { isSubtle: true, size: "small", separator: true, wrap: true },
      ),
    ]);
  }

  return buildCard(
    [
      header,
      ...(interview.description === null
        ? []
        : [text(interview.description, { spacing: "medium", wrap: true })]),
      identity,
      ...questions.flatMap((question, index) =>
        interviewQuestionElements(question, index),
      ),
    ],
    [
      submitAction(
        ANSWER_TITLE,
        ANSWER_VERB,
        {
          chatId: chat.chatId,
          chatTitle: chat.title ?? "",
          [INTERVIEW_BLOCK_KEY]: interview.blockId,
          // The card is the only place that knows which input id belongs to
          // which question, so it says so here rather than leaving the
          // dispatcher to re-derive an ordering it cannot see.
          [INTERVIEW_QUESTIONS_KEY]: JSON.stringify(
            questions.map((question, index) => ({
              index,
              questionId: question.questionId,
              question: question.question,
              multiSelect: question.multiSelect,
            })),
          ),
        },
        // REQUIRED: without it Teams sends the action with none of the
        // selected values, exactly as it does on the composer.
        { associateInputs: true, style: "positive" },
      ),
    ],
  );
}

/**
 * One question as card elements.
 *
 * `options: []` is a FREE-TEXT question, not a broken one — the protocol
 * allows it and an empty `Input.ChoiceSet` would render a picker with
 * nothing in it, which reads as a loading failure.
 */
function interviewQuestionElements(
  question: InterviewQuestion,
  index: number,
): readonly unknown[] {
  const heading = [
    ...(question.header === null
      ? []
      : [
          text(question.header, {
            isSubtle: true,
            size: "small",
            spacing: "medium",
          }),
        ]),
    text(question.question, {
      weight: "bolder",
      wrap: true,
      spacing: question.header === null ? "medium" : "none",
    }),
  ];

  if (question.options.length === 0) {
    return [
      ...heading,
      {
        type: "Input.Text",
        id: interviewInputId(index),
        placeholder: "Type your answer…",
        isMultiline: true,
        maxLength: MAX_ANSWER_LENGTH,
      },
    ];
  }

  return [
    ...heading,
    {
      type: "Input.ChoiceSet",
      id: interviewInputId(index),
      // `expanded` renders radio buttons / checkboxes rather than a dropdown.
      // On a phone a dropdown hides every option but one, and the options are
      // the question — an agent asking "staging or production" should not
      // need a tap to reveal that production is available.
      style: "expanded",
      isMultiSelect: question.multiSelect,
      choices: question.options.map((option) => ({
        // `description`/`preview` have nowhere to go in a ChoiceSet choice —
        // the schema has `title` and `value` only. Folding the description
        // into the title keeps it visible rather than silently dropping it.
        title:
          option.description === null
            ? option.label
            : `${option.label} — ${option.description}`,
        // The VALUE stays the bare label: it is what the agent gets back, and
        // it must not pick up display decoration.
        value: option.label,
      })),
    },
  ];
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
/**
 * The one shape every outcome card has, so the nine of them stop drifting.
 *
 * They were nine hand-built `container([bolder text, body text], {style})`
 * blocks, and they had already drifted: the title was default-size here and
 * `medium` on every other card's header, the body was `isSubtle` on success
 * and not on failure, and the `Code` FactSet appeared on two of three
 * branches. None of that was a decision.
 *
 * A toned container IS correct here and does not breach rule 1 — an outcome
 * card's entire subject is the outcome, and there is exactly one block.
 */
function outcomeCard(
  tone: ContainerStyle & SemanticColor,
  title: string,
  body: string,
  /** Extra blocks below the toned header. Pass `[]` — see `canSend`. */
  extras: readonly unknown[],
): Attachment {
  return card([
    cardHeader({
      eyebrow: null,
      title,
      subtitle: body,
      tone,
    }),
    ...extras,
  ]);
}

/** The machine-readable code, when the host gave one. See `buildPrincipalRefusedCard`. */
function codeFacts(code: string | null): readonly unknown[] {
  return code === null ? [] : [facts([["Code", code]])];
}

export function buildActionOutcomeCard(
  outcome: ActionOutcome,
  decision: "approve" | "reject",
): Attachment {
  const verb = decision === "approve" ? "Approved" : "Rejected";
  switch (outcome.kind) {
    case "applied":
      return outcomeCard(
        "good",
        verb,
        "The agent has been told and should continue.",
        [],
      );
    case "rejected":
      return outcomeCard(
        "warning",
        "The host declined this decision",
        outcome.reason ?? "No reason given.",
        codeFacts(outcome.code),
      );
    case "failed":
      return outcomeCard("attention", "Couldn't confirm this decision", outcome.reason, [
        text(
          "It may or may not have been applied. Open the chat and check before deciding again rather than pressing again.",
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
      return outcomeCard(
        "good",
        "Message sent",
        `Delivered to ${chatLabel(chat)}.`,
        [],
      );
    case "rejected":
      return outcomeCard(
        "warning",
        "The host declined this message",
        outcome.reason ?? "No reason given.",
        codeFacts(outcome.code),
      );
    case "failed":
      return outcomeCard("attention", "Couldn't confirm this message", outcome.reason, [
        text(
          "It may already have reached the agent. Open the chat and check before sending again — a duplicate is a second message the agent will act on, not a no-op.",
          { isSubtle: true, size: "small", spacing: "medium" },
        ),
      ]);
  }
}

/**
 * The result of answering an interview.
 *
 * Separate from {@link buildMessageOutcomeCard} because the `failed` advice
 * is the OPPOSITE one. A message that could not be confirmed may need
 * sending again; an interview must not be answered twice — the host settles
 * it on the block leaving the pending set, so a repeat lands as "not
 * currently pending" and the user has been told to press a button that
 * cannot work.
 */
export function buildInterviewOutcomeCard(
  outcome: ActionOutcome,
  chat: ChatRef,
): Attachment {
  switch (outcome.kind) {
    case "applied":
      return outcomeCard(
        "good",
        "Answers sent",
        `${chatLabel(chat)} can continue.`,
        [],
      );
    case "rejected":
      return outcomeCard(
        "warning",
        "The host declined these answers",
        outcome.reason ?? "No reason given.",
        codeFacts(outcome.code),
      );
    case "failed":
      return outcomeCard("attention", "Couldn't confirm these answers", outcome.reason, [
        text(
          "They may already have reached the agent. Open the chat first — if the interview is gone from the list it landed. Do NOT answer again on the assumption it did not.",
          { isSubtle: true, size: "small", spacing: "medium", wrap: true },
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
    cardHeader({
      eyebrow: null,
      title: "Traycer",
      subtitle: "Ask in your own words, or pick one of these.",
      tone: null,
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
  /**
   * The words the person used, carried through the button.
   *
   * Without this the confirmed dispatch starts an assessment with an EMPTY
   * request: the card knows the route and would have forgotten the question.
   * Capped because card payloads are relayed by Bot Service and an unbounded
   * field is an unbounded payload.
   */
  readonly spokenText?: string;
}): Attachment {
  const canSuggest =
    options.suggestionLabel !== null &&
    options.product !== null &&
    options.intent !== null;

  return card([
    // The QUESTION is the title, not "Before I start". A card that asks
    // something should lead with the thing it is asking — the old version
    // gave the biggest type on the card to a stock phrase and set the actual
    // question in body text below it.
    cardHeader({
      eyebrow: "Before I start",
      title: canSuggest
        ? `Looks like ${options.suggestionLabel ?? ""}. Is that right?`
        : "I'm not sure what you'd like me to do with that.",
      tone: null,
    }),
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
                text: (options.spokenText ?? "").slice(0, 900),
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
      // The assessment's own title is the subject; "Assessment started" is
      // the card kind and belongs in the eyebrow. It was the other way round,
      // so three of these in a thread were indistinguishable at a glance.
      cardHeader({
        eyebrow: "Assessment started",
        eyebrowColor: "good",
        title: options.title,
        subtitle:
          options.deepLink === null
            ? "It's running. I'll reply here when it's done."
            : "It's running — open it to watch progress. I'll reply here when it's done.",
      }),
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

/**
 * The dispatch did not complete — in one of TWO states that must not share a
 * card, because they are the two halves of the distinction this project spent
 * a day getting right in the other direction.
 *
 * `certain: true` — we refused BEFORE creating anything. This path knows.
 * Elliot saw a card headed "Couldn't confirm it started" whose body said "so
 * I haven't started": a definite outcome dressed as an uncertain one, which is
 * the false-success defect mirrored. We made sure `failed` never means "did
 * not apply"; this was `did not apply` reported as `unconfirmed`.
 *
 * `certain: false` — the create was attempted and we did not hear back. The
 * chat may exist.
 *
 * THE RETRY REASONS DIFFER AND THE WRONG ONE IS CONTAGIOUS. When nothing was
 * created, retrying is safe because NOTHING HAPPENED. When a create was
 * attempted, it is safe because `epic.createChat` dedupes on a client-supplied
 * id. The old card gave the idempotency reason in both cases — correct advice
 * with the wrong justification, and the wrong justification is exactly what
 * gets copied to `createArtifact`, where it takes no client id and a retry
 * duplicates.
 */
export function buildAssessmentUnconfirmedCard(
  reason: string,
  options: { readonly certain?: boolean } | undefined,
): Attachment {
  const certain = options?.certain === true;
  return card([
    cardHeader({
      eyebrow: null,
      title: certain ? "I haven’t started" : "Couldn’t confirm it started",
      subtitle: certain
        ? "Nothing was created, so just ask again."
        : "Ask again the same way — it’s the same request, so it can’t start a second assessment.",
      tone: "warning",
    }),
    // The cause, quotable but quiet — it is for whoever gets asked about it,
    // not for the person reading the card.
    metaLine([reason]),
  ]);
}

export function buildEpicPickerCard(epics: readonly EpicSummary[]): Attachment {
  if (epics.length === 0) {
    return card([
      cardHeader({
        eyebrow: null,
        title: "No epics",
        subtitle: "Nothing found for your account.",
        tone: null,
      }),
    ]);
  }
  return card([
    cardHeader({ eyebrow: null, title: "Pick an epic", tone: null }),
    ...epics.map((epic) =>
      container(
        [
          text(epic.title ?? "Untitled epic", {
            weight: "bolder",
            spacing: "none",
          }),
          // The full id, because this is the ONE card where it is an input:
          // the reply is `epic <id>` and a truncated one cannot be typed.
          // Everywhere else it is a label and gets `shortId`.
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
    cardHeader({
      eyebrow: null,
      title: "No epic selected",
      subtitle: 'Use "epic <id>" to choose one, then "fleet" to see its agents.',
    }),
  ]);
}

export function buildEpicBoundCard(epicId: string): Attachment {
  return card([
    cardHeader({
      eyebrow: null,
      title: "Epic selected",
      subtitle: 'Reply "fleet" to see its agents.',
      tone: "good",
    }),
    metaLine([epicId]),
  ]);
}

export function buildPrincipalRefusedCard(reason: RefusalReason): Attachment {
  return card([
    cardHeader({
      eyebrow: null,
      title: "Access denied",
      subtitle: REFUSAL_COPY[reason],
      tone: "attention",
    }),
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
    cardHeader({
      eyebrow: null,
      title: headline,
      subtitle: guidance,
      tone: "warning",
    }),
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
    cardHeader({
      eyebrow: null,
      title: "Read-only from here",
      subtitle: `You can read ${chatLabel(chat)}, but sending needs the host it runs on.`,
    }),
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
  return buildCard(
    [
      cardHeader({
        eyebrow: null,
        title: "That doesn't look like a chat",
        subtitle: `No reachable chat matched “${shortId(chatId)}”.`,
        tone: "warning",
      }),
    ],
    // WAS a FactSet spelling out `say <chat-id> <message>` and `fleet` — a
    // card teaching the CLI, on the card a mistyped CLI command produces.
    // The button is the same recovery without the lesson: it lists the chats
    // there are, which is what the person needed.
    [submitAction("My agents", FLEET_VERB, {}, { associateInputs: false })],
  );
}

/** A recognised command used wrongly — says what was expected instead of silently showing help. */
export function buildUsageCard(usage: string): Attachment {
  return card([
    cardHeader({ eyebrow: null, title: "Not quite", subtitle: usage }),
    /*
     * NOT "Type help for all commands."
     *
     * This card is what a FAILED BUTTON PRESS renders. Telling someone whose
     * button did not work to go and type a command sends them to the CLI we
     * spent the day removing — and it is advice about an interface we no
     * longer document, given at the moment the new one let them down.
     *
     * Elliot saw exactly this: pressing Activity returned
     * `Unknown card action "traycer/log"` followed by an instruction to type.
     *
     * Say what to do instead, in the interface they are already in.
     */
    text("Ask me in your own words and I'll try again.", {
      isSubtle: true,
      size: "small",
    }),
  ]);
}

/** Shown when no verified principal could be obtained. A refusal, not a degraded mode. */
export function buildIdentityUnavailableCard(reason: string): Attachment {
  return card([
    cardHeader({
      eyebrow: null,
      title: "Couldn't verify who you are",
      subtitle: reason,
      tone: "attention",
    }),
  ]);
}

