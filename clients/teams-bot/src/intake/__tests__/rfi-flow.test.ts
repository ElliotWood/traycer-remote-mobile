/**
 * The RFI path end to end, from the bytes on the wire to the argv the bridge
 * is spawned with.
 *
 * This test exists because of the shape of defect this package keeps
 * producing: a write path that was "complete, tested, and connected to an
 * ingress nothing could reach" (`read-surface-handler.ts` records the
 * `Action.Execute` version at length), and a `buildInstruction` that was
 * correct about a count nothing ever supplied. Both were fully unit-tested.
 * Neither worked.
 *
 * So this asserts the SEAMS, not the units: the download URL turns into
 * bytes, the bytes turn into a path, the card carries a handle rather than
 * the URL, and the path arrives in the message the skill actually receives.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestAttachments, type FetchFn } from "../attachment-fetch";
import { FileIntakeStore } from "../intake-store";
import { createStartAssessment } from "../start-assessment";
import { dispatchActionInvoke } from "../../read-surface/dispatch-action";
import { CONFIRM_ROUTE_VERB, buildClarifyCard } from "../../read-surface/cards";
import { DurableConversationReferenceStore } from "../../state/conversation-reference-store";
import type { OneShotSpawnFn } from "../../read-surface/one-shot-spawn";
import type { DispatchDeps } from "../../read-surface/dispatch";

const HOST = "contoso.sharepoint.com";
/** The query string is the authorisation. It must not survive into the card. */
const DOWNLOAD_URL = `https://${HOST}/personal/e/_layouts/download.aspx?UniqueId=1&access_token=CAPABILITY-TOKEN`;
const DOC_NAME = "Retail Presentation.pptx";
/** A PKZip header — what a real .pptx starts with, so "did the bytes survive" is checkable. */
const PPTX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

const REFERENCE = {
  channelId: "msteams",
  serviceUrl: "https://smba.example.invalid/au/",
  conversation: { id: "conv-1", conversationType: "personal" },
  agent: { id: "bot-1" },
  user: { id: "user-1" },
};

function teamsFileAttachment(): unknown {
  return {
    contentType: "application/vnd.microsoft.teams.file.download.info",
    name: DOC_NAME,
    contentUrl: `https://${HOST}/personal/e/Documents/Microsoft Teams Chat Files/${DOC_NAME}`,
    content: { downloadUrl: DOWNLOAD_URL, uniqueId: "u-1", fileType: "pptx" },
  };
}

/** Records every bridge argv, and answers create-chat / send the way the CLI does. */
function recordingSpawn(): {
  readonly spawnFn: OneShotSpawnFn;
  readonly calls: string[][];
} {
  const calls: string[][] = [];
  const spawnFn: OneShotSpawnFn = (_command, args) => {
    calls.push([...args]);
    if (args[0] === "create-chat") {
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ chatId: args[1] }),
        stderr: "",
        timedOut: false,
      });
    }
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({ kind: "applied" }),
      stderr: "",
      timedOut: false,
    });
  };
  return { spawnFn, calls };
}

function harness(): {
  readonly deps: DispatchDeps;
  readonly calls: string[][];
  readonly intakeRoot: string;
} {
  const intakeRoot = mkdtempSync(join(tmpdir(), "rfi-"));
  const { spawnFn, calls } = recordingSpawn();
  const startAssessment = createStartAssessment({
    references: new DurableConversationReferenceStore(
      join(mkdtempSync(join(tmpdir(), "rfi-refs-")), "refs.json"),
      undefined,
    ),
    intake: new FileIntakeStore(intakeRoot),
    hostId: "host-1",
    epicId: "epic-1",
    tabBaseUrl: "https://tab.example.invalid",
    bridgeCliConfig: { command: "/bin/bridge", timeoutMs: 1000, spawnFn },
    buildEnv: () => Promise.resolve({}),
    now: () => 1000,
  });
  // Only `startAssessment` is exercised here; the rest of DispatchDeps is
  // unreachable on this verb and is deliberately not stubbed into existence.
  const deps = { startAssessment } as unknown as DispatchDeps;
  return { deps, calls, intakeRoot };
}

/** The message turn: fetch the file and store it, exactly as `index.ts` composes it. */
async function ingestTurn(
  intakeRoot: string,
  bytes: Uint8Array,
): Promise<{ readonly intakeId: string; readonly fileCount: number }> {
  const fetchFn = vi
    .fn<FetchFn>()
    .mockResolvedValue(new Response(bytes, { status: 200 }));
  const result = await ingestAttachments([teamsFileAttachment()], { fetchFn });
  const record = new FileIntakeStore(intakeRoot).put({
    fetched: result.fetched,
    unavailable: result.unavailable,
    now: 1000,
  });
  return { intakeId: record.intakeId, fileCount: record.files.length };
}

