// @vitest-environment jsdom
/**
 * M3 — the `/` suggestion sheet. The last of the three sheets to get a test,
 * and writing it found what the asymmetry was hiding.
 *
 * ## The fixture carries the identity hazard, because one of anything is a
 * world where the bug cannot occur
 *
 * `slash-command` and `skill` are different things that RUN differently, and
 * the host genuinely ships both under names that collide (its own catalogue
 * has 35 and 31). The React key is `${kind}:${name}`, so a list keyed or
 * picked by NAME alone renders and behaves perfectly right up until two
 * entries share one — then it hands the agent the wrong one, silently.
 * So the fixture has two commands called `review`, one of each kind. A
 * single-kind fixture cannot see that at all.
 *
 * ## What is NOT asserted here, deliberately
 *
 * The description's `-webkit-line-clamp` is a style declaration; jsdom cannot
 * see two lines of text become three. Asserting it would observe someone
 * deleting the line, not the behaviour — a tripwire, not coverage, and this
 * epic has a habit of recording the first as the second. It is left out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  guiAgentCommandOptionSchema,
  type GuiAgentCommandOption,
} from "@traycer/protocol/host/agent/gui/unary-schemas";
import { NavHost } from "@/router/nav-host";
import { Composer } from "@/views/chat/composer";
import { CommandSheet } from "@/views/chat/command-sheet";
import { resetDraftsForTest } from "@/router/drafts";
import { createFakeHostClient, type FakeHostClient } from "@/test-utils/fakes";
import { fireEvent, render, screen, waitFor } from "@/test-utils/dom";

function command(
  name: string,
  extra: Partial<GuiAgentCommandOption>,
): GuiAgentCommandOption {
  return guiAgentCommandOptionSchema.parse({
    harnessId: "claude",
    name,
    description: "",
    argumentHint: null,
    kind: "slash-command",
    metadata: {},
    ...extra,
  });
}

/** Two `review`s differing only by kind — plus a bare command with neither
 * a description nor an argument hint, since both are optional on the wire. */
const COMMANDS: readonly GuiAgentCommandOption[] = [
  command("review", { kind: "slash-command", description: "Review a diff.", argumentHint: "<sha>" }),
  command("review", { kind: "skill", description: "The review skill." }),
  command("deploy", {}),
];

/** The sheet's own rows: buttons whose label starts with the `/` it inserts.
 * Scoped this way rather than by index so the ✕ can never be counted as one. */
function commandRows(): HTMLElement[] {
  return screen
    .getAllByRole("button")
    .filter((el) => (el.textContent ?? "").startsWith("/"));
}

describe("CommandSheet", () => {
  beforeEach(() => {
    window.history.pushState(null, "");
  });

  it("renders a row per command, with the kind visible on each", () => {
    render(<CommandSheet commands={COMMANDS} phase="loaded" onPick={() => {}} onClose={() => {}} />);

    const rows = commandRows();
    expect(rows).toHaveLength(COMMANDS.length);

    // The two `review`s must be distinguishable ON SCREEN. `kind` is shown as
    // a word, not a colour or an icon alone: the pair below is the reason.
    const reviews = rows.filter((el) => (el.textContent ?? "").startsWith("/review"));
    expect(reviews).toHaveLength(2);
    expect(reviews.map((el) => el.textContent)).toEqual([
      expect.stringContaining("Command"),
      expect.stringContaining("Skill"),
    ]);

    // The argument hint rides along with the name it belongs to, not the row
    // below it.
    expect(reviews[0]?.textContent).toContain("<sha>");
    expect(reviews[1]?.textContent).not.toContain("<sha>");
  });

  it("hands back the command that was TAPPED, not the first one sharing its name", () => {
    const onPick = vi.fn();
    render(<CommandSheet commands={COMMANDS} phase="loaded" onPick={onPick} onClose={() => {}} />);

    const skillRow = commandRows().find((el) => (el.textContent ?? "").includes("Skill"));
    if (skillRow === undefined) throw new Error("no skill row");
    fireEvent.click(skillRow);

    // Not `toHaveBeenCalled()`: picking the OTHER `review` would satisfy that,
    // and picking the other `review` is the defect.
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(COMMANDS[1]);
  });

  it("renders no empty description NODE for a command that has none", () => {
    // Asserted on the node count, not on `textContent`. An unguarded
    // `{command.description}` renders an empty element that contributes no
    // text at all — so the obvious `textContent` assertion passes against the
    // very defect this test exists for, while reading as though it caught it.
    render(
      <CommandSheet
        commands={[command("deploy", {}), command("ship", { description: "Ship it." })]}
        phase="loaded"
        onPick={() => {}}
        onClose={() => {}}
      />,
    );

    const [bare, described] = commandRows();
    if (bare === undefined || described === undefined) throw new Error("missing rows");
    expect(bare.textContent).toBe("/deployCommand");
    // The pair is the point: one node for the name alone, two when there is a
    // description to show. A single-row fixture cannot tell "guarded" from
    // "never renders descriptions at all".
    expect(bare.children[1]?.childElementCount).toBe(1);
    expect(described.children[1]?.childElementCount).toBe(2);
  });

  /*
   * Dismissal is `BottomSheet`'s, and it routes through `NavHost` so the OS
   * back gesture closes the sheet instead of popping the chat out from under
   * it. Asserted here rather than assumed from the shared shell: a caller that
   * wired its own close would pass every test above and leave an orphan
   * history entry, so the user's next back tap appears to do nothing.
   */
  describe("dismissal goes through the navigation model", () => {
    function renderInNavHost(onClose: () => void, onPopRoutes: (count: number) => void): void {
      render(
        <NavHost routeDepth={1} onPopRoutes={onPopRoutes}>
          <CommandSheet commands={COMMANDS} phase="loaded" onPick={() => {}} onClose={onClose} />
        </NavHost>,
      );
    }

    it("closes on the ✕, without popping the route underneath", async () => {
      const onClose = vi.fn();
      const onPopRoutes = vi.fn();
      renderInNavHost(onClose, onPopRoutes);

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      expect(onPopRoutes).not.toHaveBeenCalled();
    });

    it("closes on the OS back gesture, which is the same path", async () => {
      const onClose = vi.fn();
      const onPopRoutes = vi.fn();
      renderInNavHost(onClose, onPopRoutes);

      window.history.back();

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      expect(onPopRoutes).not.toHaveBeenCalled();
    });
  });
});

