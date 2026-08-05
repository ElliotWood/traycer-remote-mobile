# chat-transfer

Moves a Traycer chat to another host, carrying its history.

`SKILL.md` here is the canonical copy of the `traycer-move-chat` skill; `install-skill.mjs` installs it where the harnesses look. The CLI is what the skill drives.

## The one thing to know first

**A chat is bound to its host for life.** `chat.hostId` is stamped at creation and there is no protocol method that changes it — `persistence/epic/chat.ts` states the contract outright: *"chats are tabs are bound to a host for life… Cross-host continuation is clone-not-migrate."*

So this tool clones forward. The original chat stays exactly where it was, untouched, and a sibling on the target host carries the transcript. That is not a compromise imposed by the tool; it is the shape the product already has.

## Why it needs to exist at all

Both halves ship in the desktop today and are never used together:

| Existing path | Switches host | Carries history |
| --- | --- | --- |
| `clone-chat-on-host-switch.ts` | ✅ | ❌ (run settings only) |
| `chat-fork-dialog.tsx` | ❌ (pins `hostId = tabHostId`) | ✅ |

`epic.createChat` accepts `hostId` **and** `forkSource` in the same request. Passing both is the whole feature.

## What is replicated, and what that buys

The epic's Yjs room — transcript, run settings, events, artifacts, and the repo/workspace tables — reaches every host. Only the *runtime* is host-local: the worktree binding, the harness session, agent processes, terminals, credentials.

Two consequences the design leans on:

1. **The target forks from its own copy.** Nothing crosses between hosts, and no bridge or tunnel is involved: the move is one `/rpc` call to the target. See [Moving off a host that is off](#moving-off-a-host-that-is-off).
2. **A host will describe a foreign chat's workspace, and be wrong.** Ask host B about a chat bound to host A and it returns a `worktreeBinding` at *B's* paths — its epic-inherited guess, not A's truth. Measured on one chat: host A said `C:\repo\x`, mode `worktree`, worktree at `…\teams-foundations`; host B said `/srv/traycer/repo/Owner/x`, mode `local`, `repoIdentifier: null`. This tool therefore reads workspaces from the **source**, and falls back to the chat's replicated `activeSessionChain.sessionWorkspaceSnapshot` — never from the target.

## Moving off a host that is off

**A chat can be moved off a machine that is shut down.** This is measured, not inferred:

- A move was run with the source host neither configured nor contacted — the tool saw only the target, and every verdict passed.
- The source host cannot be contacted by the target either, even in principle. It binds `127.0.0.1` only (all four of its ports), so a host on another network has no route to it. Whatever served that fork came from the target's own replicated copy.

Two honest limits on that:

- **The workspace reading degrades.** With the source unreachable the binding comes from the chat's replicated `activeSessionChain.sessionWorkspaceSnapshot`, which is the harness session's view rather than the real binding — and a worktree path in it usually carries no repo identity, so the chat lands folderless unless you pass `--workspace`. `plan` says `source host not read` when this happens.
- **The run status becomes unknowable.** A turn could be running on the source and this tool cannot see it. It says so rather than assuming idle.

The corollary: this needs no loopback bridge, no tunnel, and no route to the source. It is one call to the target host.

## Path translation

Paths do not survive a host change; repo identity does.

```
source binding  →  repoIdentifier  →  workspace.resolvePathsByRepoIdentifiers on the target  →  target path
```

Verified in both directions: `C:\repo\traycer-remote-mobile ↔ /srv/traycer/repo/<Owner>/traycer-remote-mobile`. When a source folder has no repo identity, or the repo is not checked out on the target, the tool says so and lands the chat folderless rather than inventing a path — pass `--workspace <path>` to place it yourself.

## What a move can never carry

| Lost | Why |
| --- | --- |
| The harness session | `activeSessionChain` resets to `null`. The model re-reads the transcript; it does not resume. Continuity of record, not of context. |
| A running turn | The fork boundary is a *completed* assistant message. `plan` refuses a non-idle source. |
| Anything after that boundary | `forkSource` cuts at an assistant message id. Trailing user messages are dropped, and named as such. |
| Host-local agents | `agent list` is per host. Child agents and open reply threads die with the binding. |
| Provider profile | `profileId` is host-local; the clone lands on the target's ambient login unless it holds the same account. |
| Uncommitted work | The target is a different clone. Only pushed commits cross. |
| Terminals, TUI agents, pending approvals | Host-local runtime. |

## Setup

Remote hosts come from an untracked config — an endpoint or host id in a tracked file would be both a leak and a stale fact:

```
~/.traycer/chat-transfer.hosts.json          (or $TRAYCER_CHAT_TRANSFER_HOSTS)
```

```json
{
  "hosts": [
    { "alias": "<short-name>", "origin": "wss://<your-host>", "hostId": "<uuid>", "insecureTls": false }
  ]
}
```

The local host is discovered from its own `pid.json` and needs no entry. `hosts --epic <id>` discovers a missing `hostId` from a binding row the host owns and writes it back. `insecureTls` is process-wide and announced loudly — it is for a box behind an ACME-staging or self-signed certificate, and it turns off the only thing authenticating the far end.

Auth is the CLI bearer at `~/.traycer/cli/credentials` (~4h expiry; `traycer login` to refresh).

## Usage

```sh
node scripts/chat-transfer/move-chat.mjs hosts --epic <epicId>
node scripts/chat-transfer/move-chat.mjs plan  --epic <epicId> --chat <chatId> --to <alias>
node scripts/chat-transfer/move-chat.mjs move  --epic <epicId> --chat <chatId> --to <alias> --yes
node scripts/chat-transfer/move-chat.mjs undo  --epic <epicId> --chat <newChatId> --to <alias>
```

`plan` writes nothing. `move` without `--yes` is `plan`. `undo` refuses any chat with no `chat.forked` event, so it cannot delete a chat this tool did not create.

## Verification

`move` does not assert success — it reads the target back and reports six checks:

```
PASS  chat exists on the target
PASS  bound to <alias>                     (its own hostId, from its own snapshot)
PASS  carries N message(s)
PASS  records its source                   (a chat.forked event naming the source chat)
PASS  workspace bound on the target        (a binding row on THAT machine owning the new chat)
PASS  the bound folder exists on the target (realpath, via workspace.prepareFolders)
PASS  source chat still intact             (same message count, same host)
```

The folder check earned its place: a `--workspace` typo — or a POSIX path an MSYS shell rewrote into `C:/Program Files/Git/srv/...` — produced a binding row that passed every other verdict and a chat that could not run. `plan` now refuses such a path before anything is created; the verdict re-checks what the host actually chose, which need not be what was asked for.

The last one is the point: the source is verified whole *after* the move, every time.

A failure needs no rollback for safety — the source was never written — but the partial clone is noise, so the failure message prints the `undo` command.

## Handshake notes

Both quirks below cost time if rediscovered:

- **One `/rpc` WebSocket per call.** The host closes the socket after a single response.
- **The `open` frame's manifest may not be empty.** An empty one is answered with `fatalError { code: "INCOMPATIBLE" }`. `rpc.mjs` advertises the released floor parsed out of `protocol/src/host/released-floor.ts` at runtime rather than duplicating the list — a copied list drifts the moment a method lands, and the failure mode is a fatal handshake with no clue why.

Requires Node 22+ for the built-in `WebSocket`. No dependencies.

## Scope

Not covered, deliberately: batch moves, moving a chat's descendants as a tree, recreating agent processes on the target, and moving a chat with a turn in flight. The first two are additive; the last two are not possible.
