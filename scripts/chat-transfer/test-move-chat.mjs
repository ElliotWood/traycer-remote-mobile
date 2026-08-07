#!/usr/bin/env node
// Covers the judgement, not the transport: fork-boundary selection, repo
// matching, path translation, and the verdicts. Those are where a bug is
// silent - a wrong boundary drops messages the report claims it carried, and a
// verdict that reads a value we supplied rather than one the host authored
// would pass on a move that never happened.
//
// The transport is exercised for real every time the tool runs; a fake WS
// host would only re-test our own fake. No network, no host: `node
// test-move-chat.mjs`.
import assert from "node:assert/strict";
import {
  collectChecks, findProfile, forkBoundary, repoFromMeta, resolveProfileForTarget, translateWorkspaces,
} from "./move-chat.mjs";
import { floorMethods } from "./rpc.mjs";

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ─── the handshake manifest ──────────────────────────────────────────────────

test("the floor manifest is parsed from the protocol source, non-empty and sane", () => {
  const methods = floorMethods();
  assert.ok(methods.length > 100, `expected the released floor, got ${methods.length} methods`);
  assert.ok(methods.includes("epic.createChat"));
  assert.ok(methods.includes("workspace.resolvePathsByRepoIdentifiers"));
  assert.ok(methods.includes("worktree.listBindingsForEpic"));
  // An empty or malformed manifest is answered with fatalError INCOMPATIBLE,
  // so a parse that silently yields junk must not look like success.
  assert.ok(methods.every((m) => /^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/.test(m)), `bad method name in ${methods}`);
});

// ─── fork boundary ───────────────────────────────────────────────────────────

const msg = (role, id) => ({ role, messageId: id });

test("boundary is the LAST assistant message", () => {
  const b = forkBoundary([msg("user", "u1"), msg("assistant", "a1"), msg("user", "u2"), msg("assistant", "a2")]);
  assert.equal(b.message.messageId, "a2");
  assert.equal(b.index, 3);
  assert.deepEqual(b.dropped, []);
});

test("trailing user messages are reported as dropped, not silently carried", () => {
  const b = forkBoundary([msg("user", "u1"), msg("assistant", "a1"), msg("user", "u2")]);
  assert.equal(b.message.messageId, "a1");
  assert.equal(b.dropped.length, 1);
  assert.equal(b.dropped[0].messageId, "u2");
});

test("a chat with no assistant turn has no boundary at all", () => {
  assert.equal(forkBoundary([msg("user", "u1")]), null);
  assert.equal(forkBoundary([]), null);
});

// ─── repo matching from the replicated folder table ──────────────────────────

const META = {
  workspaceFolders: [
    { workspacePath: "C:\\repo\\thing", repoIdentifier: { owner: "O", repo: "thing" } },
    { workspacePath: "C:\\repo\\thing\\packages\\inner", repoIdentifier: { owner: "O", repo: "inner" } },
    { workspacePath: "C:\\scratch", repoIdentifier: null },
  ],
};

test("matches a workspace to its repo, case- and separator-insensitively", () => {
  assert.deepEqual(repoFromMeta(META, "c:/repo/thing"), { owner: "O", repo: "thing" });
  assert.deepEqual(repoFromMeta(META, "C:\\repo\\thing"), { owner: "O", repo: "thing" });
});

test("a nested repo wins over its parent (longest prefix, not first hit)", () => {
  assert.deepEqual(repoFromMeta(META, "C:\\repo\\thing\\packages\\inner\\src"), { owner: "O", repo: "inner" });
});

test("a folder with no repo identity yields null rather than a neighbour's repo", () => {
  assert.equal(repoFromMeta(META, "C:\\scratch"), null);
  assert.equal(repoFromMeta(META, "C:\\elsewhere"), null);
  // Sibling directories must not match on a raw string prefix.
  assert.equal(repoFromMeta(META, "C:\\repo\\thing-other"), null);
});

// ─── path translation ────────────────────────────────────────────────────────

const HOST = { alias: "target", origin: "ws://x", hostId: "target-host" };
const resolvePaths = (mappings) => async () => mappings;

