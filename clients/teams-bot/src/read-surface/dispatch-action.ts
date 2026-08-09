import type { Attachment } from "@microsoft/agents-activity";
import { z } from "zod";
import {
  ANSWER_VERB,
  CHOICE_VALUE_SEPARATOR,
  INTERVIEW_BLOCK_KEY,
  INTERVIEW_QUESTIONS_KEY,
  MAX_ANSWER_LENGTH,
  buildInterviewOutcomeCard,
  interviewInputId,
  APPROVE_VERB,
  CONFIRM_ROUTE_VERB,
  CLARIFY_OTHER_VERB,
  FLEET_VERB,
  OPEN_CHAT_VERB,
  REPLY_VERB,
  LOG_VERB,
  buildActionOutcomeCard,
  buildIdentityUnavailableCard,
  buildPrincipalRefusedCard,
  buildBridgeUnavailableCard,
  buildEpicNotBoundCard,
  buildUsageCard,
  buildMessageOutcomeCard,
  MAX_MESSAGE_LENGTH,
  MESSAGE_INPUT_ID,
  REJECT_VERB,
  SEND_VERB,
  OLDER_VERB,
  NEWER_VERB,
  FULL_HISTORY_VERB,
  SUBMIT_INTAKE_VERB,
  STAGED_NAMES_KEY,
  TRANSCRIPT_PAGE_SIZE,
  buildIntakeFormCard,
  buildTranscriptCard,
  type ChatRef,
} from "./cards";
import { DEADLINE_TIME_ZONES } from "../intake/deadline";
import { parseIntakeForm, readIntakeFormValues } from "../intake/intake-form";
import {
  submitApprovalDecision,
  submitChatMessage,
  submitInterviewAnswer,
  fetchTranscript,
  type ApprovalDecision,
} from "./host-access";
import type { InterviewAnswerInput } from "./bridge-cli";
import { dispatchCommand, type DispatchDeps } from "./dispatch";

/**
 * T3's `Action.Execute` handler — the write path.
 *
 * Identity is resolved BEFORE the action is issued, exactly as for reads.
 * The verb and approvalId come from the card's own `data`, which Bot Service
 * relays; that is NOT treated as an identity signal, only as *which*
 * approval is being acted on. Who is acting still comes solely from
 * `resolvePrincipal`, so a forged `data` payload can at worst name a
 * different approval id on the acting user's own host — it can never act as
 * someone else.
 */

export interface ActionInvokeRequest {
  readonly verb: string;
  readonly conversationId: string;
  /** The card's `data` merged with any `Input.*` values Teams collected. */
  readonly data: Readonly<Record<string, unknown>>;
  /**
   * Where to send a LATER reply, for actions that start long-running work.
   *
   * `unknown` and optional on purpose. This is the raw Bot Framework
   * conversation reference, and it is DATA rather than SDK machinery — R3
   * writes it to a file and reads it back in a different process, which is
   * the proof. What would break this boundary is a `TurnContext`: a live
   * turn with methods, unmockable. A plain serialisable record is the same
   * kind of thing every other field here already is.
   *
   * Optional because most actions answer within the turn. Anything that
   * replies later needs it — R7's completion delivery and proactive
   * notification both will — so this widens once rather than per feature.
   */
  readonly conversationReference?: unknown;
}

export type ActionInvokeResult = {
  /** Card to render in place of the one that was pressed. */
  readonly card: Attachment;
  /** `false` when the request was malformed or unauthorised rather than acted on. */
  readonly acted: boolean;
};

