import http from "node:http";
import { writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createStaticAppHandler } from "../static-app";

describe("static-app: prod staticDir mode, real 404 for missing assets", () => {
  let staticDir: string;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    staticDir = await mkdtemp(join(tmpdir(), "traycer-remote-static-test-"));
    await mkdir(join(staticDir, "assets"), { recursive: true });
    await writeFile(
      join(staticDir, "index.html"),
      "<!doctype html><title>app</title>",
    );
    await writeFile(
      join(staticDir, "assets", "index-abc123.js"),
      "console.log(1);",
    );
    await writeFile(join(staticDir, "manifest.webmanifest"), '{"name":"app"}');

    // Configure with FORWARD slashes deliberately, even though this test
    // may run on Windows - regression coverage for the separator-mismatch
    // bug the path-traversal guard had (join() always normalizes to the
    // native separator, so a raw forward-slash staticDir must be
    // normalized before the prefix check, or every file 404s).
    const forwardSlashDir = staticDir.split("\\").join("/");
    const handler = createStaticAppHandler({
      devUpstream: null,
      staticDir: forwardSlashDir,
    });
    server = http.createServer(handler);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("no address");
    port = address.port;
  });

  afterAll(async () => {
    server.close();
    await rm(staticDir, { recursive: true, force: true });
  });

  async function get(
    path: string,
  ): Promise<{ status: number; contentType: string; body: string }> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
    };
  }

  it("serves index.html at /", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toContain("<title>app</title>");
  });

  it("serves a real asset with the correct content-type", async () => {
    const res = await get("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/javascript");
    expect(res.body).toContain("console.log(1);");
  });

  it("serves manifest.webmanifest with the correct content-type", async () => {
    const res = await get("/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("application/manifest+json");
  });

  it("404s a missing asset-looking path - NOT the SPA-fallback trap", async () => {
    const res = await get("/assets/does-not-exist-B4XZ.js");
    expect(res.status).toBe(404);
    expect(res.contentType).not.toContain("text/html");
  });

  it("falls back to index.html for a client-side route (no file extension)", async () => {
    const res = await get("/some/client/route");
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toContain("<title>app</title>");
  });

  it("rejects path traversal", async () => {
    const res = await get("/../../etc/passwd");
    // Either 404 (blocked, treated as missing) or a fallback to index.html -
    // never a file outside staticDir.
    expect(res.body).not.toContain("root:");
  });
});
