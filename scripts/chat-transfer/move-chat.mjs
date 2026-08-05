#!/usr/bin/env node
// Move a chat to another Traycer host. See ./README.md.
//
// The move is a CLONE: `chat.hostId` is a for-life binding, so continuation on
// another host means a sibling chat carrying the history forward. The source
// is never written to, never deleted, and is not even required to be
// reachable - the epic's Yjs room is replicated, so the TARGET host already
// holds the full transcript and serves the fork from its own copy.
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rpc, readChat, readEpicMeta } from "./rpc.mjs";
import { CONFIG_PATH, configTemplate, listHosts, rememberHostId, resolveHost } from "./hosts.mjs";

// ─── argv ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const command = argv[0] ?? "help";
  const flags = {};
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else { flags[key] = next; i += 1; }
  }
  return { command, flags };
}

function need(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

// ─── reads ───────────────────────────────────────────────────────────────────

/**
 * The target's own host id, proven from a binding row it owns rather than
 * taken on trust. `host.status` does not report an id, and a wrong id would
 * bind the new chat to a phantom host.
 */
async function discoverHostId(host, epicId) {
  if (host.hostId !== null) return host.hostId;
  const { rows } = await rpc(host, "worktree.listBindingsForEpic", { epicId });
  const ids = [...new Set(rows.map((r) => r.hostId))];
  if (ids.length !== 1) return null;
  return ids[0];
}

/** The host a chat is bound to, if this machine has it configured. */
function hostForId(hosts, hostId) {
  return hosts.find((h) => h.hostId === hostId) ?? null;
}

/**
 * The fork boundary: the last COMPLETED assistant message. Everything after
 * it is dropped, because `forkSource` cuts at an assistant message id and
 * there is nothing else to cut at.
 */
export function forkBoundary(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") {
      return { message: messages[i], index: i, dropped: messages.slice(i + 1) };
    }
  }
  return null;
}

// ─── workspace translation ───────────────────────────────────────────────────

function repoKey(repo) {
  return repo === null || repo === undefined ? null : `${repo.owner}/${repo.repo}`;
}

function defaultResolvePaths(targetHost, repoIdentifiers) {
  return rpc(targetHost, "workspace.resolvePathsByRepoIdentifiers", { repoIdentifiers }).then((r) => r.mappings);
}

/**
 * Does this path exist on that host? `workspace.prepareFolders` realpaths and
 * fails ENOENT, which is the only clean answer at the floor -
 * `workspace.listDirectory` returns an empty listing for a missing directory
 * and so cannot tell "absent" from "empty".
 *
 * Worth the round trip: a bad `--workspace` (a typo, or a POSIX path mangled
 * by an MSYS shell into `C:/Program Files/Git/srv/...`) otherwise produces a
 * binding row that looks healthy in every other check and a chat that cannot
 * run.
 */
async function pathExistsOn(host, path) {
  try {
    await rpc(host, "workspace.prepareFolders", { folderPaths: [path] }, { timeoutMs: 30_000 });
    return true;
  } catch (error) {
    if (/ENOENT|no such file/i.test(error.message)) return false;
    throw error;
  }
}

async function missingOn(host, paths) {
  const unique = [...new Set(paths)];
  const results = await Promise.all(unique.map((p) => pathExistsOn(host, p)));
  return unique.filter((_, i) => !results[i]);
}

/**
 * Source-side workspace facts. Read from the SOURCE host when it is
 * reachable: the target's `worktreeBinding` for a foreign chat is the
 * target's own inherited guess, not the source's truth, and reporting it
 * would name the wrong workspace with total confidence.
 */