function readString(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The question list the card put on its own submit action, as parsed back.
 *
 * Validated rather than trusted: this rides in the action payload that Bot
 * Service relays, so it is the same class of input as `chatId`. It cannot
 * name an identity, and a malformed one is refused instead of being coerced
 * into a partial answer set.
 */
const interviewQuestionRefsSchema = z.array(
  z.object({
    index: z.number().int().nonnegative(),
    questionId: z.string().nullable(),
    question: z.string(),
    multiSelect: z.boolean(),
  }),
);

/**
 * The interview path.
 *
 * The guard that does the work is the UNANSWERED check, and it is the same
 * defect as the composer's empty-message guard: `Action.Submit` fires
 * whether or not the user filled anything in, so an accidental tap on an
 * untouched card would otherwise deliver empty answers to an agent that is
 * blocked waiting for real ones — and an interview can be answered exactly
 * once, so there is no second attempt to correct it with.
 *
 * Every question must be answered, and the refusal NAMES the one that
 * isn't. Nothing in the protocol marks a question optional, so "some
 * answers" would be this client inventing a semantics the agent did not ask
 * for.
 */
async function dispatchAnswerInterview(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): Promise<ActionInvokeResult> {
  const chatId = readString(request.data, "chatId");
  const blockId = readString(request.data, INTERVIEW_BLOCK_KEY);
  if (chatId === null || blockId === null) {
    return {
      card: buildUsageCard("That interview card was missing its ids."),
      acted: false,
    };
  }

  const rawQuestions = readString(request.data, INTERVIEW_QUESTIONS_KEY);
  if (rawQuestions === null) {
    return {
      card: buildUsageCard("That interview card was missing its questions."),
      acted: false,
    };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawQuestions);
  } catch {
    return {
      card: buildUsageCard("That interview card's questions were unreadable."),
      acted: false,
    };
  }
  const questions = interviewQuestionRefsSchema.safeParse(parsedJson);
  if (!questions.success || questions.data.length === 0) {
    return {
      card: buildUsageCard("That interview card's questions were unreadable."),
      acted: false,
    };
  }

  const answers: InterviewAnswerInput[] = [];
  for (const ref of questions.data) {
    const raw = (readString(request.data, interviewInputId(ref.index)) ?? "")
      .trim();
    // A multi-select ChoiceSet returns its picks joined by a comma and
    // nothing else — there is no per-value escaping in Adaptive Cards, which
    // is why the choice VALUES are the agent's own option labels rather than
    // anything this client composes.
    const values = ref.multiSelect
      ? raw
          .split(CHOICE_VALUE_SEPARATOR)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : raw.length === 0
        ? []
        : [raw];

    if (values.length === 0) {
      return {
        card: buildUsageCard(
          `Answer every question before sending — "${ref.question}" is still blank.`,
        ),
        acted: false,
      };
    }
    if (raw.length > MAX_ANSWER_LENGTH) {
      return {
        card: buildUsageCard(
          `That answer is ${String(raw.length)} characters; the limit is ${String(MAX_ANSWER_LENGTH)}.`,
        ),
        acted: false,
      };
    }
    answers.push({
      questionId: ref.questionId,
      question: ref.question,
      values,
      notes: null,
    });
  }

  // Identity first — before the answers are issued, never after.
  const identity = await deps.resolvePrincipal();
  if (identity.kind === "unavailable") {
    return {
      card: buildIdentityUnavailableCard(identity.reason),
      acted: false,
    };
  }

  const chat: ChatRef = {
    chatId,
    title: readString(request.data, "chatTitle"),
  };

  const result = await submitInterviewAnswer(
    identity.principal,
    request.conversationId,
    chatId,
    blockId,
    answers,
    deps,
  );

  switch (result.kind) {
    case "ok":
      return {
        card: buildInterviewOutcomeCard(result.outcome, chat),
        acted: true,
      };
    case "principal_refused":
      return { card: buildPrincipalRefusedCard(result.reason), acted: false };
    case "epic_not_bound":
      return { card: buildEpicNotBoundCard(), acted: false };
    case "bridge_unavailable":
      return {
        card: buildBridgeUnavailableCard(result.reason, result.detail),
        acted: false,
      };
  }
}

/**
 * The send path. Same identity ordering as a decision — resolve, then act.
 *
 * The empty-message guard is not defensive padding: `Action.Submit` fires
 * whether or not the user typed anything, so an accidental tap on an
 * untouched composer would otherwise deliver an empty message into a running
 * agent's queue. That is unsendable once away, so it is refused here rather
 * than reported afterwards.
 */
