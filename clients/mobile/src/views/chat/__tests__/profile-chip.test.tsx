// @vitest-environment jsdom
/**
 * M2 item 2 — committing which account a turn spends.
 *
 * ## Every assertion here is on the EMITTED VALUE, and that is not a style
 * ## choice
 *
 * The M2 ticket says sending the reserved `"ambient"` sentinel as a real
 * profile id is caught because "the schema `.refine()` rejects" it. It does
 * not. That refine lives on `agent.create`'s `profileSelection`;
 * `ChatRunSettings.profileId` is a bare `z.string().nullable()`
 * (`foundation.ts`) and accepts the sentinel silently.
 *
 * So a test written the ticket's way — expecting a rejection — would pass
 * against a completely broken implementation, because nothing rejects
 * anything. The only observable that the defect cannot fake is **what value
 * actually goes out**.
 *
 * Fixtures parse through `providerCliStateSchema`.
 */
import { describe, expect, it } from "vitest";
import {
  providerCliStateSchema,
  type ProviderCliState,
} from "@traycer/protocol/host/provider-schemas";
import type { ChatRunSettings } from "@traycer/protocol/persistence/epic/foundation";
import {
  guiAgentModelOptionSchema,
  guiHarnessOptionSchema,
} from "@traycer/protocol/host/agent/gui/unary-schemas";
import { Composer, type ComposerProps } from "@/views/chat/composer";
import { HostClientProvider } from "@/host/host-client-context";
import { resetDraftsForTest } from "@/router/drafts";
import { createFakeHostClient, type FakeHostClient } from "@/test-utils/fakes";
import { fireEvent, render, screen, waitFor } from "@/test-utils/dom";

function profile(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    profileId: "p-managed",
    kind: "managed",
    authType: "oauth",
    label: "Work account",
    auth: { status: "authenticated", label: null, badgeText: null, detail: null },
    identity: null,
    usageUpdatedAt: null,
    rateLimitStatus: "ok",
    rateLimitLimitedScopes: [],
    duplicateOfProfileId: null,
    ambientDriftNotice: null,
    accentColor: null,
    ...overrides,
  };
}

/** The shape a real host sends: the ambient row keys itself by the LITERAL sentinel. */
const AMBIENT = profile({
  profileId: "ambient",
  kind: "ambient",
  label: "Terminal account",
});
const MANAGED = profile({ profileId: "p-work", label: "Work account" });

function provider(profiles: readonly Record<string, unknown>[]): ProviderCliState {
  return providerCliStateSchema.parse({
    providerId: "claude-code",
    enabled: true,
    disabledBy: null,
    selected: { kind: "bundled" },
    candidates: [],
    authPending: false,
    checkedAt: null,
    apiKey: { supported: false, configured: false, source: null },
    auth: { status: "authenticated", label: null, badgeText: null, detail: null },
    profiles,
  });
}

function hostWith(providers: readonly ProviderCliState[]): FakeHostClient {
  return createFakeHostClient((method) => {
    if (method === "providers.list") return Promise.resolve({ providers });
    if (method === "agent.gui.listHarnesses") {
      return Promise.resolve({
        harnesses: [
          guiHarnessOptionSchema.parse({
            id: "claude",
            label: "Claude Code",
            available: true,
            error: null,
            modes: ["gui"],
            requiresApiKey: false,
            availabilityPending: false,
          }),
        ],
      });
    }
    if (method === "agent.gui.listModels") {
      return Promise.resolve({
        harnessId: "claude",
        models: [
          guiAgentModelOptionSchema.parse({
            harnessId: "claude",
            slug: "m1",
            label: "Model One",
            description: null,
            contextWindow: null,
            maxOutputTokens: null,
            defaultReasoningEffort: null,
            supportedReasoningEfforts: [],
            metadata: {},
          }),
        ],
      });
    }
    if (method === "host.getRateLimitUsage") {
      return Promise.resolve({ totalTokens: null, remainingTokens: null, providerRateLimits: null });
    }
    return Promise.reject(new Error(`unexpected RPC: ${method}`));
  });
}

function renderComposer(
  fake: FakeHostClient,
  onSend: (text: string, settings: ChatRunSettings) => void,
  overrides: Partial<ComposerProps>,
): void {
  resetDraftsForTest();
  render(
    <HostClientProvider client={fake.client}>
      <Composer
        chatId="c1"
        client={fake.client}
        mentionRoots={[]}
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
        onSend={(text, settings) => onSend(text, settings)}
        onStop={() => {}}
        {...overrides}
      />
    </HostClientProvider>,
  );
}

async function send(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText("Message this agent…"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("Composer — profile selection (M2 item 2)", () => {
  it("emits NULL for the ambient profile, never the \"ambient\" sentinel", async () => {
    // THE test. There is no schema rejection to observe, so this asserts the
    // value on the wire. A composer committing `profile.profileId` verbatim
    // would emit the string "ambient" and nothing downstream would complain.
    const sent: ChatRunSettings[] = [];
    const fake = hostWith([provider([AMBIENT, MANAGED])]);
    renderComposer(fake, (_t, s) => sent.push(s), {});

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("button", { name: /Terminal account/ }));

    await send("go");
    expect(sent).toHaveLength(1);
    expect(sent[0].profileId).toBeNull();
    expect(sent[0].profileId).not.toBe("ambient");
  });

  it("emits a managed profile's real id", async () => {
    const sent: ChatRunSettings[] = [];
    const fake = hostWith([provider([AMBIENT, MANAGED])]);
    renderComposer(fake, (_t, s) => sent.push(s), {});

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("button", { name: /Work account/ }));

    await send("go");
    expect(sent[0].profileId).toBe("p-work");
  });

  it("seeds from chatSettings and round-trips a managed id untouched", async () => {
    const sent: ChatRunSettings[] = [];
    const fake = hostWith([provider([AMBIENT, MANAGED])]);
    renderComposer(fake, (_t, s) => sent.push(s), {
      chatSettings: {
        harnessId: "claude",
        model: "m1",
        permissionMode: "full_access",
        reasoningEffort: null,
        serviceTier: null,
        agentMode: "regular",
        profileId: "p-work",
      },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Account" }).textContent).toContain("Work account");
    });
    await send("go");
    expect(sent[0].profileId).toBe("p-work");
  });

  it("renders no chip when the provider has only one profile — that is not a choice", async () => {
    const fake = hostWith([provider([AMBIENT])]);
    renderComposer(fake, () => {}, {});

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Model" })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  });

  it("renders no chip for a harness with no provider-CLI concept", async () => {
    // `traycer` maps to no provider. The chip must render nothing rather than
    // guessing at some other provider's accounts.
    const fake = createFakeHostClient((method) => {
      if (method === "providers.list") return Promise.resolve({ providers: [provider([AMBIENT, MANAGED])] });
      if (method === "agent.gui.listHarnesses") {
        return Promise.resolve({
          harnesses: [
            guiHarnessOptionSchema.parse({
              id: "traycer",
              label: "Traycer",
              available: true,
              error: null,
              modes: ["gui"],
              requiresApiKey: false,
              availabilityPending: false,
            }),
          ],
        });
      }
      if (method === "agent.gui.listModels") {
        return Promise.resolve({ harnessId: "traycer", models: [] });
      }
      return Promise.reject(new Error(`unexpected RPC: ${method}`));
    });
    renderComposer(fake, () => {}, {
      chatSettings: {
        harnessId: "traycer",
        model: "m1",
        permissionMode: "full_access",
        reasoningEffort: null,
        serviceTier: null,
        agentMode: "regular",
        profileId: null,
      },
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Message this agent…")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  });
});
