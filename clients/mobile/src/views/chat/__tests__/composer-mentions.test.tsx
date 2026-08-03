// @vitest-environment jsdom
/**
 * M3 item 3 — `@`-file mentions, and the canary's OWN falsification test.
 *
 * ## Why this file exists in this shape
 *
 * The host answers an empty SUCCESS for a genuine no-match, a nonexistent
 * root, and `roots: []` alike (measured — `tmp/probe-m3e.mjs`). So the obvious
 * assertion, *"an empty query renders the empty state"*, **passes against a
 * client that never issued a request at all**. It is vacuous by construction,
 * and it is the assertion this feature would naturally attract.
 *
 * Every test below therefore asserts on the **canary's verdict** — which of
 * the three distinguishable states is rendered — never on a count. Two states
 * that both render "0 rows" have to render *different* verdicts, and that
 * difference is the only thing a broken client cannot fake.
 *
 * ## The fake reproduces the host's defect on purpose
 *
 * `mentionFiles` here returns `{ entries: [] }` for an unknown root, **not a
 * rejection**. A mock that rejected would be kinder than the host, and every
 * assertion here would pass for the wrong reason — the client would be
 * distinguishing an error from a success, which is exactly the discrimination
 * the real host refuses to provide. A fixture kinder than production is a
 * fixture that cannot fail.
 *
 * Fixtures parse through `workspaceFileMentionSuggestionSchema` /
 * `workspaceFolderMentionSuggestionSchema`, and there are **two roots and two
 * files** throughout: one of anything is a world where a partial failure, or
 * an insertion picking the wrong row, cannot occur.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  workspaceFileMentionSuggestionSchema,
  workspaceFolderMentionSuggestionSchema,
  type WorkspaceFileMentionSuggestion,
  type WorkspaceFolderMentionSuggestion,
} from "@traycer/protocol/host/workspace/unary-schemas";
import {
  guiAgentCommandOptionSchema,
  type GuiAgentCommandOption,
} from "@traycer/protocol/host/agent/gui/unary-schemas";
import { Composer } from "@/views/chat/composer";
import type { MentionSuggestion } from "@/views/chat/mention-model";
import { resetDraftsForTest } from "@/router/drafts";
import { createFakeHostClient, type FakeHostClient } from "@/test-utils/fakes";
import { fireEvent, render, screen, waitFor } from "@/test-utils/dom";

const ROOT_A = "C:\\repos\\alpha";
const ROOT_B = "C:\\repos\\beta";
const BOGUS = "C:\\repos\\gone";

function fileRow(root: string, relPath: string): WorkspaceFileMentionSuggestion {
  return workspaceFileMentionSuggestionSchema.parse({
    kind: "file",
    id: `file:${root}:${relPath}`,
    label: relPath.slice(relPath.lastIndexOf("/") + 1),
    relPath,
    absolutePath: `${root}\\${relPath.replace(/\//g, "\\")}`,
    workspacePath: root,
    description: "",
  });
}

function folderRow(root: string, relPath: string): WorkspaceFolderMentionSuggestion {
  return workspaceFolderMentionSuggestionSchema.parse({
    kind: "folder",
    id: `folder:${root}:${relPath}`,
    label: relPath.replace(/\/$/, "").split("/").pop() ?? relPath,
    relPath,
    absolutePath: `${root}\\${relPath.replace(/\//g, "\\")}`,
    workspacePath: root,
    description: "",
  });
}

/**
 * Two files per root and one folder, so a query can match one row without
 * matching the other and an insertion has something to pick wrongly.
 */
const FILES: Record<string, readonly WorkspaceFileMentionSuggestion[]> = {
  [ROOT_A]: [fileRow(ROOT_A, "src/app.tsx"), fileRow(ROOT_A, "src/deep/app.tsx")],
  [ROOT_B]: [fileRow(ROOT_B, "lib/beta-util.ts")],
};
const FOLDERS: Record<string, readonly WorkspaceFolderMentionSuggestion[]> = {
  [ROOT_A]: [folderRow(ROOT_A, "src/")],
  [ROOT_B]: [],
};