async function readSourceWorkspaces(sourceHost, chat, epicId, meta) {
  if (sourceHost !== null) {
    try {
      const snapshot = await readChat(sourceHost, epicId, chat.id);
      const entries = snapshot.worktreeBinding?.entries ?? [];
      return {
        provenance: `source host "${sourceHost.alias}"`,
        runStatus: snapshot.runStatus,
        activeTurn: snapshot.activeTurn,
        pendingApprovals: snapshot.pendingApprovals?.length ?? 0,
        pendingInterviews: snapshot.pendingInterviews?.length ?? 0,
        entries: entries.map((e) => ({
          workspacePath: e.workspacePath,
          worktreePath: e.worktreePath,
          branch: e.branch,
          mode: e.mode,
          isPrimary: e.isPrimary,
          repoIdentifier: e.repoIdentifier ?? repoFromMeta(meta, e.workspacePath),
        })),
      };
    } catch (error) {
      console.error(`   (source host "${sourceHost.alias}" unreachable: ${error.message})`);
    }
  }
  // Degraded: the harness session's own workspace snapshot rides in the
  // replicated doc, so it is readable with the source host down.
  const snap = chat.activeSessionChain?.sessionWorkspaceSnapshot ?? null;
  const paths = snap === null ? [] : [snap.primaryWorkspace, ...(snap.secondaryWorkspaces ?? [])];
  return {
    provenance: snap === null ? "nothing (chat never ran)" : "the replicated session snapshot — source host not read",
    runStatus: null,
    activeTurn: null,
    pendingApprovals: null,
    pendingInterviews: null,
    entries: paths.filter(Boolean).map((p, i) => ({
      workspacePath: p,
      worktreePath: null,
      branch: null,
      mode: "local",
      isPrimary: i === 0,
      repoIdentifier: repoFromMeta(meta, p),
    })),
  };
}

/** Match a workspace path to a repo using the epic's replicated folder table. */
export function repoFromMeta(meta, workspacePath) {
  const normalized = String(workspacePath).replace(/\\/g, "/").toLowerCase();
  const folders = meta.workspaceFolders ?? [];
  let best = null;
  for (const folder of folders) {
    if (folder.repoIdentifier === null || folder.repoIdentifier === undefined) continue;
    const candidate = String(folder.workspacePath).replace(/\\/g, "/").toLowerCase();
    if (normalized === candidate || normalized.startsWith(`${candidate}/`)) {
      if (best === null || candidate.length > best.length) best = candidate;
    }
  }
  if (best === null) return null;
  return folders.find((f) => String(f.workspacePath).replace(/\\/g, "/").toLowerCase() === best).repoIdentifier;
}

/**
 * Translate source workspaces onto the target by repo identity. Paths are
 * meaningless across hosts (`C:\repo\x` vs `/srv/.../x`); the repo is not.
 */
export async function translateWorkspaces(targetHost, sourceEntries, { branch, resolvePaths = defaultResolvePaths }) {
  const repos = [...new Map(
    sourceEntries.filter((e) => e.repoIdentifier).map((e) => [repoKey(e.repoIdentifier), e.repoIdentifier]),
  ).values()];
  const mappings = repos.length === 0 ? [] : await resolvePaths(targetHost, repos);
  const byRepo = new Map(mappings.map((m) => [repoKey(m.repoIdentifier), m.workspacePath]));

  const translated = [];
  const unmapped = [];
  for (const entry of sourceEntries) {
    const key = repoKey(entry.repoIdentifier);
    const targetPath = key === null ? undefined : byRepo.get(key);
    if (targetPath === undefined) {
      unmapped.push({ ...entry, reason: key === null ? "no repo identity" : `${key} is not checked out on the target` });
      continue;
    }
    translated.push({ source: entry, workspacePath: targetPath, repoIdentifier: entry.repoIdentifier });
  }

  const intentEntries = translated.map((t, i) => {
    const base = { workspacePath: t.workspacePath, repoIdentifier: t.repoIdentifier, isPrimary: t.source.isPrimary };
    if (branch !== null && t.source.isPrimary) {
      return { kind: "worktree", ...base, branch: { type: "existing", name: branch }, scripts: null };
    }
    return { kind: "local", ...base };
  });
  // Exactly one primary, or the host has nothing to run in.
  if (intentEntries.length > 0 && !intentEntries.some((e) => e.isPrimary)) intentEntries[0].isPrimary = true;
  return { translated, unmapped, intentEntries };
}

// ─── plan ────────────────────────────────────────────────────────────────────