/*
 * ─── The seam: what the composer actually reaches ───────────────────────────
 *
 * Everything above holds against a composer that never mounts this sheet, and
 * this epic has now found that shape four times. So the reachability of each
 * of the sheet's states gets asserted from the CALL SITE.
 *
 * These four began as a record of a GAP: the mount was gated on there being
 * at least one row, so three of the four states below rendered nothing at
 * all, and `/` went permanently inert after a single failed request. They now
 * assert the fix. The set is kept together deliberately — each of the three
 * empty states renders zero rows, so any one of them alone is satisfied by a
 * component that renders zero rows for every reason. Only the contrast is
 * evidence.
 */
describe("Composer — which of the sheet's states are reachable", () => {
  beforeEach(() => {
    resetDraftsForTest();
  });

  function hostWith(listCommands: () => Promise<unknown>): FakeHostClient {
    return createFakeHostClient((method) => {
      if (method === "agent.gui.listHarnesses") return Promise.resolve({ harnesses: [] });
      if (method === "agent.gui.listModels") {
        return Promise.resolve({ harnessId: "claude", models: [] });
      }
      if (method === "agent.gui.listCommands") return listCommands();
      return Promise.reject(new Error(`unexpected RPC in this test: ${method}`));
    });
  }

  function renderComposer(client: FakeHostClient): void {
    render(
      <Composer
        chatId="c1"
        client={client.client}
        mentionRoots={[]}
        primaryMentionRoot={null}
        prefillText={null}
        prefillNonce={0}
        chatSettings={null}
        // Snapshot HAS arrived; this chat simply has no settings chosen yet
        // (a new chat). Not the pre-snapshot `unknown` state -- see composer.tsx.
        settingsLoaded={true}
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

  function typeSlash(text: string): void {
    const textarea = screen.getByPlaceholderText("Message this agent…");
    fireEvent.change(textarea, { target: { value: text, selectionStart: text.length } });
  }

  const loaded = (): Promise<unknown> => Promise.resolve({ commands: COMMANDS });

  it("opens the sheet on `/` and lists the harness's catalogue", async () => {
    renderComposer(hostWith(loaded));
    typeSlash("/rev");

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
    });
    // `/rev` matches both `review`s and neither `deploy`.
    expect(commandRows()).toHaveLength(2);
  });

  it("says it is LOADING while the catalogue is in flight, rather than nothing", async () => {
    renderComposer(hostWith(() => new Promise(() => {/* never settles */})));
    typeSlash("/rev");

    await waitFor(() => {
      expect(screen.getByTestId("command-empty-loading")).toBeTruthy();
    });
    // The verdict, not the count. All three empty states render zero rows, so
    // a test asserting "no rows" passes against every one of them — including
    // the two that are wrong.
    expect(screen.queryByTestId("command-empty-no-matches")).toBeNull();
    expect(screen.queryByTestId("command-empty-undetermined")).toBeNull();
  });

  it("says it CANNOT TELL when the catalogue request failed — not 'no matches'", async () => {
    // The arm the boolean discarded. A dropped socket used to make `/` inert
    // for the rest of the session with nothing on screen; the nearest wrong
    // answer available to it is "No matching commands.", which is a confident
    // claim about a catalogue this client never received.
    const host = hostWith(() => Promise.reject(new Error("socket dropped")));
    renderComposer(host);

    await waitFor(() => {
      expect(host.request.mock.calls.some(([m]) => m === "agent.gui.listCommands")).toBe(true);
    });
    typeSlash("/rev");

    await waitFor(() => {
      expect(screen.getByTestId("command-empty-undetermined")).toBeTruthy();
    });
    expect(screen.queryByTestId("command-empty-no-matches")).toBeNull();
  });

  it("says NO MATCHES for a query the loaded catalogue really does not have", async () => {
    // The pair that makes the two above falsifiable: this renders zero rows
    // for a DIFFERENT reason, and must reach a different verdict. If the
    // phase were dropped again, these three collapse onto one and two fail.
    renderComposer(hostWith(loaded));
    typeSlash("/zzzznotacommand");

    await waitFor(() => {
      expect(screen.getByTestId("command-empty-no-matches")).toBeTruthy();
    });
    expect(screen.queryByTestId("command-empty-undetermined")).toBeNull();
    expect(screen.queryByTestId("command-empty-loading")).toBeNull();
  });
});