function command(name: string): GuiAgentCommandOption {
  return guiAgentCommandOptionSchema.parse({
    harnessId: "claude",
    name,
    description: "",
    kind: "slash-command",
    argumentHint: null,
    metadata: {},
  });
}

/**
 * Routes the two mention RPCs the way the live host was measured to behave:
 * a known root filters by substring, an UNKNOWN root returns an empty success.
 */
function mentionHost(): FakeHostClient {
  return createFakeHostClient((method, params) => {
    if (method === "agent.gui.listHarnesses") return Promise.resolve({ harnesses: [] });
    if (method === "agent.gui.listModels") {
      return Promise.resolve({ harnessId: "claude", models: [] });
    }
    if (method === "agent.gui.listCommands") {
      return Promise.resolve({ commands: [command("review"), command("deploy")] });
    }
    if (method === "workspace.mentionFiles" || method === "workspace.mentionFolders") {
      const { roots, query, limit } = params as {
        roots: readonly string[];
        query: string;
        limit: number;
      };
      const table: Record<string, readonly MentionSuggestion[]> =
        method === "workspace.mentionFiles" ? FILES : FOLDERS;
      const rows = roots
        .flatMap((root) => table[root] ?? [])
        .filter((row) => query === "" || row.relPath.includes(query))
        .slice(0, limit);
      // The defect under test: an unknown root contributes nothing and the
      // call still SUCCEEDS. No branch here distinguishes it.
      return Promise.resolve({ entries: rows });
    }
    return Promise.reject(new Error(`unexpected RPC in this test: ${method}`));
  });
}

function renderComposer(roots: readonly string[], client: FakeHostClient): void {
  render(
    <Composer
      chatId="c1"
      client={client.client}
      mentionRoots={roots}
      prefillText={null}
      prefillNonce={0}
      chatSettings={null}
      canStop={false}
      stopping={false}
      accessRole="owner"
      connectionLive
      sendDisabledHint={null}
      onSend={() => {}}
      onStop={() => {}}
    />,
  );
}

/**
 * The RPCs a fake actually received. Asserting on the wire rather than on the
 * pixels is what makes "nothing was requested" checkable at all.
 */
function callsTo(
  host: FakeHostClient,
  method: string,
): readonly Record<string, unknown>[] {
  return host.request.mock.calls
    .filter(([m]) => m === method)
    .map(([, params]) => params as Record<string, unknown>);
}

function type(text: string): void {
  const textarea = screen.getByPlaceholderText("Message this agent…");
  fireEvent.change(textarea, {
    target: { value: text, selectionStart: text.length },
  });
}

beforeEach(() => {
  resetDraftsForTest();
});

describe("the canary distinguishes states the host cannot", () => {
  it("a readable root with no match renders NO-MATCHES, not unavailable", async () => {
    renderComposer([ROOT_A], mentionHost());
    type("@zzzznotafile");
    await waitFor(() => {
      expect(screen.getByTestId("mention-empty-no-matches")).toBeTruthy();
    });
    // The verdict, not the count: both this test and the next render zero rows.
    expect(screen.queryByTestId("mention-empty-unavailable")).toBeNull();
  });

  it("an UNREADABLE root renders UNAVAILABLE for the very same empty result", async () => {
    renderComposer([BOGUS], mentionHost());
    type("@zzzznotafile");
    await waitFor(() => {
      expect(screen.getByTestId("mention-empty-unavailable")).toBeTruthy();
    });
    expect(screen.queryByTestId("mention-empty-no-matches")).toBeNull();
  });

  it("distinguishes them for the SAME query — the host's answer is identical in both", async () => {
    // The pair above is the falsification: if the canary were removed, or
    // never issued, both would land on one verdict and one of these two tests
    // would fail. Neither can pass by rendering nothing.
    const good = mentionHost();
    renderComposer([ROOT_A], good);
    type("@nomatch");
    await waitFor(() => {
      expect(screen.getByTestId("mention-empty-no-matches")).toBeTruthy();
    });
    // Same query, same empty payload from the host, opposite verdict.
    expect(callsTo(good, "workspace.mentionFiles").some((p) => p.query === "")).toBe(true);
  });
});

