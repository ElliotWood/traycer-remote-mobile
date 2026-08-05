/**
 * The bridge/bot boundary. Two properties matter and neither is "it parses":
 *
 *   a malformed line is DISTINGUISHABLE from a blank one, because one of
 *   them means somebody is blocked and will never be told;
 *
 *   a line missing a field the send path depends on is REJECTED, rather
 *   than arriving as `undefined` somewhere downstream.
 */
import { describe, expect, it } from "vitest";
import { parseWatchLine } from "../watch-line";

const APPROVAL_LINE = JSON.stringify({
  type: "appeared",
  kind: "approval.requested",
  eventId: "approval.requested:chat-1:ap-1",
  epicId: "epic-1",
  chatId: "chat-1",
  chatTitle: "Build the thing",
  approvalId: "ap-1",
  toolName: "Bash",
  description: "rm -rf /tmp/scratch",
  requestedAt: 1000,
});

describe("blank and malformed are different answers", () => {
  it("separates them, so a dropped notification cannot read as an idle tick", () => {
    /*
     * Mutation: collapse the `blank` branch into `malformed` (or either into
     * a shared `null`). The pair of assertions below stops agreeing.
     *
     * Why it matters: line-buffered stdout produces blanks constantly. If
     * they warn, the journal fills with noise and a real malformed line is
     * invisible in it — the guard defeats itself.
     */
    expect(parseWatchLine("   ").kind).toBe("blank");
    expect(parseWatchLine("{not json").kind).toBe("malformed");
  });

  it("reports a schema failure as malformed rather than silently skipping", () => {
    // Valid JSON, wrong shape — the case a bare try/catch around JSON.parse
    // would let through as a parsed object with undefined fields.
    const result = parseWatchLine(JSON.stringify({ type: "appeared" }));
    expect(result.kind).toBe("malformed");
  });
});

describe("fields the send path depends on are required", () => {
  it("accepts a well-formed approval and preserves its identity fields", () => {
    const result = parseWatchLine(APPROVAL_LINE);
    expect(result.kind).toBe("event");
    if (result.kind !== "event") return;
    expect(result.event.eventId).toBe("approval.requested:chat-1:ap-1");
    expect(result.event.epicId).toBe("epic-1");
  });

  it("rejects an event whose epicId is empty, because routing needs it", () => {
    /*
     * `epicId` is how `pushWatchEvent` finds the conversation to send to. An
     * empty string is not a routing key — it would resolve to `no-route`
     * and be logged as "nobody bound this epic", which is a true sentence
     * about a false premise and sends the reader looking in the wrong place.
     *
     * Mutation: relax `.min(1)` to `z.string()`. This assertion fails.
     */
    const parsed: unknown = JSON.parse(APPROVAL_LINE);
    const line = JSON.stringify({ ...(parsed as object), epicId: "" });
    expect(parseWatchLine(line).kind).toBe("malformed");
  });

  it("accepts a resolved event, which carries identity and nothing else", () => {
    const result = parseWatchLine(
      JSON.stringify({
        type: "resolved",
        kind: "approval.requested",
        eventId: "approval.requested:chat-1:ap-1",
        epicId: "epic-1",
        chatId: "chat-1",
      }),
    );
    expect(result.kind).toBe("event");
  });
});
