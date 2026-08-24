import { describe, expect, it } from "vitest";
import { rememberProactiveTarget } from "../remember-target";
import type { ProactiveStore, ProactiveTarget } from "../proactive-store";

/** A real Bot Framework reference, in the shape the SDK actually returns. */
const RAW = {
  channelId: "msteams",
  serviceUrl: "https://smba.example.invalid/au/",
  conversation: { id: "conv-1", conversationType: "personal", tenantId: "t-1" },
  // `agent`, not `bot` — the SDK's v4 rename, which cost a live failure once.
  agent: { id: "28:bot", name: "Traycer" },
  user: { id: "29:1elliot", aadObjectId: "aad-1" },
};

class CountingStore implements ProactiveStore {
  private readonly targets = new Map<string, ProactiveTarget>();
  writes = 0;

  targetFor(epicId: string): ProactiveTarget | null {
    return this.targets.get(epicId) ?? null;
  }
  bindTarget(epicId: string, target: ProactiveTarget): void {
    this.writes += 1;
    this.targets.set(epicId, target);
  }
  discardTarget(epicId: string): void {
    this.targets.delete(epicId);
  }
  boundEpics(): readonly string[] {
    return [...this.targets.keys()];
  }
  hasSent(): boolean {
    return false;
  }
  recordSent(): void {}
  forgetSent(): void {}
  sentEventIds(): readonly string[] {
    return [];
  }
}

const ELLIOT = { id: "29:1elliot", name: "Elliot Wood" };

describe("rememberProactiveTarget — the binding nothing was doing", () => {
  it("binds a route and keeps the mention target with it", () => {
    const store = new CountingStore();
    expect(rememberProactiveTarget(store, "epic-1", RAW, ELLIOT, 1000)).toEqual(
      {
        kind: "bound",
      },
    );

    const target = store.targetFor("epic-1");
    expect(target?.reference.conversation.id).toBe("conv-1");
    expect(target?.boundAt).toBe(1000);
    // The display name lives HERE, not on the shared on-disk reference shape.
    expect(target?.mention).toEqual({ id: "29:1elliot", name: "Elliot Wood" });
  });

  it("CONTRACT: called again with the same turn, it writes NOTHING", () => {
    /*
     * The call site runs on every message in every bound conversation.
     * Writing unconditionally would rewrite a JSON file per message and — the
     * part that actually breaks — would push `boundAt` forward each time,
     * silently converting "when this route was established" into "when we
     * last saw a message".
     */
    const store = new CountingStore();
    rememberProactiveTarget(store, "epic-1", RAW, ELLIOT, 1000);
    expect(store.writes).toBe(1);

    for (let i = 0; i < 5; i++) {
      const result = rememberProactiveTarget(
        store,
        "epic-1",
        RAW,
        ELLIOT,
        2000 + i,
      );
      expect(result).toEqual({ kind: "unchanged" });
    }
    expect(store.writes).toBe(1);
    expect(store.targetFor("epic-1")?.boundAt).toBe(1000);
  });

  it("CONTROL: the idempotence check is not just 'never writes twice'", () => {
    // A guard that returned `unchanged` unconditionally would pass the test
    // above. A genuinely different conversation must still rebind.
    const store = new CountingStore();
    rememberProactiveTarget(store, "epic-1", RAW, ELLIOT, 1000);
    const moved = rememberProactiveTarget(
      store,
      "epic-1",
      { ...RAW, conversation: { ...RAW.conversation, id: "conv-2" } },
      ELLIOT,
      2000,
    );
    expect(moved).toEqual({ kind: "bound" });
    expect(store.targetFor("epic-1")?.boundAt).toBe(2000);
  });

  it("a changed display name rebinds the tag but does NOT reset boundAt", () => {
    // Someone changing their Teams display name has not established a new
    // route, and `boundAt` should not claim they did.
    const store = new CountingStore();
    rememberProactiveTarget(store, "epic-1", RAW, ELLIOT, 1000);
    const renamed = rememberProactiveTarget(
      store,
      "epic-1",
      RAW,
      { id: "29:1elliot", name: "Elliot W" },
      5000,
    );
    expect(renamed).toEqual({ kind: "bound" });
    expect(store.targetFor("epic-1")?.mention?.name).toBe("Elliot W");
    expect(store.targetFor("epic-1")?.boundAt).toBe(1000);
  });

  it("no user is a route with no tag, not a refusal", () => {
    // A notification with no tag still arrives. Refusing to bind would cost
    // the notification entirely, to save the tag.
    const store = new CountingStore();
    expect(rememberProactiveTarget(store, "epic-1", RAW, null, 1000)).toEqual({
      kind: "bound",
    });
    expect(store.targetFor("epic-1")?.mention).toBeUndefined();
  });

  it("CONTRACT: an unusable reference is refused, and nothing is written", () => {
    /*
     * `unusable` rather than a silent no-op: an epic with no route never
     * notifies, and "the bot said nothing" has exactly one other explanation.
     * These have to be distinguishable in the journal.
     */
    const store = new CountingStore();
    for (const raw of [
      null,
      "nonsense",
      {},
      { channelId: "msteams" },
      // No agent/bot — the field whose rename cost a live failure.
      { ...RAW, agent: undefined, bot: undefined },
    ]) {
      expect(
        rememberProactiveTarget(store, "epic-1", raw, ELLIOT, 1000),
        JSON.stringify(raw),
      ).toEqual({ kind: "unusable" });
    }
    expect(store.writes).toBe(0);
  });
});
