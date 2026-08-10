/**
 * The store's job is to survive a restart of THIS process. So every
 * assertion here reopens the store from disk rather than reading the
 * instance that wrote it — an in-memory cache would pass a test that never
 * reconstructs, and the restart is the case the store exists for.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DurableProactiveStore } from "../proactive-store";
import type { StoredConversationReference } from "../../state/conversation-reference-store";

const REFERENCE: StoredConversationReference = {
  channelId: "msteams",
  serviceUrl: "https://smba.example/au/",
  conversation: { id: "conv-1", conversationType: "personal" },
  bot: { id: "agent-1", name: "Traycer" },
  user: { id: "user-1" },
  tenantId: "tenant-1",
  capturedAt: 1,
};

let dir = "";
let targetsPath = "";
let sentPath = "";

beforeEach(() => {
  // Under `tmpdir()` deliberately: a literal drive letter can be a mapped
  // network drive on Windows, and this suite has already lost 21s to SMB
  // resolution on a path chosen for looking obviously invalid.
  dir = mkdtempSync(join(tmpdir(), "proactive-store-"));
  targetsPath = join(dir, "targets.json");
  sentPath = join(dir, "sent.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function open(): DurableProactiveStore {
  return new DurableProactiveStore(targetsPath, sentPath, undefined);
}

describe("routes survive a restart", () => {
  it("recalls a bound target from a store reopened off disk", () => {
    open().bindTarget("epic-1", { reference: REFERENCE, boundAt: 42 });

    const reopened = open();
    expect(reopened.targetFor("epic-1")).toEqual({
      reference: REFERENCE,
      boundAt: 42,
    });
  });

  it("returns null for an epic nobody bound, rather than throwing", () => {
    expect(open().targetFor("epic-unknown")).toBeNull();
  });
});

describe("the sent-set survives a restart, which is the whole point", () => {
  it("still knows an event was sent after reopening", () => {
    /*
     * The bridge re-announces every open approval after ITS restart, and
     * this bot restarts independently. A sent-set that lived only in memory
     * would re-notify every open approval on every bot deploy.
     *
     * Mutation: back `recordSent` with a plain `Map`. This fails.
     */
    open().recordSent("e1", 1000);
    expect(open().hasSent("e1")).toBe(true);
  });

  it("forgets on resolve, so a re-raised id can notify again", () => {
    const store = open();
    store.recordSent("e1", 1000);
    store.forgetSent("e1");
    expect(open().hasSent("e1")).toBe(false);
  });
});

describe("the two stores are independent", () => {
  it("discarding a route does not erase the sent-set, or vice versa", () => {
    /*
     * They answer different questions with different lifetimes. Backing both
     * with one map would make "the app was uninstalled" also mean "re-notify
     * everything that was outstanding" the moment it is reinstalled.
     */
    const store = open();
    store.bindTarget("epic-1", { reference: REFERENCE, boundAt: 42 });
    store.recordSent("e1", 1000);

    store.discardTarget("epic-1");

    const reopened = open();
    expect(reopened.targetFor("epic-1")).toBeNull();
    expect(reopened.hasSent("e1")).toBe(true);
  });
});

describe("delivery honesty", () => {
  it("records sentAt and carries no deliveredAt field at all", () => {
    /*
     * Bot Service offers no delivery receipt — not deferred, unavailable. A
     * field we cannot populate truthfully should not exist, because an
     * absent field makes a reader ask and a plausible one stops them.
     *
     * Asserted on the persisted object's KEYS: a `deliveredAt` added later
     * and left undefined would still fail this.
     */
    const store = open();
    store.recordSent("e1", 1000);
    store.bindTarget("epic-1", { reference: REFERENCE, boundAt: 42 });

    expect(open().sentEventIds()).toEqual(["e1"]);
    const onDisk: unknown = JSON.parse(readFileSync(sentPath, "utf8"));
    const records = onDisk as Record<string, Record<string, unknown>>;
    expect(Object.keys(records["e1"])).toEqual(["sentAt"]);
  });
});
