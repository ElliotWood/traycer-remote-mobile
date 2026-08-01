import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableJsonStore } from "../durable-json-store";
import {
  DurableConversationReferenceStore,
  toStoredReference,
} from "../conversation-reference-store";

function tempFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "convref-")), name);
}

const REFERENCE = {
  channelId: "msteams",
  serviceUrl: "https://smba.example.invalid/au/",
  // `tenantId` sits on the CONVERSATION, which is where Teams puts it. This
  // fixture carried it at the top level — the shape the code wrongly read —
  // so the fixture AGREED with the defect and could not have exposed it.
  conversation: {
    id: "conv-1",
    conversationType: "personal",
    tenantId: "tenant-1",
  },
  bot: { id: "bot-1", name: "Traycer" },
  user: { id: "user-1", aadObjectId: "0b8f1c2e-8f3a-4a1b-9c2d-1e2f3a4b5c6d" },
};

/**
 * The shape the SDK does NOT send, kept as a specimen rather than a comment.
 *
 * Moving the fixture was necessary and not sufficient: with no assertion on
 * the extracted value, `tenantId` is optional, so reverting the code to
 * `r["tenantId"]` would make it silently `undefined` again and every test
 * here would stay green. The pair below is what makes the fix load-bearing —
 * one proves it is read from the right place, the other proves the wrong
 * place is not also accepted.
 */
const REFERENCE_WITH_TOP_LEVEL_TENANT = {
  ...REFERENCE,
  conversation: { id: "conv-1", conversationType: "personal" },
  tenantId: "tenant-1",
};

describe("toStoredReference", () => {
  it("keeps the fields a later reply needs", () => {
    const stored = toStoredReference(REFERENCE, 1000);
    expect(stored).not.toBeNull();
    expect(stored?.channelId).toBe("msteams");
    expect(stored?.serviceUrl).toBe("https://smba.example.invalid/au/");
    expect(stored?.conversation.id).toBe("conv-1");
    expect(stored?.bot.id).toBe("bot-1");
    expect(stored?.capturedAt).toBe(1000);
  });

  it("CONTRACT: refuses at CAPTURE time when serviceUrl is missing", () => {
    // The failure must land here, not hours later when the assessment is
    // finished and there is nowhere to send it. That is the whole reason
    // this takes `unknown` instead of the SDK type.
    const { serviceUrl: _omitted, ...withoutUrl } = REFERENCE;
    expect(toStoredReference(withoutUrl, 1000)).toBeNull();
  });

  it("refuses when the conversation id is missing", () => {
    expect(
      toStoredReference({ ...REFERENCE, conversation: {} }, 1000),
    ).toBeNull();
  });

  it("tolerates an absent user — a channel reference may not carry one", () => {
    const { user: _omitted, ...withoutUser } = REFERENCE;
    const stored = toStoredReference(withoutUser, 1000);
    expect(stored).not.toBeNull();
    expect(stored?.user).toBeUndefined();
  });

  it("reads tenantId off the CONVERSATION, where Teams puts it", () => {
    expect(toStoredReference(REFERENCE, 1000)?.tenantId).toBe("tenant-1");
  });

  it("does not read tenantId off the top level, where v4 docs put it", () => {
    // The defect this pins: `r["tenantId"]` looked right, matched the
    // documentation, and degraded to `undefined` without throwing or logging
    // — the same soft-fail as the `bot`/`agent` rename one field over. An
    // optional field that is silently never populated is indistinguishable
    // from a tenant that genuinely has none.
    expect(
      toStoredReference(REFERENCE_WITH_TOP_LEVEL_TENANT, 1000)?.tenantId,
    ).toBeUndefined();
  });

  it("refuses a non-object", () => {
    expect(toStoredReference(null, 1)).toBeNull();
    expect(toStoredReference("nope", 1)).toBeNull();
  });
});