async function dispatchSend(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): Promise<ActionInvokeResult> {
  const chatId = readString(request.data, "chatId");
  if (chatId === null) {
    return {
      card: buildUsageCard("That composer was missing its chat id."),
      acted: false,
    };
  }

  // Trimmed for the emptiness test AND for what is sent: a message that is
  // nothing but a stray newline is the same accident as an empty one.
  const text = (readString(request.data, MESSAGE_INPUT_ID) ?? "").trim();
  if (text.length === 0) {
    return {
      card: buildUsageCard(
        "Nothing to send — type a message before pressing Send.",
      ),
      acted: false,
    };
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      card: buildUsageCard(
        `That message is ${String(text.length)} characters; the limit is ${String(MAX_MESSAGE_LENGTH)}.`,
      ),
      acted: false,
    };
  }

  // Identity first — before the message is issued, never after.
  const identity = await deps.resolvePrincipal();
  if (identity.kind === "unavailable") {
    return {
      card: buildIdentityUnavailableCard(identity.reason),
      acted: false,
    };
  }

  const chat: ChatRef = {
    chatId,
    // The composer knows the title it was rendered with; carrying it back
    // means the outcome card can name the chat without a second host read.
    title: readString(request.data, "chatTitle"),
  };

  const result = await submitChatMessage(
    identity.principal,
    request.conversationId,
    chatId,
    text,
    deps,
  );

  switch (result.kind) {
    case "ok":
      return {
        card: buildMessageOutcomeCard(result.outcome, chat),
        acted: true,
      };
    case "principal_refused":
      return { card: buildPrincipalRefusedCard(result.reason), acted: false };
    case "epic_not_bound":
      return { card: buildEpicNotBoundCard(), acted: false };
    case "bridge_unavailable":
      // NOT "nothing happened": the bridge may have delivered the message
      // before failing. `acted` reports only whether we know an outcome.
      return {
        card: buildBridgeUnavailableCard(result.reason, result.detail),
        acted: false,
      };
  }
}

/**
 * Paging — the one action here that changes nothing.
 *
 * It is still identity-gated, for the same reason the reads are: the offset
 * and chat id arrive in the card payload, and a resolved principal is what
 * decides WHICH HOST is read. Without it a relayed payload could name a chat
 * on a host the presser has no claim to.
 *
 * `acted` is `false` on success, unlike every other branch: nothing was
 * changed. The flag reports mutation, not whether the press worked.
 */
async function dispatchPage(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): Promise<ActionInvokeResult> {
  const chatId = readString(request.data, "chatId");
  if (chatId === null) {
    return {
      card: buildUsageCard("That button was missing its chat id."),
      acted: false,
    };
  }
  // A malformed offset pages from a defined place rather than throwing or
  // silently slicing from the wrong end.
  const rawOffset = Number.parseInt(
    readString(request.data, "offset") ?? "",
    10,
  );
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const identity = await deps.resolvePrincipal();
  if (identity.kind === "unavailable") {
    return {
      card: buildIdentityUnavailableCard(identity.reason),
      acted: false,
    };
  }

  const result = await fetchTranscript(
    identity.principal,
    request.conversationId,
    chatId,
    offset,
    TRANSCRIPT_PAGE_SIZE,
    deps,
  );

  switch (result.kind) {
    case "ok":
      return {
        card: buildTranscriptCard(result.transcript, deps.now()),
        acted: false,
      };
    case "principal_refused":
      return { card: buildPrincipalRefusedCard(result.reason), acted: false };
    case "epic_not_bound":
      return { card: buildEpicNotBoundCard(), acted: false };
    case "bridge_unavailable":
      return {
        card: buildBridgeUnavailableCard(result.reason, result.detail),
        acted: false,
      };
  }
}

/**
 * The names of the staged documents, as the card carried them.
 *
 * DISPLAY ONLY. They label the form so someone can see they attached last
 * quarter's tender; they never decide anything, and the instruction's list
 * comes from reading the staging directory rather than from here — see
 * `start-assessment.ts`. A malformed payload therefore costs a label, not a
 * document.
 */