test("translates by repo identity, not by path", async () => {
  const result = await translateWorkspaces(HOST, [
    { workspacePath: "C:\\repo\\thing", worktreePath: null, branch: null, mode: "local", isPrimary: true, repoIdentifier: { owner: "O", repo: "thing" } },
  ], {
    branch: null,
    resolvePaths: resolvePaths([{ repoIdentifier: { owner: "O", repo: "thing" }, workspacePath: "/srv/repo/O/thing" }]),
  });
  assert.deepEqual(result.intentEntries, [
    { kind: "local", workspacePath: "/srv/repo/O/thing", repoIdentifier: { owner: "O", repo: "thing" }, isPrimary: true },
  ]);
  assert.equal(result.unmapped.length, 0);
});

test("a repo the target does not have is reported unmapped — never guessed at", async () => {
  const result = await translateWorkspaces(HOST, [
    { workspacePath: "C:\\repo\\absent", worktreePath: null, branch: null, mode: "local", isPrimary: true, repoIdentifier: { owner: "O", repo: "absent" } },
    { workspacePath: "C:\\scratch", worktreePath: null, branch: null, mode: "local", isPrimary: false, repoIdentifier: null },
  ], { branch: null, resolvePaths: resolvePaths([]) });
  assert.equal(result.intentEntries.length, 0);
  assert.equal(result.unmapped.length, 2);
  assert.match(result.unmapped[0].reason, /not checked out on the target/);
  assert.equal(result.unmapped[1].reason, "no repo identity");
});

test("--branch turns the primary folder into a worktree intent, and only the primary", async () => {
  const repoA = { owner: "O", repo: "a" };
  const repoB = { owner: "O", repo: "b" };
  const result = await translateWorkspaces(HOST, [
    { workspacePath: "C:\\a", worktreePath: null, branch: null, mode: "local", isPrimary: true, repoIdentifier: repoA },
    { workspacePath: "C:\\b", worktreePath: null, branch: null, mode: "local", isPrimary: false, repoIdentifier: repoB },
  ], {
    branch: "feature/x",
    resolvePaths: resolvePaths([
      { repoIdentifier: repoA, workspacePath: "/srv/a" },
      { repoIdentifier: repoB, workspacePath: "/srv/b" },
    ]),
  });
  assert.equal(result.intentEntries[0].kind, "worktree");
  assert.deepEqual(result.intentEntries[0].branch, { type: "existing", name: "feature/x" });
  assert.equal(result.intentEntries[1].kind, "local");
});

test("something is always primary, or the host has nothing to run in", async () => {
  const repo = { owner: "O", repo: "a" };
  const result = await translateWorkspaces(HOST, [
    { workspacePath: "C:\\a", worktreePath: null, branch: null, mode: "local", isPrimary: false, repoIdentifier: repo },
  ], { branch: null, resolvePaths: resolvePaths([{ repoIdentifier: repo, workspacePath: "/srv/a" }]) });
  assert.equal(result.intentEntries.filter((e) => e.isPrimary).length, 1);
});

// ─── verdicts ────────────────────────────────────────────────────────────────

const PLAN = {
  targetHost: HOST,
  sourceHostId: "source-host",
  chat: { id: "src", messages: [msg("user", "u1"), msg("assistant", "a1")] },
  boundary: { index: 1 },
};
const CREATED = {
  id: "new",
  hostId: "target-host",
  messages: [msg("user", "u1"), msg("assistant", "a1")],
  events: [{ type: "chat.forked", metadata: { sourceChatId: "src", sourceChatTitle: "Original" } }],
};
const SOURCE_AFTER = { hostId: "source-host", messages: [msg("user", "u1"), msg("assistant", "a1")] };
const ROWS = [{ hostId: "target-host", runningDir: "/srv/a", mode: "local", sources: [{ ownerId: "new" }] }];

const failures = (checks) => checks.filter(([, passed]) => !passed).map(([label]) => label);

test("a clean move passes every verdict", () => {
  const checks = collectChecks({
    plan: PLAN, newChatId: "new", created: CREATED, bindingRows: ROWS, sourceAfter: SOURCE_AFTER,
    sourceReadFrom: "source",
  });
  assert.deepEqual(failures(checks), []);
  assert.equal(checks.length, 7);
});

test("a binding row pointing at a folder that is not there fails", () => {
  const checks = collectChecks({
    plan: PLAN, newChatId: "new", created: CREATED, bindingRows: ROWS, sourceAfter: SOURCE_AFTER,
    missingDirs: ["/srv/a"],
  });
  assert.deepEqual(failures(checks), ["the bound folder exists on the target"]);
});

