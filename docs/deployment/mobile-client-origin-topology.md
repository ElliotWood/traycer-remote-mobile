# Mobile client origin topology (handover for A0)

What actually serves the mobile client today, and what A0's Azure ingress
must replace. Written as part of A5 ("retire Tailscale") after discovering
that ticket's literal scope - delete the tailnet-specific files - is not
safely executable yet: **the tailnet rig is currently the only way the user
reaches their own system**, and A0 (Azure public ingress) does not exist. No
VM, no reverse proxy, no TLS termination - confirmed by searching this
worktree and every other local worktree on this machine for ingress-related
work; none exists. Retiring Tailscale now would not leave a verification
gap, it would leave an outage - and a silent one (see below).

**A5's actual scope, given this: remove the machine-identifying strings, not
the capability.** Everything below stays running until A0 exists and is
proven end-to-end.

## The topology is four paths, not one

| Path | Served by today | Bound to |
| --- | --- | --- |
| `/` (the PWA bundle) | `vite preview` | loopback, port 5278 |
| `/rpc`, `/stream` (host WS) | `clients/mobile/tcp-host-proxy.mjs` | loopback, ports 5274/5275 |
| `/authn` | `clients/mobile/authn-proxy.mjs` | loopback, port 5277 |
| all of the above, unified into one origin | `tailscale serve` | the tailnet's magic-DNS hostname |

**A0's ingress must reverse-proxy all four paths from one public origin.**
"Retire Tailscale" was never "delete two files" - it's "replace `tailscale
serve`'s role for four distinct loopback-bound processes."

## Why `/authn` can't just point at production directly

Verified directly from `authn-proxy.mjs`'s own docblock, not inferred:

> Production authn's CORS allowlist contains exactly one origin
> (`https://platform.traycer.ai`), so a browser on any other origin cannot
> call it directly - every sign-in fails with an opaque CORS error. The
> client is therefore built with `VITE_AUTHN_BASE_URL=/authn` and this
> process forwards that path server-side, where CORS does not apply.

This is a hard constraint, not a preference: **any origin that serves this
client - the current tailnet one, a future Azure one, anything - needs a
same-origin `/authn` proxy, or sign-in cannot work at all.**

`vite.config.ts`'s dev server has an equivalent `server.proxy["/authn"]`
block, but `server.proxy` is a Vite **dev-server-only** feature - it does
not survive into `vite preview` or a production build. That gap is exactly
what caused a live incident: the deployed tailnet origin was found broken
today (config-error screen on a fresh sign-in), surviving only because a
cached token masked it. `authn-proxy.mjs` was written today specifically to
close that gap for the production-shaped preview build.

**This is also why grep-based verification is insufficient for anything
touching this topology.** Nothing in CI exercises origin topology - mobile's
test suite is pure-logic, no DOM/network origin simulation. A broken
same-origin proxy fails silently: the bundle loads, the app looks fine, and
only a *fresh* (uncached) sign-in reveals the break. "The tailnet hostname
string is gone" proves nothing about whether the capability behind it still
works.

## What replaces each path, and when

| Path | Decision | Rationale |
| --- | --- | --- |
| `/authn` | **`authn-proxy.mjs` stays and is fronted by A0's ingress as a sidecar.** Not rebuilt as "the Traycer host serving the bundle and proxying `/authn` itself" (the file's own docblock names that as the eventual answer). | The Traycer Host is closed-source, provisioned from GitHub Releases, and explicitly not in this repo (`AGENTS.md`) - "the host proxies `/authn` natively" is not buildable from here. `authn-proxy.mjs` is already origin-agnostic (listen port and upstream are arguments) and needs no changes to keep working once fronted by a real reverse proxy instead of `tailscale serve`. |
| `/rpc`, `/stream` | **Undecided - explicitly deferred to A0.** `tcp-host-proxy.mjs` could survive as a sidecar (same shape as `/authn`'s answer) or be replaced by ingress-native WebSocket proxying with host-restart-aware re-dialing built into A0 itself. | Both are legitimate; picking one is A0's design decision, not A5's. Flagging so it isn't decided by omission. |
| `/` (bundle) | **Undecided - explicitly deferred to A0.** Whether `vite preview` continues to serve the production build, or a dedicated static-file server replaces it, is unstated anywhere in this project's artifacts as of this doc. | Same reasoning - a real architecture decision, not a file rename. |
| Unifying origin | **Undecided - A0's entire purpose.** Whatever A0 builds (nginx, Caddy, a Node reverse proxy) must terminate real TLS and route all three paths above by the same rules `tailscale serve` currently does. | This is literally what A0 is scoped to build. |

## What A5 actually did instead of deleting

- Removed the real tailnet hostname from `vite.tailnet.config.ts` (a comment
  only - the file has no functional dependency on the hostname anywhere;
  `allowedHosts` is a bare `true`, not a hostname list) and
  `config-diagnostics.test.ts` (an arbitrary "any non-production origin"
  test constant, renamed and given a placeholder value - the test's actual
  logic only ever compares against the production origin string, verified
  by reading `computeConfigProblems` before choosing a replacement).
- Both files keep working exactly as before; full mobile suite (63 files,
  422 tests) still green under the package's own `test` script, run via
  Node per this project's toolchain convention.
- `tcp-host-proxy.mjs`, `authn-proxy.mjs`, `vite.tailnet.config.ts`'s
  functional config, and every `tailscale serve` route are untouched and
  still running.

## Done-when, for the eventual real retirement (not this ticket)

Not "the string `tailscale`/`tailnet` returns zero grep hits." The actual
bar: a fresh (uncached) sign-in succeeds from the Azure origin, the app
installs as a PWA from that origin, and `/rpc`/`/stream` connect - proven in
a real browser against the real deployed origin, the same way the tailnet
break was found. Only then do `tcp-host-proxy.mjs`, `vite.tailnet.config.ts`,
and the `tailscale serve` routes actually come out.
