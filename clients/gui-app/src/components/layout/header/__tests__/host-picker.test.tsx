import "../../../../../__tests__/test-browser-apis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * The host picker's paid-plan gating: on a free plan, remote rows are inert
 * with a "Paid plan" affordance and the upsell notice links to subscription
 * management; on a paid plan the same rows select normally. The plan verdict
 * itself is `useRemoteHostsPlanRestricted`'s (tested separately) — here it is
 * driven directly.
 */

interface PickerEntry {
  readonly hostId: string;
  readonly label: string;
  readonly kind: string;
  readonly status: string;
}

const DEFAULT_ENTRIES: readonly PickerEntry[] = [
  { hostId: "local-1", label: "This Mac", kind: "local", status: "available" },
  {
    hostId: "remote-1",
    label: "Office workstation",
    kind: "remote",
    status: "available",
  },
];

const mocks = vi.hoisted(() => ({
  planRestricted: vi.fn<() => boolean>(() => false),
  selectById: vi.fn(),
  openExternalLink: vi.fn(() => Promise.resolve()),
  requestClose: vi.fn(),
  entries: [] as ReadonlyArray<{
    readonly hostId: string;
    readonly label: string;
    readonly kind: string;
    readonly status: string;
  }>,
}));

vi.mock("@/hooks/host/use-remote-hosts-plan-gate", () => ({
  useRemoteHostsPlanRestricted: mocks.planRestricted,
}));

vi.mock("@/providers/use-runner-host", () => ({
  useRunnerHost: () => ({
    authnBaseUrl: "https://authn.traycer.ai",
    openExternalLink: mocks.openExternalLink,
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
    data: mocks.entries,
  }),
}));

import { HostPicker } from "@/components/layout/header/host-picker";

beforeEach(() => {
  mocks.planRestricted.mockReturnValue(false);
  mocks.entries = DEFAULT_ENTRIES;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HostPicker paid-plan gating", () => {
  it("free plan: remote rows are inert with a Paid plan affordance, and the upsell links to subscription management", () => {
    mocks.planRestricted.mockReturnValue(true);
    render(<HostPicker />);

    const remote = screen.getByTestId("host-picker-option-remote-1");
    expect(remote.getAttribute("data-plan-restricted")).toBe("true");
    expect((remote as HTMLButtonElement).disabled).toBe(true);
    expect(remote.textContent).toContain("Paid plan");
    fireEvent.click(remote);
    expect(mocks.selectById).not.toHaveBeenCalled();

    // Local operation stays fully available on the free plan.
    const local = screen.getByTestId("host-picker-option-local-1");
    expect((local as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(local);
    expect(mocks.selectById).toHaveBeenCalledWith("local-1");

    expect(screen.getByTestId("host-picker-remote-upsell")).toBeDefined();
    fireEvent.click(screen.getByTestId("host-picker-remote-upsell-upgrade"));
    expect(mocks.openExternalLink).toHaveBeenCalledWith(
      "https://platform.traycer.ai",
    );
  });

  it("paid plan: remote rows select normally and no upsell renders", () => {
    mocks.planRestricted.mockReturnValue(false);
    render(<HostPicker />);

    expect(screen.queryByTestId("host-picker-remote-upsell")).toBeNull();
    const remote = screen.getByTestId("host-picker-option-remote-1");
    expect(remote.getAttribute("data-plan-restricted")).toBe("false");
    expect((remote as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(remote);
    expect(mocks.selectById).toHaveBeenCalledWith("remote-1");
    expect(mocks.requestClose).toHaveBeenCalled();
  });
});

/**
 * `status` previously had a renderer nowhere: an entry marked `unavailable`
 * drew exactly like a live one, so a host that was switched off was
 * indistinguishable from one that was running. These pin the distinction.
 */
describe("HostPicker reachability", () => {
  it("marks an unreachable host and leaves a reachable one unmarked", () => {
    mocks.entries = [
      { hostId: "local-1", label: "Altra", kind: "local", status: "available" },
      {
        hostId: "local-2",
        label: "Tonberry",
        kind: "local",
        status: "unavailable",
      },
    ];
    render(<HostPicker />);

    const reachable = screen.getByTestId("host-picker-option-local-1");
    expect(reachable.getAttribute("data-unavailable")).toBe("false");
    expect(screen.queryByTestId("host-picker-unavailable-local-1")).toBeNull();

    const unreachable = screen.getByTestId("host-picker-option-local-2");
    expect(unreachable.getAttribute("data-unavailable")).toBe("true");
    expect(
      screen.getByTestId("host-picker-unavailable-local-2").textContent,
    ).toBe("Unreachable");
  });

  it("keeps an unreachable host selectable", () => {
    // Disabling it would swap an honest "Unreachable" for a dead control and
    // hide the real dial error behind a button that does nothing. The user is
    // allowed to try; the badge tells them what to expect.
    mocks.entries = [
      {
        hostId: "local-2",
        label: "Tonberry",
        kind: "local",
        status: "unavailable",
      },
    ];
    render(<HostPicker />);

    const unreachable = screen.getByTestId("host-picker-option-local-2");
    expect((unreachable as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(unreachable);
    expect(mocks.selectById).toHaveBeenCalledWith("local-2");
  });
});
