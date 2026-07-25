# clients/mobile — D1 build plan (standalone phone client)

Goal (D1): a standalone, phone-optimized web client that connects to a **local**
Traycer host and renders the real agent fleet + statuses. Networking (Tailscale)
is added later (D4) by pointing the same client at a tailnet URL — no client
changes.

This plan is grounded in the real source (paths/APIs verified in this repo).

## Architecture decision — use `HostClient` directly (skip `HostRuntime`)

`HostRuntime` requires an `IRunnerHost` (`clients/shared/host-client/host-runtime.ts`),
and the only implementations are Electron (`clients/desktop/src/renderer-shell/
desktop-runner-host.ts`) and a test mock — implementing the full desktop surface
for a mobile shell would mean stubs (forbidden). But `HostClient`
(`clients/shared/host-client/host-client.ts`) does **not** need a runner host —
its options are `{ registry, messenger, invalidator, schedulingPolicy?,
requestCoordinator?, authorityRegistry?, findHostById? }`. So the mobile shell
builds `HostClient` directly, reusing the same transport gui-app uses.

## Reuse map (verified)

| Need | Reuse | Path |
|---|---|---|
| RPC registry (typed methods) | `@traycer/protocol` host registry | `protocol/src/host/registry.ts` |
| Transport (unary) | `WsRpcClient` | `clients/shared/host-transport/ws-rpc-client.ts` |
| WS factory (browser) | `createWhatwgWebSocketFactory` | `clients/shared/host-transport/whatwg-ws-factory.ts` |
| Auth recovery wrapper | `createAuthAwareMessenger` | `clients/shared/host-transport/auth-aware-messenger.ts` |
| Retry wrapper | `createRetryingMessenger` | `clients/shared/host-transport/retrying-messenger.ts` |
| Auth (device-flow, bearer, rotation) | `RequestContextProvider` / auth service | `clients/shared/auth/request-context-provider.ts` |
| Fleet/blocked state | `chat.subscribe` (stream) | `protocol/src/host/agent/gui/subscribe.ts` |
| Reply / author | `send` / `interviewAnswer` / `approvalDecision` / `agent.create` | `protocol/src/host/registry.ts` |
| App harness (Vite + React + Tailwind + Router) | mirror desktop renderer | `clients/desktop/vite.renderer.config.ts` |

Wiring blueprint (the exact assembly to mirror): `clients/gui-app/src/providers/
host-runtime-provider.tsx` — it builds `WsRpcClient` → `createAuthAwareMessenger`
→ `createRetryingMessenger`. The mobile shell does the same, then feeds the
messenger to `HostClient` directly.

## Package layout (new standalone Vite app)

`gui-app` is a *library* the desktop wraps; the phone app is its own Vite app
(the desktop renderer is the template).

```
clients/mobile/
├── package.json            # catalog deps: react, react-dom, vite,
│                           #   @vitejs/plugin-react, @traycer/protocol,
│                           #   @traycer-clients/shared, @tanstack/react-query, uuid
├── tsconfig.json           # paths: @/* , @traycer-clients/shared/*, @traycer/protocol/*
├── tsconfig.app.json / tsconfig.node.json
├── vite.config.ts          # mirror clients/desktop/vite.renderer.config.ts (minus Electron/CSP)
├── project.json            # nx project (mirror clients/gui-app/project.json)
├── index.html
└── src/
    ├── main.tsx            # mount <App/>
    ├── config.ts           # HOST_WS_URL (default ws://127.0.0.1:<port>/rpc), bearer source
    ├── host/connection.ts  # build WsRpcClient → messenger → HostClient (endpoint = config)
    ├── host/use-fleet.ts   # chat.subscribe stream → fleet model
    └── views/              # FleetView, AgentDetail (blocked Q + options), Reply, Author
```

## Host endpoint + bearer (the D1 crux)

`WsRpcClient` takes an injectable **`HostEndpointProvider`** (`() =>
HostTransportEndpoint | null`) and an **`OpenFrameBearerSource`**
(`clients/shared/auth/bearer-source.ts`). For D1:

- Endpoint provider returns the configured `websocketUrl` (local
  `ws://127.0.0.1:<port>/rpc`; later a tailnet `wss://<host>.ts.net/rpc`).
- Bearer source returns the device-flow bearer. D1 may start from a bearer
  supplied via config to prove the path end-to-end, then wire the full
  `RequestContextProvider` device-flow.

## D1 acceptance (real-env)

On the dev machine with Traycer running: build+serve `clients/mobile`, point
`HOST_WS_URL` at the local host's `/rpc`, sign in (bearer), and see the **real
fleet's `runStatus` / `pendingInterviews`** rendered. No mock host — real engine.
Only then is D1 done (per PRODUCT.md §8).

## Next slices

- D2: reply (`interviewAnswer`/`approvalDecision`/`send`) + author (`agent.create`).
- D3: push watcher (`notifications.subscribe`) + Web Push (from the RemotePC
  `fork-overlay/push/`).
- D4: swap the endpoint to a tailnet URL via `tailscale serve` (RemotePC
  `fork-overlay/reachability/`); no client changes.