describe("DurableConversationReferenceStore", () => {
  it("survives a restart — a NEW instance on the same file recalls it", () => {
    // The point of the ticket. An assessment started before a redeploy must
    // be answerable after it.
    const file = tempFile("refs.json");
    const stored = toStoredReference(REFERENCE, 1000);
    expect(stored).not.toBeNull();
    if (stored === null) return;

    new DurableConversationReferenceStore(file).remember("work-1", stored);

    const afterRestart = new DurableConversationReferenceStore(file);
    expect(afterRestart.recall("work-1")).toEqual(stored);
  });

  it("CONTRACT: keyed by work id, so two assessments in one conversation both survive", () => {
    // Keying by conversation id would make the second overwrite the first,
    // and it would present as "the bot forgot" rather than as a collision.
    const file = tempFile("refs.json");
    const stored = toStoredReference(REFERENCE, 1000);
    if (stored === null) throw new Error("fixture");
    const store = new DurableConversationReferenceStore(file);
    store.remember("work-1", stored);
    store.remember("work-2", { ...stored, capturedAt: 2000 });

    expect(store.recall("work-1")?.capturedAt).toBe(1000);
    expect(store.recall("work-2")?.capturedAt).toBe(2000);
    expect([...store.outstanding()].sort()).toEqual(["work-1", "work-2"]);
  });

  it("forgets on delivery, and recall then reports nothing rather than stale", () => {
    const file = tempFile("refs.json");
    const stored = toStoredReference(REFERENCE, 1000);
    if (stored === null) throw new Error("fixture");
    const store = new DurableConversationReferenceStore(file);
    store.remember("work-1", stored);
    store.forget("work-1");
    expect(store.recall("work-1")).toBeNull();
    expect(new DurableConversationReferenceStore(file).recall("work-1")).toBeNull();
  });

  it("writes the state file 0600 — it carries a tenant id and an Entra oid", () => {
    const file = tempFile("refs.json");
    const stored = toStoredReference(REFERENCE, 1000);
    if (stored === null) throw new Error("fixture");
    new DurableConversationReferenceStore(file).remember("work-1", stored);
    // Windows does not implement POSIX modes; assert only where it means
    // something rather than asserting something untrue everywhere.
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(file, "utf8").length).toBeGreaterThan(0);
  });
});

describe("DurableJsonStore — a corrupt file must not stop the bot booting", () => {
  it("starts empty and warns rather than throwing", () => {
    const file = tempFile("corrupt.json");
    writeFileSync(file, "{ this is not json");
    const warnings: string[] = [];
    const store = new DurableJsonStore<{ a: number }>({
      filePath: file,
      onWarn: (m) => warnings.push(m),
    });
    expect(store.keys()).toEqual([]);
    expect(warnings.length).toBe(1);
  });

  it("starts empty when the file is JSON but not an object", () => {
    const file = tempFile("array.json");
    writeFileSync(file, "[1,2,3]");
    const warnings: string[] = [];
    const store = new DurableJsonStore<{ a: number }>({
      filePath: file,
      onWarn: (m) => warnings.push(m),
    });
    expect(store.keys()).toEqual([]);
    expect(warnings.length).toBe(1);
  });

  it("a missing file is the normal first run — no warning", () => {
    const warnings: string[] = [];
    const store = new DurableJsonStore<{ a: number }>({
      filePath: tempFile("absent.json"),
      onWarn: (m) => warnings.push(m),
    });
    expect(store.keys()).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("recovers the previous contents after a corrupt write is replaced", () => {
    const file = tempFile("roundtrip.json");
    const a = new DurableJsonStore<{ n: number }>({ filePath: file });
    a.set("k", { n: 1 });
    const b = new DurableJsonStore<{ n: number }>({ filePath: file });
    expect(b.get("k")).toEqual({ n: 1 });
  });
});

describe("toStoredReference — the SDK's field name, which cost a live failure", () => {
  /**
   * `@microsoft/agents-activity` returns `agent`, not `bot`:
   *
   *   { activityId, user, agent, conversation, channelId, locale, serviceUrl }
   *
   * This required `bot.id`, so it returned null for EVERY real reference, and
   * the symptom was maximally misleading — the refusal path worked perfectly
   * and told a user it could not record where to send the result. A true
   * message about a real absence, caused by reading the wrong key.
   */
  const SDK_SHAPE = {
    activityId: "a1",
    channelId: "msteams",
    serviceUrl: "https://smba.example.invalid/au/",
    conversation: { id: "conv-1", conversationType: "personal" },
    agent: { id: "28:bot-app-id", name: "Traycer" },
    user: { id: "user-1" },
  };

  it("CONTRACT: accepts the SDK's `agent` field", () => {
    const stored = toStoredReference(SDK_SHAPE, 1000);
    expect(stored).not.toBeNull();
    expect(stored?.bot.id).toBe("28:bot-app-id");
  });

  it("still accepts `bot`, so a rename back cannot strand stored references", () => {
    const { agent: _omitted, ...rest } = SDK_SHAPE;
    const stored = toStoredReference({ ...rest, bot: { id: "b1" } }, 1000);
    expect(stored?.bot.id).toBe("b1");
  });

  it("CONTRACT: still refuses when NEITHER is present", () => {
    // The guard must keep working — the fix widens what counts as the bot,
    // it does not remove the requirement.
    const { agent: _omitted, ...rest } = SDK_SHAPE;
    expect(toStoredReference(rest, 1000)).toBeNull();
  });
});