function readStagedNames(
  data: Readonly<Record<string, unknown>>,
): readonly string[] {
  const raw = readString(data, STAGED_NAMES_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * The route is confirmed — so ASK FOR THE FIVE FIELDS. Nothing starts here.
 *
 * This used to start the agent directly, and that was the gap: `classify`
 * yields product × intent, and `new-bid.mjs` refuses without a slug, a buyer,
 * a deadline carrying an offset, a jurisdiction and a named owner. A confirm
 * button could never have supplied them.
 *
 * READS THE ROUTE FROM THE BUTTON, never from `classify`. The card put
 * `product`, `intent` and `skill` in the action's data precisely so this
 * cannot re-derive them — a handler that re-runs the classifier and reads
 * `suggestion` has silently converted "ask" back into "guess", which is the
 * failure `classify` has a dedicated test against.
 *
 * A missing skill is REFUSED rather than dispatched. `classify` reports a
 * known route with `skill: null` when no skill is built for it — a DR Migrate
 * RFP, today — and opening a form for work nothing can perform wastes the
 * user's typing as well as the agent's time.
 */
function dispatchConfirmedRoute(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): ActionInvokeResult {
  const skill = readString(request.data, "skill");
  if (skill === null) {
    return {
      card: buildUsageCard(
        "There's no assessment skill configured for that yet, so I haven't started one.",
      ),
      acted: false,
    };
  }
  if (deps.startAssessment === undefined) {
    // Wired at composition time. Absent means the deployment cannot start
    // assessments, and saying so beats a form that appears to work.
    return {
      card: buildUsageCard("This deployment can't start assessments yet."),
      acted: false,
    };
  }

  return {
    card: buildIntakeFormCard({
      product: readString(request.data, "product") ?? "",
      intent: readString(request.data, "intent") ?? "",
      skill,
      routeLabel: null,
      spokenText: readString(request.data, "text") ?? "",
      stagingId: readString(request.data, "stagingId") ?? "",
      stagedNames: readStagedNames(request.data),
      values: {
        slug: "",
        buyer: "",
        deadlineDate: "",
        deadlineTime: "",
        // Preselected ONLY when the deployment configured one. Absent means
        // the user chooses, which is the safe direction: a wrong offset is
        // invisible and a missing one is a red message on the card.
        timeZone: deps.defaultTimeZone ?? "",
        jurisdiction: "",
        // The prefill Elliot settled on: the person who @-mentioned the bot,
        // confirmable or replaceable, never silently used.
        owner: readString(request.data, "requesterName") ?? "",
      },
      errors: [],
      timeZones: DEADLINE_TIME_ZONES,
    }),
    // Nothing was mutated, and nothing failed — a form was opened.
    acted: true,
  };
}

/**
 * The intake form was submitted. THIS is where an agent starts.
 *
 * Validation runs BEFORE identity, unlike every other action in this file,
 * and the difference is deliberate: a malformed form is answered by
 * re-rendering it, which needs no host and no principal. Resolving identity
 * first would mean a user with a typo'd slug is told their sign-in is broken.
 * Nothing has been issued at that point, so nothing is at risk.
 *
 * On failure the form comes back WITH WHAT THEY TYPED. A form that clears
 * itself on a validation error is a form people abandon.
 */
async function dispatchSubmitIntake(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): Promise<ActionInvokeResult> {
  const skill = readString(request.data, "skill");
  if (skill === null) {
    return {
      card: buildUsageCard("That form was missing which assessment to run."),
      acted: false,
    };
  }
  if (deps.startAssessment === undefined) {
    return {
      card: buildUsageCard("This deployment can't start assessments yet."),
      acted: false,
    };
  }

  const values = readIntakeFormValues(request.data);
  const parsed = parseIntakeForm(values, deps.now());
  if (parsed.kind === "invalid") {
    return {
      card: buildIntakeFormCard({
        product: readString(request.data, "product") ?? "",
        intent: readString(request.data, "intent") ?? "",
        skill,
        routeLabel: null,
        spokenText: readString(request.data, "text") ?? "",
        stagingId: readString(request.data, "stagingId") ?? "",
        stagedNames: readStagedNames(request.data),
        values: parsed.values,
        errors: parsed.errors,
        timeZones: DEADLINE_TIME_ZONES,
      }),
      // NOT acted: nothing was started. The form is a refusal, not a result.
      acted: false,
    };
  }

  const outcome = await deps.startAssessment({
    conversationId: request.conversationId,
    skill,
    product: readString(request.data, "product") ?? "",
    intent: readString(request.data, "intent") ?? "",
    conversationReference: request.conversationReference,
    spokenText: readString(request.data, "text") ?? "",
    opportunity: parsed.details,
    stagingId: readString(request.data, "stagingId") ?? "",
  });

  return outcome.kind === "started"
    ? { card: outcome.card, acted: true }
    : { card: outcome.card, acted: false };
}

/**
 * Every verb {@link dispatchActionInvoke} routes, in ONE place next to the
 * routing itself.
 *
 * The card test used to keep its own hand-copied list, and its own docblock
 * had already spotted the flaw — "an allow-list is only as good as the claim
 * behind each entry, and the entry that lies is invisible". What it did not
 * spot is the other direction: the list was missing `traycer/answer`,
 * `traycer/confirmRoute` and `traycer/clarifyOther`, all of which ARE
 * handled here. The test passed anyway, because it only walked two cards and
 * neither of them emits those.
 *
 * Living here means adding a verb to the dispatcher and forgetting the test
 * is no longer possible in the direction that matters: a card emitting a verb
 * absent from this set fails, and this set is what you edit when you add a
 * branch below. `dispatch-action.test.ts` asserts every entry actually
 * resolves to something other than "Unknown card action", so an entry that
 * lies is no longer invisible either.
 */
export const HANDLED_ACTION_VERBS: ReadonlySet<string> = new Set([
  APPROVE_VERB,
  REJECT_VERB,
  SEND_VERB,
  ANSWER_VERB,
  OLDER_VERB,
  NEWER_VERB,
  FULL_HISTORY_VERB,
  FLEET_VERB,
  REPLY_VERB,
  LOG_VERB,
  OPEN_CHAT_VERB,
  CONFIRM_ROUTE_VERB,
  CLARIFY_OTHER_VERB,
  /*
   * Added when `autobuild/opportunity-intake` merged, 2026-08-09, and it is
   * the exact failure this set exists to make impossible.
   *
   * The intake branch added a `SUBMIT_INTAKE_VERB` branch to
   * `dispatchActionInvoke` below and put the verb in the card test's own
   * hand-typed copy of this list — the copy this docblock had just finished
   * arguing against. Merged as-was, the tree would have had a verb that IS
   * dispatched and IS NOT declared handled, with a green suite either way:
   * the copy said it was handled, and the contract check that reads THIS set
   * did not walk the intake form. Both branches were green in isolation and
   * the disagreement only existed in the merge.
   */
  SUBMIT_INTAKE_VERB,
]);

export async function dispatchActionInvoke(
  request: ActionInvokeRequest,
  deps: DispatchDeps,
): Promise<ActionInvokeResult> {
  if (request.verb === CONFIRM_ROUTE_VERB) {
    return dispatchConfirmedRoute(request, deps);
  }
  if (request.verb === SUBMIT_INTAKE_VERB) {
    return dispatchSubmitIntake(request, deps);
  }
  if (request.verb === CLARIFY_OTHER_VERB) {
    return {
      card: buildUsageCard(
        "No problem — tell me what you'd like me to do with it.",
      ),
      // Nothing was mutated, and nothing failed. The user declined a
      // suggestion, which is the flow working.
      acted: true,
    };
  }
  if (request.verb === SEND_VERB) {
    return dispatchSend(request, deps);
  }
  if (request.verb === ANSWER_VERB) {
    return dispatchAnswerInterview(request, deps);
  }
  if (
    request.verb === OLDER_VERB ||
    request.verb === NEWER_VERB ||
    request.verb === FULL_HISTORY_VERB
  ) {
    return dispatchPage(request, deps);
  }
  // Buttons that are just a command someone would otherwise have typed.
  // Routed through the same `dispatchCommand` the text path uses, so a button
  // and its retired command cannot diverge — one behaviour, two ingresses.
  if (
    request.verb === FLEET_VERB ||
    request.verb === REPLY_VERB ||
    request.verb === LOG_VERB ||
    request.verb === OPEN_CHAT_VERB
  ) {
    /*
     * `Reply` IS `compose <id>`, NOT `chat <id>` — corrected 2026-08-09.
     *
     * It was `chat <id>`, and the comment here said so on the grounds that
     * "whose card carries the composer". `dispatchCommand` does return a
     * composer for `chat` — as the LAST of up to five cards. This path takes
     * `cards[0]` and drops the rest. So the button labelled Reply returned
     * the status card and nothing else: no composer, no reply box, nothing
     * to type into.
     *
     * That is the `Action.Execute` failure in a different costume — the
     * button renders, it is pressable, it appears to work, and the thing it
     * promised is not there. It survived because the CLAIM in the comment was
     * true about `dispatchCommand` and false about this call site, which is
     * two lines below it.
     *
     * `compose` returns exactly one card and that card is the reply box. The
     * two ingresses still cannot drift, because it is still the same command
     * a person could type.
     */
    let command: Parameters<typeof dispatchCommand>[0];
    if (request.verb === FLEET_VERB) {
      command = { kind: "fleet" };
    } else {
      const chatId = readString(request.data, "chatId");
      if (chatId === null) {
        return {
          card: buildUsageCard("That button was missing its chat id."),
          acted: false,
        };
      }
      if (request.verb === REPLY_VERB) {
        command = { kind: "compose", chatId };
      } else if (request.verb === OPEN_CHAT_VERB) {
        command = { kind: "chat", chatId };
      } else {
        command = { kind: "log", chatId, offset: 0 };
      }
    }
    const cards = await dispatchCommand(
      command,
      request.conversationId,
      deps,
    );
    const card = cards[0];
    if (card === undefined) {
      return {
        card: buildUsageCard("That didn't return anything to show."),
        acted: false,
      };
    }
    return { card, acted: true };
  }

  if (request.verb !== APPROVE_VERB && request.verb !== REJECT_VERB) {
    return {
      card: buildUsageCard(`Unknown card action "${request.verb}".`),
      acted: false,
    };
  }

  const approvalId = readString(request.data, "approvalId");
  if (approvalId === null) {
    return {
      card: buildUsageCard("That button was missing its approval id."),
      acted: false,
    };
  }

  // Identity first — before the action is issued, never after.
  const identity = await deps.resolvePrincipal();
  if (identity.kind === "unavailable") {
    return {
      card: buildIdentityUnavailableCard(identity.reason),
      acted: false,
    };
  }

  const decision: ApprovalDecision =
    request.verb === APPROVE_VERB
      ? { kind: "approve" }
      : { kind: "reject", reason: readString(request.data, "rejectReason") };

  const result = await submitApprovalDecision(
    identity.principal,
    request.conversationId,
    approvalId,
    decision,
    deps,
  );

  switch (result.kind) {
    case "ok":
      return {
        card: buildActionOutcomeCard(result.outcome, decision.kind, {
          // The approval card put `chatId` in its own action data, so the
          // outcome card can offer the way back to the chat its copy tells
          // the reader to open. `""` when a card predates that, which
          // `openChatAction` renders as no button rather than a dead one.
          chatId: readString(request.data, "chatId") ?? "",
          title: readString(request.data, "chatTitle"),
        }),
        acted: true,
      };
    case "principal_refused":
      return { card: buildPrincipalRefusedCard(result.reason), acted: false };
    case "epic_not_bound":
      return { card: buildEpicNotBoundCard(), acted: false };
    case "bridge_unavailable":
      // NOT `acted: false` in the sense of "nothing happened" — the bridge
      // may have issued the action before failing. The card says so; this
      // flag only reports whether we know an outcome.
      return {
        card: buildBridgeUnavailableCard(result.reason, result.detail),
        acted: false,
      };
  }
}