describe("RFI flow: Teams attachment to the skill's first message", () => {
  it("CONTRACT: the instruction the skill receives names a path holding the real bytes", async () => {
    const { deps, calls, intakeRoot } = harness();
    const intake = await ingestTurn(intakeRoot, PPTX_BYTES);

    const result = await dispatchActionInvoke(
      {
        verb: CONFIRM_ROUTE_VERB,
        conversationId: "conv-1",
        data: {
          product: "sensormine",
          intent: "new-opportunity",
          skill: "smv4-new-opportunity",
          text: "does this RFI fit SensorMine?",
          intakeId: intake.intakeId,
        },
        conversationReference: REFERENCE,
      },
      deps,
    );
    expect(result.acted).toBe(true);

    const send = calls.find((args) => args[0] === "send");
    if (send === undefined) throw new Error("the bridge was never asked to send");
    const instruction = send[2] ?? "";

    // The skill is told the file name AND a path.
    expect(instruction).toContain(DOC_NAME);
    const match = /- .* — (.+)$/m.exec(instruction);
    if (match?.[1] === undefined) {
      throw new Error(`no path in the instruction:\n${instruction}`);
    }
    // And that path holds the bytes that came off the wire, unchanged.
    expect(Array.from(readFileSync(match[1].trim()))).toEqual(
      Array.from(PPTX_BYTES),
    );
    // NOT the old lie.
    expect(instruction).not.toContain("No documents were attached");
  });

  it("CONTRACT: the capability URL never reaches the card or the bridge argv", async () => {
    // A Teams downloadUrl authorises anyone holding it. Putting it in card
    // data relays it out to Bot Service and back through an ingress we do not
    // own; putting it in argv writes it to any process listing.
    const { deps, calls, intakeRoot } = harness();
    const intake = await ingestTurn(intakeRoot, PPTX_BYTES);

    const card = buildClarifyCard({
      suggestionLabel: "a SensorMine opportunity",
      product: "sensormine",
      intent: "new-opportunity",
      skill: "smv4-new-opportunity",
      spokenText: "does this RFI fit SensorMine?",
      intakeId: intake.intakeId,
      attachmentCount: intake.fileCount,
    });
    const cardJson = JSON.stringify(card);
    expect(cardJson).not.toContain("CAPABILITY-TOKEN");
    expect(cardJson).not.toContain("download.aspx");
    expect(cardJson).not.toContain(HOST);
    // The handle IS there — that is what replaces it.
    expect(cardJson).toContain(intake.intakeId);

    await dispatchActionInvoke(
      {
        verb: CONFIRM_ROUTE_VERB,
        conversationId: "conv-1",
        data: {
          product: "sensormine",
          intent: "new-opportunity",
          skill: "smv4-new-opportunity",
          text: "x",
          intakeId: intake.intakeId,
        },
        conversationReference: REFERENCE,
      },
      deps,
    );
    const argv = JSON.stringify(calls);
    expect(argv).not.toContain("CAPABILITY-TOKEN");
    expect(argv).not.toContain("download.aspx");
  });

  it("CONTRACT: a lost intake refuses instead of quietly starting without the file", async () => {
    // The defect being fixed was `?? 0` turning every absent value into a
    // confident "No documents were attached." A handle we issued and cannot
    // resolve means we LOST the user's file, and that must not look identical
    // to a request that never had one.
    const { deps, calls } = harness();

    const result = await dispatchActionInvoke(
      {
        verb: CONFIRM_ROUTE_VERB,
        conversationId: "conv-1",
        data: {
          product: "sensormine",
          intent: "new-opportunity",
          skill: "smv4-new-opportunity",
          text: "x",
          intakeId: "11111111-2222-3333-4444-555555555555",
        },
        conversationReference: REFERENCE,
      },
      deps,
    );
    expect(result.acted).toBe(false);
    expect(JSON.stringify(result.card)).toMatch(/couldn't find the file/i);
    // Nothing was created. The refusal is before the create, which is what
    // lets the card say so with certainty.
    expect(calls).toEqual([]);
  });

  it("a message with no attachment still starts, and says so honestly", async () => {
    const { deps, calls } = harness();
    const result = await dispatchActionInvoke(
      {
        verb: CONFIRM_ROUTE_VERB,
        conversationId: "conv-1",
        data: {
          product: "sensormine",
          intent: "new-opportunity",
          skill: "smv4-new-opportunity",
          text: "does SensorMine do vibration?",
          // No intakeId at all — the pre-intake card shape.
        },
        conversationReference: REFERENCE,
      },
      deps,
    );
    expect(result.acted).toBe(true);
    const send = calls.find((args) => args[0] === "send");
    expect(send?.[2]).toContain("No documents were attached");
  });

  it("CONTRACT: a channel file the bot cannot fetch is named, not silently dropped", async () => {
    const { deps, calls, intakeRoot } = harness();
    const result = await ingestAttachments(
      [
        {
          contentType: "application/vnd.microsoft.teams.file.info",
          name: "Channel Deck.pptx",
        },
      ],
      {},
    );
    const record = new FileIntakeStore(intakeRoot).put({
      fetched: result.fetched,
      unavailable: result.unavailable,
      now: 1000,
    });

    await dispatchActionInvoke(
      {
        verb: CONFIRM_ROUTE_VERB,
        conversationId: "conv-1",
        data: {
          product: "sensormine",
          intent: "new-opportunity",
          skill: "smv4-new-opportunity",
          text: "assess this",
          intakeId: record.intakeId,
        },
        conversationReference: REFERENCE,
      },
      deps,
    );
    const send = calls.find((args) => args[0] === "send");
    expect(send?.[2]).toContain("Channel Deck.pptx");
    expect(send?.[2]).toMatch(/could not be retrieved/i);
  });
});
