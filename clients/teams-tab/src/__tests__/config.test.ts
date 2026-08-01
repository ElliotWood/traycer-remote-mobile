import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigProblem } from "../config";

/**
 * `config.ts` reads `import.meta.env` at MODULE LOAD, so each case stubs the
 * env and re-imports rather than calling a function with arguments. That is
 * the shape of the thing under test: the values are build-time constants, and
 * a test that passed them in would not be testing this module.
 */
async function problemsFor(
  env: Readonly<Record<string, string>>,
): Promise<readonly ConfigProblem[]> {
  vi.resetModules();
  vi.stubEnv("VITE_AUTHN_BASE_URL", env.VITE_AUTHN_BASE_URL ?? "");
  vi.stubEnv("VITE_HOST_WS_URL", env.VITE_HOST_WS_URL ?? "");
  vi.stubEnv("VITE_HOST_ID", env.VITE_HOST_ID ?? "");
  const mod = await import("../config");
  return mod.configProblems();
}

const COMPLETE = {
  VITE_AUTHN_BASE_URL: "https://example.invalid/authn",
  VITE_HOST_WS_URL: "wss://example.invalid/rpc",
  VITE_HOST_ID: "a1000000-0000-4000-8000-000000000e91",
};

const keys = (problems: readonly ConfigProblem[]): readonly string[] =>
  problems.map((p) => p.key);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configProblems — a fully configured build", () => {
  it("reports nothing", async () => {
    expect(await problemsFor(COMPLETE)).toEqual([]);
  });

  it("accepts http as well as https, for a local host", async () => {
    expect(
      await problemsFor({
        ...COMPLETE,
        VITE_AUTHN_BASE_URL: "http://127.0.0.1:8080/authn",
      }),
    ).toEqual([]);
  });
});

describe("configProblems — nothing has a default that would start against the wrong host", () => {
  it("names each missing variable", async () => {
    expect(keys(await problemsFor({ ...COMPLETE, VITE_HOST_WS_URL: "" }))).toEqual(
      ["VITE_HOST_WS_URL"],
    );
    expect(keys(await problemsFor({ ...COMPLETE, VITE_HOST_ID: "" }))).toEqual([
      "VITE_HOST_ID",
    ]);
    expect(
      keys(await problemsFor({ ...COMPLETE, VITE_AUTHN_BASE_URL: "" })),
    ).toEqual(["VITE_AUTHN_BASE_URL"]);
  });

  it("CONTRACT: an entirely unconfigured build reports all three at once", async () => {
    // Reported together, not one per reload. There is no address bar and no
    // easy console inside Teams, so a build that surfaces one problem per
    // deploy cycle costs three deploys.
    expect(keys(await problemsFor({}))).toEqual([
      "VITE_AUTHN_BASE_URL",
      "VITE_HOST_WS_URL",
      "VITE_HOST_ID",
    ]);
  });

  it("every problem carries a detail, not just a key", async () => {
    for (const problem of await problemsFor({})) {
      expect(problem.detail.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("configProblems — the relative authn URL", () => {
  it("CONTRACT: a relative authn base is a problem, not an accepted value", async () => {
    // `new URL(relative, base)` throws while BUILDING the request, so
    // sign-in fails with zero network traffic: no failed request in
    // devtools, no server log, nothing to find. That cost the PWA a long
    // debugging session, and `.env.example` still suggests this form.
    expect(keys(await problemsFor({ ...COMPLETE, VITE_AUTHN_BASE_URL: "/authn" }))).toEqual(
      ["VITE_AUTHN_BASE_URL"],
    );
  });

  it("explains that the failure is invisible, and quotes the offending value", async () => {
    const [problem] = await problemsFor({
      ...COMPLETE,
      VITE_AUTHN_BASE_URL: "/authn",
    });
    expect(problem?.detail).toContain("/authn");
    expect(problem?.detail).toMatch(/without a single network call/i);
  });

  it("CONTRACT: 'missing' and 'relative' are different problems", async () => {
    // Both are reported under the same key, so the detail is the only thing
    // telling a deployer which of two different fixes applies.
    const [missing] = await problemsFor({ ...COMPLETE, VITE_AUTHN_BASE_URL: "" });
    const [relative] = await problemsFor({
      ...COMPLETE,
      VITE_AUTHN_BASE_URL: "/authn",
    });
    expect(missing?.key).toBe(relative?.key);
    expect(missing?.detail).not.toBe(relative?.detail);
  });

  it("rejects other non-absolute forms too", async () => {
    for (const raw of ["example.invalid/authn", "//example.invalid/authn", "authn"]) {
      expect(keys(await problemsFor({ ...COMPLETE, VITE_AUTHN_BASE_URL: raw }))).toEqual(
        ["VITE_AUTHN_BASE_URL"],
      );
    }
  });
});
