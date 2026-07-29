import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateVapidKeys } from "../vapid-keys";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "push-service-vapid-"));
  path = join(dir, "vapid.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadOrCreateVapidKeys", () => {
  it("generates a keypair on first run and persists it", async () => {
    const keys = await loadOrCreateVapidKeys(path);
    expect(keys.publicKey.length).toBeGreaterThan(0);
    expect(keys.privateKey.length).toBeGreaterThan(0);
    expect(keys.subject.startsWith("mailto:")).toBe(true);

    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toEqual(keys);
  });

  it("reuses the same keypair on a second load — never regenerates", async () => {
    const first = await loadOrCreateVapidKeys(path);
    const second = await loadOrCreateVapidKeys(path);
    expect(second).toEqual(first);
  });

  it("survives a simulated process restart (fresh call against the same path)", async () => {
    const first = await loadOrCreateVapidKeys(path);
    // A fresh call with no shared in-memory state, exactly like a new process.
    const afterRestart = await loadOrCreateVapidKeys(path);
    expect(afterRestart.publicKey).toBe(first.publicKey);
    expect(afterRestart.privateKey).toBe(first.privateKey);
  });
});
