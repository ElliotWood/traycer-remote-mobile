# D2 build notes — agent detail + reply (verified against source)

D1 (fleet view) is code-complete. D2 renders a blocked agent's question + options
and sends a reply. Mapped from `protocol/src/host/agent/gui/subscribe.ts`.

## It's a stream, not a unary call

`chat.subscribe` is a **streaming** RPC (`WsStreamClient`, not `WsRpcClient`):
- **Open request:** `{ epicId, chatId }`.
- **Server frames** (discriminated on `kind`): `snapshot` (carries the full
  `ChatSnapshot`), `turnStateChanged`, `interviewRequested`/`Answered`,
  `approvalRequested`/`Resolved`, `blockDelta`, …
- **Client frames** (what we send): `send`, `interviewAnswer { blockId, answers }`,
  `approvalDecision { approvalId, decision }`, each with `{ epicId, chatId,
  clientActionId }`.

## Blocked state (from the snapshot)

- **`pendingApprovals: ChatApprovalState[]`** — `{ approvalId, toolName,
  description, input, kind, planId, actions }`. **Has renderable question +
  options directly** → the cleanest first reply target. Reply:
  `approvalDecision { approvalId, decision }`.
- **`pendingInterviews: ChatPendingInterviewState[]`** — `{ blockId, requestedAt }`
  only. The question/options live in the transcript block referenced by
  `blockId`, so rendering it needs block resolution from the event stream
  (`blockDelta` / `eventAppended`). Second target.

## Remaining unknowns to resolve before building D2

1. **`WsStreamClient` API** — how to open the stream (endpoint + bearer, same
   `MutableBearerLease` seam), receive server frames, and send client frames.
   Read `clients/shared/host-transport/ws-stream-client.ts` +
   `clients/gui-app/src/lib/host/stream-runtime.tsx` /
   `durable-stream-transport.ts` for the consumption pattern.
2. **Listing chats within an epic** — to open `chat.subscribe { epicId, chatId }`
   we need the epic's chat ids. Determine the source (an `epic.*` unary, an
   agent list, or the epic record).

## Build order for D2

1. Stream connection helper (mirror `connection.ts`, over `WsStreamClient`).
2. Chat listing for an epic.
3. Subscribe → render `pendingApprovals` (description + actions).
4. Reply via `approvalDecision`; then `interviewAnswer` once block resolution
   is in.

Validation: typecheck/build in-repo; live check on the dev machine against a
real engine (no mocks) — same gate as D1.
