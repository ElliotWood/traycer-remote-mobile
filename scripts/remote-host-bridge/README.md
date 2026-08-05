# remote-host-bridge

Presents a **remote Traycer host as a local host** to the desktop client, by
running a real loopback listener that forwards bytes to it.

This is a bridge, not a product. It exists because of a specific gap upstream,
and there is a specific upstream change that deletes it — see
[When this can be deleted](#when-this-can-be-deleted).

## Why it exists

The desktop client can reach a host in exactly two ways, and a self-hosted box
at its own WebSocket URL fits neither:

| Path | What it requires | Why a self-hosted box fails it |
| --- | --- | --- |
| `kind: "local"` | `ws://127.0.0.1:<port>/rpc` — `isCurrentHostWebsocketUrl` hard-checks the hostname | It isn't on this machine's loopback |
| `kind: "remote"` | The fixed relay attach endpoint, plus a Noise-NK handshake against the host's registry-published X25519 key | It isn't relay-brokered, and has no registry row |

The gap is deliberate: `buildHostStreamClient` *fails closed* for an incomplete
remote row rather than falling through to plain WebSocket, commented "that
would dial a relay attach URL without the Noise-NK transport."

So the only shape the desktop will accept for a host it doesn't manage is a
genuinely-live loopback listener. That's what this is.

## What it does

```
desktop  ──ws://127.0.0.1:<port>/rpc──▶  bridge  ──wss://your-host/rpc──▶  remote host
```

A **raw TCP passthrough**, not a WebSocket proxy. It inspects only the HTTP
request head — rewriting `Host` and `Origin`, which the remote's vhost requires
— and pipes bytes in both directions after that. Consequences worth knowing:

- `/rpc`, `/stream` and the unauthenticated `GET /activity` side-channel all
  work without this file knowing they exist. **The client's path is forwarded
  unchanged**, so set `TRAYCER_BRIDGE_TARGET` to an *origin*, not a full URL.
- It publishes a `pid.json` describing itself, which is how the desktop
  discovers a local host at all.

## Safety: it cannot touch your real host

The desktop resolves the entire host root — `pid.json`, logs, install dir,
enrollment — from `DEV_DESKTOP_SLOT`, so a slotted run reads
`~/.traycer/host/dev-runs/<slot>/` and never `~/.traycer/host/`. This bridge
resolves the same path by the same rule and **refuses to start** if that
resolves to the production root.

That's isolation by construction: there is no backup step and nothing to
restore, because your daily-driver host's `pid.json` is never read or written.

Run the bridge **before** launching the desktop. Post-auth provisioning
short-circuits to `already-ready` when a host is already reachable, so it won't
try to install one into the slot.

## Running it

Two terminals. **Terminal 1 — the bridge**, left running:

```sh
DEV_DESKTOP_SLOT=my-slot \
TRAYCER_BRIDGE_TARGET=wss://your-host.example \
TRAYCER_BRIDGE_HOST_VERSION=1.1.9 \
node remote-host-bridge.mjs
```

Wait for `[bridge] published …`. Anything else means nothing was published —
see [What it looks like when it's wrong](#what-it-looks-like-when-its-wrong).

**Terminal 2 — the desktop**, same slot:

```sh
cd ../../clients/desktop
DEV_DESKTOP_SLOT=my-slot bun run dev
```

Ctrl-C in terminal 1 stops the bridge and retracts the host.

> **Do not use `make dev-desktop`.** It will refuse to launch:
> `scripts/dev-desktop.js` calls `assertSlotNotActive`, which reads the slot's
> `pid.json`, sees the bridge's live pid, and throws *"a dev-desktop run is
> already active for slot …"*. That guard exists to stop two dev-desktop runs
> racing each other and cannot tell this bridge from a real dev host.
>
> Skipping it is what we want anyway: `bun run dev` runs `dev-stack.cjs`, which
> starts Vite + Electron and propagates `DEV_DESKTOP_SLOT` **without
> provisioning a host** — the bridge is the host.

On Windows, `$env:NAME = "value"` per line in PowerShell, then run the command.

| Variable | Required | Meaning |
| --- | --- | --- |
| `TRAYCER_BRIDGE_TARGET` | yes | Remote origin, `ws://` or `wss://`. No default — an endpoint baked into a tracked file would be both a leak and a stale fact. |
| `TRAYCER_BRIDGE_HOST_VERSION` | yes | The version the **remote** host actually reports. Required rather than guessed: the desktop compares it, and a wrong guess is a silent misbehaviour. |
| `DEV_DESKTOP_SLOT` | in practice | Isolates the run. Without it (and a non-production `TRAYCER_BRIDGE_ENV`) the bridge refuses to start. |
| `TRAYCER_BRIDGE_PORT` | no | Defaults to an ephemeral port. |
| `TRAYCER_BRIDGE_ENV` | no | Defaults to `dev`. |
| `TRAYCER_BRIDGE_INSECURE_TLS` | no | `1` disables upstream certificate verification. Needed for a box fronted by an **ACME staging** or self-signed certificate. Announced loudly on every run — it turns off the only thing authenticating the far end. |

## What it looks like when it's wrong

Failures are made loud and early on purpose. A published endpoint that never
answers is the ambiguous case that leaves a client stuck with nothing to act
on, so the bridge avoids ever creating one:

| Situation | What happens |
| --- | --- |
| Remote unreachable at startup | Preflight fails, **nothing is published**, exit 1 with the reason. The desktop shows its ordinary "no host" state. |
| Certificate doesn't verify | Same, and the error explicitly suggests `TRAYCER_BRIDGE_INSECURE_TLS=1`. |
| Remote dies while running | Each new connection fails fast and the inbound socket is destroyed, so the client sees an ordinary dial failure rather than a hang. |
| Misconfigured to production slot | Refuses to start. |
| Hard-killed (`SIGKILL`, Task Manager) | Leaves a stale `pid.json`. The desktop's liveness probe resolves the dead pid to `dead` on its own, so it is never mistaken for a live host, and the next bridge start overwrites it. |

The health monitor will not fight the bridge: its settled policy is that an
existing process is never auto-killed, and respawn is reachable only when
liveness reads `dead`. The bridge is a real process with an honest pid, so it
reads `alive`.

## Testing

```sh
node test-remote-host-bridge.mjs
```

Stands up a fake remote on loopback — no network, no real host needed — and
checks the published metadata, the loopback endpoint contract, path
preservation, the header rewrites, retraction, stale-file self-heal, and every
refusal path.

**Untested here:** the `wss://` (TLS) upstream leg, which needs a real remote.
It is exercised the first time this is pointed at one.

## When this can be deleted

Either of these retires it:

1. **The host-side Noise-NK responder ships** (T11 in `REMOTE-TRANSPORT.md`,
   dispatched after the T12 client transport). Then a self-hosted box can
   enrol normally — install the CLI on it and run `traycer login` — and appear
   as a first-class remote host with no client changes at all. This is the
   intended path, and nothing about it is out of reach for a box you own.
2. **Upstream accepts a host at a user-supplied URL.** We've asked whether
   that's a shape they'd want; if the answer is yes, a small client change
   replaces this entirely.

Until one of those lands, this is the only way an unmodified desktop reaches a
host it doesn't manage.