async function buildPlan(flags) {
  const epicId = need(flags, "epic");
  const chatId = need(flags, "chat");
  const targetHost = resolveHost(need(flags, "to"));
  const hosts = listHosts();

  const targetHostId = await discoverHostId(targetHost, epicId);
  if (targetHostId === null) {
    throw new Error(
      `could not prove "${targetHost.alias}"'s host id — it owns no binding in this epic yet.\n` +
      `Add its "hostId" to ${CONFIG_PATH} (the desktop shows it under Settings → Hosts).`,
    );
  }
  targetHost.hostId = targetHostId;

  // Read the chat FROM THE TARGET: proof the target already holds the history
  // it is about to fork, and the one read the whole move depends on.
  const chat = (await readChat(targetHost, epicId, chatId)).chat;
  if (chat.hostId === targetHostId) {
    throw new Error(`chat "${chat.title}" is already bound to ${targetHost.alias}`);
  }

  const meta = await readEpicMeta(targetHost, epicId);
  const sourceHost = hostForId(hosts, chat.hostId);
  const source = await readSourceWorkspaces(sourceHost, chat, epicId, meta);

  const boundary = forkBoundary(chat.messages ?? []);
  if (boundary === null) {
    throw new Error(`chat "${chat.title}" has no completed assistant turn — there is no fork boundary yet`);
  }

  const branch = typeof flags.branch === "string" ? flags.branch : null;
  const workspace = flags["no-workspace"] === true
    ? { translated: [], unmapped: [], intentEntries: [] }
    : await translateWorkspaces(targetHost, source.entries, { branch });

  if (typeof flags.workspace === "string") {
    workspace.intentEntries = [{ kind: "local", workspacePath: flags.workspace, repoIdentifier: null, isPrimary: true }];
    workspace.overridden = true;
  }

  // Catch a path that does not exist on the target BEFORE anything is created:
  // a chat bound to a phantom folder passes every other check and cannot run.
  workspace.missing = await missingOn(targetHost, workspace.intentEntries.map((e) => e.workspacePath));

  return {
    epicId, chat, boundary, source, workspace, targetHost, sourceHost,
    sourceHostId: chat.hostId,
    title: typeof flags.title === "string" ? flags.title : chat.title,
    newChatId: randomUUID(),
    noWorkspace: flags["no-workspace"] === true,
  };
}