test("a chat bound to the wrong host fails, however healthy it otherwise looks", () => {
  const checks = collectChecks({
    plan: PLAN, newChatId: "new",
    created: { ...CREATED, hostId: "some-other-host" },
    bindingRows: ROWS, sourceAfter: SOURCE_AFTER,
  });
  assert.deepEqual(failures(checks), ["bound to target"]);
});

test("a short transcript fails — the count is checked, not assumed", () => {
  const checks = collectChecks({
    plan: PLAN, newChatId: "new",
    created: { ...CREATED, messages: [msg("user", "u1")] },
    bindingRows: ROWS, sourceAfter: SOURCE_AFTER,
  });
  assert.deepEqual(failures(checks), ["carries 2 message(s)"]);
});

test("a missing chat.forked event fails — provenance is not optional", () => {
  const checks = collectChecks({
    plan: PLAN, newChatId: "new", created: { ...CREATED, events: [] }, bindingRows: ROWS, sourceAfter: SOURCE_AFTER,
  });
  assert.deepEqual(failures(checks), ["records its source"]);
});

test("a binding row owned by a DIFFERENT host fails, even though a row exists", () => {
  const checks = collectChecks({
    plan: PLAN, newChatId: "new", created: CREATED,
    bindingRows: [{ ...ROWS[0], hostId: "some-other-host" }],
    sourceAfter: SOURCE_AFTER,
  });
  assert.deepEqual(failures(checks), ["binding owned by the expected host"]);
});

test("a worktree the host quietly declined to create is a FAILURE, not a pass", () => {
  const worktreePlan = {
    ...PLAN,
    workspace: { intentEntries: [{ kind: "worktree", isPrimary: true, branch: { type: "existing", name: "feature/x" } }] },
  };
  // The host answers a branch it cannot check out with a plain local binding
  // and reports success - measured against a live host.
  const declined = collectChecks({
    plan: worktreePlan, newChatId: "new", created: CREATED, bindingRows: ROWS,
    sourceAfter: SOURCE_AFTER, sourceReadFrom: "source",
  });
  assert.deepEqual(failures(declined), ["the requested worktree was actually created"]);

  const honoured = collectChecks({
    plan: worktreePlan, newChatId: "new", created: CREATED,
    bindingRows: [{ ...ROWS[0], mode: "worktree", worktreePath: "/srv/wt", branch: "feature/x" }],
    sourceAfter: SOURCE_AFTER, sourceReadFrom: "source",
  });
  assert.deepEqual(failures(honoured), []);
});

test("a plain local move gets no worktree verdict at all", () => {
  const checks = collectChecks({
    plan: { ...PLAN, workspace: { intentEntries: [{ kind: "local", isPrimary: true }] } },
    newChatId: "new", created: CREATED, bindingRows: ROWS, sourceAfter: SOURCE_AFTER, sourceReadFrom: "source",
  });
  assert.ok(!checks.some(([label]) => label.includes("worktree")));
});

test("a row owned by a different CHAT does not count as ours", () => {
  const checks = collectChecks({
    plan: PLAN, newChatId: "new", created: CREATED,
    bindingRows: [{ ...ROWS[0], sources: [{ ownerId: "someone-else" }] }],
    sourceAfter: SOURCE_AFTER,
  });
  assert.deepEqual(failures(checks), ["workspace bound on the target"]);
});

test("no workspace expected means no workspace verdicts, not silently passing ones", () => {
  const checks = collectChecks({
    plan: PLAN, newChatId: "new", created: CREATED, bindingRows: null, sourceAfter: SOURCE_AFTER,
  });
  assert.deepEqual(failures(checks), []);
  assert.equal(checks.length, 5); // the seven above, minus the two workspace verdicts
  assert.ok(!checks.some(([label]) => label.includes("workspace")));
});

test("a damaged source fails the move — the promise this tool makes", () => {
  const truncated = collectChecks({
    plan: PLAN, newChatId: "new", created: CREATED, bindingRows: ROWS,
    sourceAfter: { ...SOURCE_AFTER, messages: [msg("user", "u1")] },
    sourceReadFrom: "source",
  });
  assert.equal(failures(truncated).length, 1);

  const rebound = collectChecks({
    plan: PLAN, newChatId: "new", created: CREATED, bindingRows: ROWS,
    sourceAfter: { ...SOURCE_AFTER, hostId: "target-host" },
    sourceReadFrom: "source",
  });
  assert.equal(failures(rebound).length, 1);
});

