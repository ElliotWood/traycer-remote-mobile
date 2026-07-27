// @vitest-environment node
/**
 * Sprint 2 real-content robustness (LIVE_HOST-gated, permanent — not a
 * throwaway probe). Opens `chat.subscribe` against a real chat with rich,
 * varied block content and proves the full pipeline end to end against real
 * data: no throw, no silent drop (`partitionBlocks`'s `dropped` bucket is
 * empty), and the block-type set the Evaluator found present is covered.
 *
 * `@vitest-environment node`, NOT jsdom: jsdom's `Event`/`EventTarget`
 * polyfills collide with Node's native WebSocket (undici) — real WebSocket
 * networking must run in plain Node (mirrors the pre-Sprint-1 live probes).
 * The render check therefore uses `renderToStaticMarkup` (works in plain
 * Node, no DOM needed) rather than `@testing-library/react`'s `render`.
 *
 * Skipped by default (`vitest run` stays green with 0 unexpected skips —
 * this is the one intentional skip); run explicitly with `LIVE_HOST=1`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WsStreamClient } from "@traycer-clients/shared/host-transport/ws-stream-client";
import { createWhatwgStreamWebSocketFactory } from "@traycer-clients/shared/host-transport/whatwg-stream-ws-factory";
import { DEFAULT_DIAL_TIMEOUT_MS } from "@traycer-clients/shared/host-transport/transport-config";
import type { ChatStreamCallbacks } from "@traycer-clients/shared/host-transport/chat-stream-client";
import type { ChatSnapshot } from "@traycer/protocol/host/agent/gui/subscribe";
import { hostStreamRpcRegistry } from "@traycer/protocol/host/registry";
import type { ContentBlock } from "@traycer/protocol/persistence/epic/content-blocks";
import { MobileAuthService, type StorageLike } from "@/host/auth-service";
import { openChatStream, createStreamAuthRevalidator } from "@/host/stream-connection";
import { partitionBlocks } from "@/views/chat/transcript-model";
import { TranscriptView } from "@/views/chat/transcript-view";

const HOST_WS = process.env.LIVE_HOST_WS ?? "ws://127.0.0.1:55945/rpc";
const EPIC_ID = process.env.LIVE_EPIC_ID ?? "9c9ddaf0-99ce-412a-b4b8-49e0b1d8a4ef";
const CHAT_ID = process.env.LIVE_CHAT_ID ?? "29feb5f0-b273-4906-a87b-a8a71038952c";
const runIf = process.env.LIVE_HOST === "1" ? describe : describe.skip;

// The 11 block types the Evaluator found present with real data on this chat.
const EXPECTED_TYPES = [
  "text",
  "reasoning",
  "tool_call",
  "file_change",
  "subagent",
  "interview",
  "artifact_operation",
  "todo",
  "steer",
  "autonomous_resume",
  "error",
] as const;

function mem(seed: Record<string, string>): StorageLike {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const NOOP_CALLBACKS: Omit<ChatStreamCallbacks, "onSnapshot"> = {
  onActionAck: () => {},
  onMessageAccepted: () => {},
  onQueueChanged: () => {},
  onTurnStateChanged: () => {},
  onBlockDelta: () => {},
  onApprovalRequested: () => {},
  onApprovalResolved: () => {},
  onFileEditApprovalRequested: () => {},
  onFileEditApprovalResolved: () => {},
  onInterviewRequested: () => {},
  onInterviewAnswered: () => {},
  onInterviewErrored: () => {},
  onEventAppended: () => {},
  onRestoreStarted: () => {},
  onRestoreProgress: () => {},
  onRestoreCompleted: () => {},
  onErrorNotice: () => {},
  onWorktreeStateChanged: () => {},
  onConnectionStatus: () => {},
};

function fetchSnapshot(): Promise<ChatSnapshot> {
  const creds = JSON.parse(
    readFileSync(`${process.env.USERPROFILE}/.traycer/cli/credentials`, "utf8"),
  );
  const auth = new MobileAuthService({
    authnBaseUrl: creds.authnBaseUrl,
    clientId: "desktop",
    storage: mem({
      "traycer.mobile.auth": JSON.stringify({ token: creds.token, refreshToken: creds.refreshToken }),
    }),
  });

  return auth.start().then(
    () =>
      new Promise<ChatSnapshot>((resolve, reject) => {
        const client = new WsStreamClient({
          registry: hostStreamRpcRegistry,
          endpoint: () => ({ hostId: "live-test", websocketUrl: HOST_WS }),
          bearer: () => auth.current()?.credentials ?? null,
          auth: createStreamAuthRevalidator(auth),
          webSocketFactory: createWhatwgStreamWebSocketFactory(),
          dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
          // Mirrors `HostStreamConnection`'s constants (`stream-connection.ts`).
          openAckTimeoutMs: 10_000,
          pingIntervalMs: 25_000,
          pongTimeoutMs: 60_000,
          initialBackoffMs: 1_000,
          maxBackoffMs: 30_000,
        });

        const timeout = setTimeout(() => reject(new Error("timed out waiting for snapshot")), 30_000);
        const callbacks: ChatStreamCallbacks = {
          ...NOOP_CALLBACKS,
          onSnapshot: (frame) => {
            clearTimeout(timeout);
            handle.stream.close();
            client.close("test complete");
            resolve(frame.snapshot);
          },
        };
        const handle = openChatStream(client, { epicId: EPIC_ID, chatId: CHAT_ID, callbacks });
      }),
  );
}

runIf("live chat transcript — real content robustness", () => {
  it(
    `renders the real chat ${CHAT_ID} with no throw and no silent block drop`,
    async () => {
      const snapshot = await fetchSnapshot();
      const messages = snapshot.chat.messages;
      expect(messages.length).toBeGreaterThan(0);

      const allBlocks: ContentBlock[] = messages.flatMap((m) =>
        m.role === "assistant" ? m.blocks : [],
      );
      const presentTypes = new Set(allBlocks.map((b) => b.type));
      for (const expected of EXPECTED_TYPES) {
        expect(presentTypes.has(expected)).toBe(true);
      }

      const partition = partitionBlocks(allBlocks);
      // eslint-disable-next-line no-console
      console.log(
        `[live-chat-transcript] rendered=${partition.rendered.length} alternatePath=${partition.alternatePath.length} suppressed=${partition.suppressed.size} dropped=${partition.dropped.length}`,
      );
      expect(partition.dropped).toEqual([]);

      expect(() =>
        renderToStaticMarkup(
          <TranscriptView messages={messages} liveBlocks={[]} epicId={EPIC_ID} chatId={CHAT_ID} />,
        ),
      ).not.toThrow();
    },
    60_000,
  );
});