function printPlan(plan) {
  const { chat, boundary, source, workspace } = plan;
  const sourceLabel = plan.sourceHost?.alias ?? `host ${plan.sourceHostId.slice(0, 8)}… (not configured here)`;

  console.log(`\nMove  "${chat.title}"`);
  console.log(`from  ${sourceLabel}`);
  console.log(`to    ${plan.targetHost.alias} (${plan.targetHost.origin})\n`);

  if (source.runStatus !== null && source.runStatus !== "idle") {
    console.log(`BLOCKED: the source chat is ${source.runStatus} — a running turn cannot be moved. Let it finish.\n`);
  } else if (source.runStatus === null) {
    console.log(`Note: the source host was not read, so a turn running there would not be visible here.\n`);
  }

  console.log("Moves:");
  console.log(`  · ${boundary.index + 1} of ${chat.messages.length} messages, through the last completed assistant turn`);
  console.log(`  · run settings — ${chat.settings ? `${chat.settings.harnessId}/${chat.settings.model}, ${chat.settings.permissionMode}` : "host defaults (chat has none)"}`);
  if (chat.settings?.profileId) {
    console.log("    (profileId is host-local; the clone lands on the target's ambient login unless it has the same account)");
  }
  console.log(`  · provenance — a chat.forked event naming this chat as the source`);
  for (const t of workspace.translated) {
    console.log(`  · workspace ${t.source.workspacePath}  ->  ${t.workspacePath}`);
  }
  if (workspace.overridden) {
    console.log(`  · workspace (overridden) -> ${workspace.intentEntries[0].workspacePath}`);
  }
  console.log(`    (source workspaces read from ${source.provenance})`);

  console.log("\nDoes NOT move:");
  console.log(`  · the harness session — activeSessionChain resets; the model re-reads the transcript, it does not resume`);
  if (boundary.dropped.length > 0) {
    console.log(`  · ${boundary.dropped.length} message(s) after the fork boundary (${boundary.dropped.map((m) => m.role).join(", ")})`);
  }
  if (source.pendingApprovals) console.log(`  · ${source.pendingApprovals} pending approval(s)`);
  if (source.pendingInterviews) console.log(`  · ${source.pendingInterviews} pending question(s)`);
  console.log(`  · host-local agents spawned by this chat, and any open reply threads to them`);
  console.log(`  · uncommitted work in the source checkout — the target has a different clone`);
  for (const entry of source.entries.filter((e) => e.worktreePath !== null)) {
    console.log(`  · the source worktree ${entry.worktreePath}${entry.branch ? ` (branch ${entry.branch})` : ""} — push the branch and pass --branch to recreate it`);
  }
  for (const u of workspace.unmapped) {
    console.log(`  · workspace ${u.workspacePath} — ${u.reason}`);
  }
  if (plan.noWorkspace) console.log("  · any workspace at all (--no-workspace)");
  else if (workspace.intentEntries.length === 0) {
    console.log("  · any workspace — nothing translated, so the chat lands folderless");
    console.log("    (pass --workspace <absolute path on the target> to place it yourself)");
  }
  for (const path of workspace.missing ?? []) {
    console.log(`\nBLOCKED: ${path} does not exist on ${plan.targetHost.alias}.`);
    console.log("  A chat bound to a folder that is not there cannot run. Pass a --workspace that exists,");
    console.log("  or --no-workspace to land it folderless and pick the folder in the app.");
    console.log("  (Running from an MSYS shell? It rewrites a leading /srv/... into C:/Program Files/Git/srv/... .)");
  }
  console.log(`\nThe source chat is not touched. It stays on ${sourceLabel}, intact.\n`);
}

// ─── move ────────────────────────────────────────────────────────────────────

async function doMove(plan) {
  if (plan.source.runStatus !== null && plan.source.runStatus !== "idle") {
    throw new Error(`refusing to move: the source chat is ${plan.source.runStatus}`);
  }
  if ((plan.workspace.missing ?? []).length > 0) {
    throw new Error(
      `refusing to move: ${plan.workspace.missing.join(", ")} does not exist on ${plan.targetHost.alias}`,
    );
  }
  const { targetHost, epicId, chat, boundary } = plan;
  const hasWorkspace = plan.workspace.intentEntries.length > 0;

  console.log(`Creating on ${targetHost.alias}…`);
  const created = await rpc(targetHost, "epic.createChat", {
    epicId,
    chatId: plan.newChatId,
    parentId: chat.parentId ?? null,
    hostId: targetHost.hostId,
    title: plan.title,
    settings: chat.settings ?? null,
    workspaceMode: hasWorkspace ? "inherit" : "folderless",
    worktreeIntent: hasWorkspace ? { entries: plan.workspace.intentEntries } : null,
    initialMessage: null,
    forkSource: {
      sourceChatId: chat.id,
      assistantMessageId: boundary.message.messageId,
      interviewBlockId: null,
      carriedInterviews: null,
    },
  }, { timeoutMs: 120_000 });

  return verify(plan, created.chatId, hasWorkspace);
}

/**
 * Verify against the target, not against our own assumptions. Every check
 * reads back something the target itself authored.
 */