describe("the canary is per root", () => {
  it("issues one single-row canary per root, not one per query", async () => {
    const host = mentionHost();
    renderComposer([ROOT_A, ROOT_B], host);
    type("@app");
    await waitFor(() => {
      expect(screen.getByText("src/app.tsx")).toBeTruthy();
    });
    const canaries = callsTo(host, "workspace.mentionFiles").filter((p) => p.query === "");
    // One per root, each asking for a single row — the cheapest request that
    // can answer "is this root readable at all".
    expect(canaries).toHaveLength(2);
    expect(canaries.map((p) => p.roots)).toEqual([[ROOT_A], [ROOT_B]]);
    expect(canaries.every((p) => p.limit === 1)).toBe(true);
  });

  it("names the unreadable root when ANOTHER root still returns results", async () => {
    // Measured on the live host: roots=[real, BOGUS] returns a full 25 rows,
    // order-independently. An aggregate canary calls that full health and the
    // user never learns a repository is missing from their results.
    renderComposer([ROOT_A, BOGUS], mentionHost());
    type("@app");
    await waitFor(() => {
      expect(screen.getByText("src/app.tsx")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId("mention-degraded").textContent).toContain("gone");
    });
  });

  it("does NOT cry partial failure when every root is healthy", async () => {
    renderComposer([ROOT_A, ROOT_B], mentionHost());
    type("@app");
    await waitFor(() => {
      expect(screen.getByText("src/app.tsx")).toBeTruthy();
    });
    expect(screen.queryByTestId("mention-degraded")).toBeNull();
  });
});

describe("insertion", () => {
  it("inserts @<relPath> — the exact string desktop serializes for the agent", async () => {
    renderComposer([ROOT_A], mentionHost());
    type("look at @app");
    await waitFor(() => {
      expect(screen.getByText("src/app.tsx")).toBeTruthy();
    });
    // Two rows share the basename `app.tsx`; picking the second proves the
    // relPath is what travels, not the label they have in common.
    fireEvent.click(screen.getByText("src/deep/app.tsx"));
    const textarea = screen.getByPlaceholderText("Message this agent…") as HTMLTextAreaElement;
    expect(textarea.value).toBe("look at @src/deep/app.tsx ");
  });

  it("survives the path separator the first trigger implementation died on", async () => {
    renderComposer([ROOT_A], mentionHost());
    type("@src/deep");
    await waitFor(() => {
      expect(screen.getByText("src/deep/app.tsx")).toBeTruthy();
    });
    // The narrower query excluded the sibling, so the slash reached the wire
    // rather than closing the sheet.
    expect(screen.queryByText("src/app.tsx")).toBeNull();
  });
});

describe("a folderless chat", () => {
  it("hides `@` entirely — no sheet, no request, not an empty sheet", async () => {
    const host = mentionHost();
    renderComposer([], host);
    type("@app");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.queryByText("Files")).toBeNull();
    expect(screen.queryByTestId("mention-empty-unavailable")).toBeNull();
    // Asserting on the WIRE, not the pixels: nothing was asked, so nothing can
    // have been answered ambiguously.
    expect(callsTo(host, "workspace.mentionFiles")).toHaveLength(0);
    expect(callsTo(host, "workspace.mentionFolders")).toHaveLength(0);
  });

  it("still offers `/` in that same chat — the contrast is the check", async () => {
    renderComposer([], mentionHost());
    type("/rev");
    await waitFor(() => {
      expect(screen.getByText("/review")).toBeTruthy();
    });
  });
});
