import "../../../../../__tests__/test-browser-apis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The shell-supplied slot under the host list.
 *
 * `registerHostPickerExtra` exists so a shell that owns its own host list
 * (the browser/Teams shell fetches hosts over HTTP rather than reading a
 * desktop registry) has somewhere to put the UI that manages it. The
 * registration side is a module-level setter and trivially testable on its
 * own; what is NOT trivial, and what this file exists for, is that
 * `<HostPicker />` actually renders what was registered.
 *
 * That distinction is the whole point: a registration API whose consumer
 * never calls the getter is indistinguishable, from the shell's side, from
 * one that works — `registerHostPickerExtra` returns void and the shell has
 * no way to observe that its node was dropped. The dead half would only
 * surface as "the Manage hosts button isn't there" in a Teams tab nobody can
 * attach a debugger to.
 */

const mocks = vi.hoisted(() => ({
  selectById: vi.fn(),
  requestClose: vi.fn(),
}));

vi.mock("@/hooks/host/use-remote-hosts-plan-gate", () => ({
  useRemoteHostsPlanRestricted: () => false,
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => ({
    authnBaseUrl: "https://authn.traycer.ai",
    openExternalLink: () => Promise.resolve(),
    hostPicker: {
      isOpen: true,
      onChange: () => ({ dispose: () => undefined }),
      requestOpen: () => undefined,
      requestClose: mocks.requestClose,
    },
  }),
}));

vi.mock("@/lib/host", () => ({
  useHostBinding: () => ({
    directory: {
      selectById: mocks.selectById,
      onChange: () => ({ dispose: () => undefined }),
    },
    hostClient: {
      onChange: () => () => undefined,
      getActiveHostId: () => "local-1",
    },
  }),
}));

vi.mock("@/hooks/host/use-refresh-host-directory-on-open", () => ({
  useRefreshHostDirectoryOnOpen: () => undefined,
}));

vi.mock("@/hooks/host/use-host-picker-list", () => ({
  registerHostPickerDirectory: () => "picker-directory-1",
  useHostPickerList: () => ({
    isLoading: false,
    isError: false,
    data: [
      {
        hostId: "local-1",
        label: "This Mac",
        kind: "local",
        status: "available",
      },
    ],
  }),
}));

import { HostPicker } from "@/components/layout/header/host-picker";
import { registerHostPickerExtra } from "@/components/layout/header/host-picker-extra";

function renderPicker(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HostPicker />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  registerHostPickerExtra(null);
});

afterEach(() => {
  cleanup();
  registerHostPickerExtra(null);
  vi.clearAllMocks();
});

describe("HostPicker shell-supplied extra", () => {
  it("CONTROL: a shell that registers nothing gets the picker unchanged", () => {
    renderPicker();

    // The positive half — without it, "no extra rendered" is equally true of
    // a picker that rendered nothing at all.
    expect(screen.getByTestId("host-picker-option-local-1")).toBeDefined();
    expect(screen.queryByTestId("shell-extra")).toBeNull();
  });

  it("renders a registered node, under the host list", () => {
    registerHostPickerExtra(<div data-testid="shell-extra">Manage hosts</div>);
    renderPicker();

    const extra = screen.getByTestId("shell-extra");
    expect(extra.textContent).toBe("Manage hosts");

    // Placement is the contract, not just presence: the slot is documented as
    // sitting UNDER the host list, so a node rendered above it (or into some
    // other subtree) is the wrong answer even though `getByTestId` finds it.
    const lastOption = screen.getByTestId("host-picker-option-local-1");
    expect(
      lastOption.compareDocumentPosition(extra) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it("a registration made after the previous render is picked up by the next one", () => {
    renderPicker();
    expect(screen.queryByTestId("shell-extra")).toBeNull();
    cleanup();

    registerHostPickerExtra(<div data-testid="shell-extra">Manage hosts</div>);
    renderPicker();
    expect(screen.getByTestId("shell-extra")).toBeDefined();
  });
});