async function verify(plan, newChatId, expectWorkspace) {
  const { targetHost, epicId } = plan;
  const created = (await readChat(targetHost, epicId, newChatId)).chat;
  const bindingRows = expectWorkspace
    ? (await rpc(targetHost, "worktree.listBindingsForEpic", { epicId })).rows
    : null;
  const sourceAfter = (await readChat(targetHost, epicId, plan.chat.id)).chat;
  // The host picks the final `runningDir`; check what it actually chose exists
  // there, not what we asked for.
  const owned = (bindingRows ?? []).filter((r) => r.sources.some((s) => s.ownerId === newChatId));
  const missingDirs = owned.length === 0 ? [] : await missingOn(targetHost, owned.map((r) => r.runningDir));

  const checks = collectChecks({ plan, newChatId, created, bindingRows, sourceAfter, missingDirs });

  console.log("");
  let ok = true;
  for (const [label, passed, detail] of checks) {
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!passed) ok = false;
  }
  console.log("");
  if (!ok) {
    console.log(`Verification FAILED. The source chat is untouched. Remove the partial clone with:`);
    console.log(`  node scripts/chat-transfer/move-chat.mjs undo --epic ${epicId} --chat ${newChatId} --to ${targetHost.alias}\n`);
    process.exitCode = 1;
    return newChatId;
  }
  console.log(`Moved. Open "${plan.title}" on ${targetHost.alias}; the original stays where it was.\n`);
  return newChatId;
}

/**
 * The verdicts, as `[label, passed, detail]`. Pure: every input is something
 * the target host authored and returned, so this is the whole judgement and
 * nothing about it depends on the network.
 */
export function collectChecks({ plan, newChatId, created, bindingRows, sourceAfter, missingDirs = [] }) {
  const { targetHost } = plan;
  const checks = [];

  checks.push(["chat exists on the target", created.id === newChatId, created.id]);
  checks.push([
    `bound to ${targetHost.alias}`,
    created.hostId === targetHost.hostId,
    `hostId ${created.hostId}`,
  ]);
  checks.push([
    `carries ${plan.boundary.index + 1} message(s)`,
    (created.messages?.length ?? 0) === plan.boundary.index + 1,
    `${created.messages?.length ?? 0} present`,
  ]);
  const forked = (created.events ?? []).find((e) => e.type === "chat.forked");
  checks.push([
    "records its source",
    forked?.metadata?.sourceChatId === plan.chat.id,
    forked === undefined ? "no chat.forked event" : `source ${forked.metadata?.sourceChatTitle}`,
  ]);

  // The target host itself claiming ownership of a workspace row is the only
  // proof that the binding materialized on THAT machine.
  if (bindingRows !== null) {
    const owned = bindingRows.filter((r) => r.sources.some((s) => s.ownerId === newChatId));
    checks.push([
      "workspace bound on the target",
      owned.length > 0,
      owned.map((r) => `${r.runningDir} (${r.mode})`).join(", ") || "no row owns this chat",
    ]);
    const wrongHost = owned.filter((r) => r.hostId !== targetHost.hostId);
    if (wrongHost.length > 0) checks.push(["binding owned by the expected host", false, `owned by ${wrongHost[0].hostId}`]);
    checks.push([
      "the bound folder exists on the target",
      missingDirs.length === 0,
      missingDirs.length === 0 ? "realpath resolves" : `${missingDirs.join(", ")} is not there`,
    ]);
  }

  // And the source is still whole. Checked AFTER the move, every time - the
  // promise this tool makes is that the original survives, so it is the one
  // thing never taken on trust.
  checks.push([
    "source chat still intact",
    (sourceAfter.messages?.length ?? 0) === plan.chat.messages.length && sourceAfter.hostId === plan.sourceHostId,
    `${sourceAfter.messages?.length ?? 0} messages, still on ${sourceAfter.hostId.slice(0, 8)}…`,
  ]);

  return checks;
}

// ─── commands ────────────────────────────────────────────────────────────────

async function cmdHosts(flags) {
  const hosts = listHosts();
  if (hosts.length === 0) {
    console.log(`No hosts. Create ${CONFIG_PATH}:\n\n${configTemplate()}`);
    return;
  }
  for (const host of hosts) {
    let status;
    try {
      const s = await rpc(host, "host.status", {}, { timeoutMs: 15_000 });
      status = `ready=${s.ready} v${s.hostVersion}`;
    } catch (error) {
      status = `UNREACHABLE — ${error.message}`;
    }
    let id = host.hostId ?? "unknown";
    if (host.hostId === null && typeof flags.epic === "string") {
      try {
        const discovered = await discoverHostId(host, flags.epic);
        if (discovered !== null) { id = `${discovered} (discovered)`; rememberHostId(host.alias, discovered); }
      } catch { /* leave unknown */ }
    }
    console.log(`${host.alias.padEnd(12)} ${status}\n${"".padEnd(12)} ${host.origin}\n${"".padEnd(12)} hostId ${id}`);
  }
  if (!hosts.some((h) => h.hostId === null)) return;
  console.log(`\nA host id shows as "unknown" until it owns a binding in the epic you pass to --epic, or you set it in ${CONFIG_PATH}.`);
}