test("the source verdict says WHICH host it read, and admits when it only read the replica", () => {
  const [label] = collectChecks({
    plan: PLAN, newChatId: "new", created: CREATED, bindingRows: ROWS,
    sourceAfter: SOURCE_AFTER, sourceReadFrom: "tonberry",
  }).at(-1);
  assert.match(label, /read from tonberry/);

  // The dangerous case: reading the source out of the TARGET's replica would
  // pass with the source machine switched off, so it must never claim more.
  const [replicaLabel] = collectChecks({
    plan: PLAN, newChatId: "new", created: CREATED, bindingRows: ROWS,
    sourceAfter: SOURCE_AFTER, sourceReadFrom: null,
  }).at(-1);
  assert.match(replicaLabel, /replica/);
  assert.match(replicaLabel, /NOT read/);
  assert.doesNotMatch(replicaLabel, /still intact/);
});

// ─── provider profile (P0: the target REJECTS a foreign profileId) ───────────

const providersWith = (profiles) => ({ providers: [{ providerId: "claude-code", profiles }] });
const AMBIENT = { profileId: "ambient", kind: "ambient", label: "Terminal account", identity: { accountUuid: null } };
const MANAGED = { profileId: "p-source", kind: "managed", label: "Work", identity: { accountUuid: "acct-1" } };
const SETTINGS = { harnessId: "claude", model: "sonnet", profileId: "p-source" };
const host = (alias) => ({ alias, origin: "ws://x", hostId: alias });

test("findProfile never matches the ambient row, whose wire id is the literal \"ambient\"", () => {
  assert.equal(findProfile(providersWith([AMBIENT, MANAGED]), "ambient"), null);
  assert.equal(findProfile(providersWith([AMBIENT, MANAGED]), "p-source").accountUuid, "acct-1");
});

test("a host-local profileId is NEVER passed through — the target rejects the whole call", async () => {
  const r = await resolveProfileForTarget(host("src"), host("tgt"), SETTINGS,
    async (h) => providersWith(h.alias === "src" ? [AMBIENT, MANAGED] : [AMBIENT]));
  assert.equal(r.settings.profileId, null);
  assert.equal(r.disposition, "ambient");
  assert.match(r.reason, /same account/);
});

test("a matching account on the target maps to ITS profileId, not the source's", async () => {
  const r = await resolveProfileForTarget(host("src"), host("tgt"), SETTINGS,
    async (h) => providersWith(h.alias === "src"
      ? [MANAGED]
      : [{ profileId: "p-target", kind: "managed", label: "Work", identity: { accountUuid: "acct-1" } }]));
  assert.equal(r.settings.profileId, "p-target");
  assert.equal(r.disposition, "mapped");
});

test("two unknown identities are not a match", async () => {
  const nullIdentity = { ...MANAGED, identity: { accountUuid: null } };
  const r = await resolveProfileForTarget(host("src"), host("tgt"), SETTINGS,
    async () => providersWith([nullIdentity]));
  assert.equal(r.settings.profileId, null);
  assert.equal(r.disposition, "ambient");
});

test("an unreachable source falls back to ambient rather than failing the move", async () => {
  const unreadable = await resolveProfileForTarget(null, host("tgt"), SETTINGS, async () => providersWith([]));
  assert.equal(unreadable.settings.profileId, null);

  const throwing = await resolveProfileForTarget(host("src"), host("tgt"), SETTINGS, async () => {
    throw new Error("could not reach src");
  });
  assert.equal(throwing.settings.profileId, null);
  assert.match(throwing.reason, /could not be read/);
});

test("a chat with no profile is left exactly alone", async () => {
  const plain = { harnessId: "claude", model: "sonnet", profileId: null };
  const r = await resolveProfileForTarget(host("src"), host("tgt"), plain, async () => {
    throw new Error("must not be called");
  });
  assert.equal(r.settings, plain);
  assert.equal(r.disposition, "none");
  assert.equal((await resolveProfileForTarget(host("src"), host("tgt"), null, async () => {
    throw new Error("must not be called");
  })).settings, null);
});

// ─── run ─────────────────────────────────────────────────────────────────────

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${error.message.split("\n").join("\n        ")}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exitCode = 1;