async function cmdChats(flags) {
  const epicId = need(flags, "epic");
  const hosts = listHosts();
  const via = typeof flags.host === "string" ? resolveHost(flags.host) : hosts[0];
  if (via === undefined) throw new Error(`no host to read through — configure one in ${CONFIG_PATH}`);

  const meta = await readEpicMeta(via, epicId);
  console.log(`\n${meta.epicLight?.title ?? epicId}\n`);
  const byId = new Map(hosts.filter((h) => h.hostId).map((h) => [h.hostId, h.alias]));
  const listed = (flags.chat ? [flags.chat] : null);
  if (listed === null) {
    console.log("Pass --chat <id> for detail. Chat ids are visible in the desktop URL, or via the epic canvas.");
    console.log(`Hosts seen in this epic's workspaces:`);
    for (const id of [...new Set((meta.workspaces ?? []).map((w) => w.hostId))]) {
      console.log(`  ${id}  ${byId.get(id) ?? "(not configured here)"}`);
    }
    console.log("");
    return;
  }
  const chat = (await readChat(via, epicId, listed[0])).chat;
  console.log(`  ${chat.title}`);
  console.log(`  bound to ${byId.get(chat.hostId) ?? chat.hostId}`);
  console.log(`  ${chat.messages?.length ?? 0} messages, updated ${new Date(chat.updatedAt).toISOString()}\n`);
}

async function cmdUndo(flags) {
  const epicId = need(flags, "epic");
  const chatId = need(flags, "chat");
  const host = resolveHost(need(flags, "to"));
  const chat = (await readChat(host, epicId, chatId)).chat;
  const forked = (chat.events ?? []).find((e) => e.type === "chat.forked");
  if (forked === undefined) {
    throw new Error(`refusing: "${chat.title}" carries no chat.forked event, so it was not created by this tool`);
  }
  console.log(`Deleting the clone "${chat.title}" (forked from "${forked.metadata?.sourceChatTitle}")…`);
  const result = await rpc(host, "epic.deleteChat", { epicId, chatId });
  console.log(result.deleted ? "Deleted. The source is where it always was." : "Host reported deleted=false.");
}

const USAGE = `
Move a Traycer chat to another host. The source chat is never modified.

  hosts  [--epic <id>]                            list hosts; --epic proves each host's id
  chats   --epic <id> [--chat <id>] [--host a]    what this epic holds
  plan    --epic <id> --chat <id> --to <alias>    what would and would not move
  move    --epic <id> --chat <id> --to <alias>    do it, then verify on the target
  undo    --epic <id> --chat <id> --to <alias>    delete a clone this tool made

move/plan options:
  --title <t>        title for the new chat (default: the source's)
  --workspace <p>    force an absolute path on the target instead of translating
  --branch <name>    create a worktree on that existing branch for the primary folder
  --no-workspace     land the chat folderless
  --yes              skip the confirmation prompt
`;

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "hosts": return cmdHosts(flags);
    case "chats": return cmdChats(flags);
    case "plan": return printPlan(await buildPlan(flags));
    case "undo": return cmdUndo(flags);
    case "move": {
      const plan = await buildPlan(flags);
      printPlan(plan);
      if (flags.yes !== true) {
        console.log("Nothing has been created. Re-run with --yes to go ahead.");
        return;
      }
      await doMove(plan);
      return;
    }
    default:
      console.log(USAGE);
  }
}

// Only when run directly - the test imports the pure helpers above.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exitCode = 1;
  });
}
