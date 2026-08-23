import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBlobToDisk } from "@/lib/files/save-blob-to-disk";

const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    return;
  }
  Object.defineProperty(URL, name, descriptor);
}

afterEach(() => {
  (globalThis as { runnerHost?: unknown }).runnerHost = undefined;
  window.showSaveFilePicker = undefined;
  restoreUrlMethod("createObjectURL", createObjectUrlDescriptor);
  restoreUrlMethod("revokeObjectURL", revokeObjectUrlDescriptor);
  vi.restoreAllMocks();
});

describe("saveBlobToDisk", () => {
  it("treats save picker cancellation as a no-op", async () => {
    const createObjectURL = vi.fn(() => "blob:mermaid");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    window.showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));

    await expect(
      saveBlobToDisk(new Blob(["png"], { type: "image/png" }), "diagram.png"),
    ).resolves.toEqual({ status: "cancelled" });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to the anchor download after a save picker write failure", async () => {
    const writable = {
      write: vi.fn().mockRejectedValue(new Error("write failed")),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const createWritable = vi.fn().mockResolvedValue(writable);
    const createObjectURL = vi.fn(() => "blob:mermaid");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });
    window.showSaveFilePicker = vi.fn().mockResolvedValue({
      name: "diagram.png",
      createWritable,
    });

    // A recoverable (non-cancel) write failure must not lose the file: the
    // browser falls through to the <a download> anchor. That path is
    // `started`, not `saved` — nothing observed the browser take it.
    await expect(
      saveBlobToDisk(new Blob(["png"], { type: "image/png" }), "diagram.png"),
    ).resolves.toEqual({ status: "started", name: "diagram.png" });
    expect(createWritable).toHaveBeenCalledTimes(1);
    expect(writable.write).toHaveBeenCalledTimes(1);
    expect(writable.close).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("uses the desktop save bridge before browser save APIs", async () => {
    const saveFile = vi.fn().mockResolvedValue("diagram.png");
    const createObjectURL = vi.fn(() => "blob:mermaid");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    (globalThis as { runnerHost?: unknown }).runnerHost = {
      fileDrops: { saveFile },
    };
    window.showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException("not allowed", "NotAllowedError"));

    const blob = new Blob(["png"], { type: "image/png" });
    await expect(saveBlobToDisk(blob, "diagram.png")).resolves.toEqual({
      status: "saved",
      name: "diagram.png",
    });
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile).toHaveBeenCalledWith({
      name: "diagram.png",
      type: "image/png",
      bytes: await blob.arrayBuffer(),
    });
    expect(window.showSaveFilePicker).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  // The three below are the point of the outcome type. The anchor path is the
  // ONLY mechanism a Teams tab can reach — no `runnerHost`, and
  // `showSaveFilePicker` throws `SecurityError` in a cross-origin frame — and
  // it is also the only one that cannot tell whether a file was written. So
  // the anchor row must not read the same as the two verified ones.
  it("reports the anchor download as started, not saved — nothing observed it", async () => {
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });
    // No desktop bridge and no File System Access API: exactly the Teams-tab
    // runtime. `afterEach` already clears both; asserted here so the arm is
    // not silently the picker arm if a default ever appears.
    expect((globalThis as { runnerHost?: unknown }).runnerHost).toBeUndefined();
    expect(window.showSaveFilePicker).toBeUndefined();

    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");

    await expect(
      saveBlobToDisk(new Blob(["zip"], { type: "application/zip" }), "e.zip"),
    ).resolves.toEqual({ status: "started", name: "e.zip" });

    // The click fired and returned nothing — which is the whole defect. A
    // browser that dropped the download is indistinguishable from here, so
    // the outcome above is the strongest true statement available.
    expect(click).toHaveBeenCalledTimes(1);
    expect(click).toHaveReturnedWith(undefined);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("reports a completed picker write as saved", async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const createObjectURL = vi.fn(() => "blob:export");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    window.showSaveFilePicker = vi.fn().mockResolvedValue({
      // The picker's own name, which can differ from the suggestion — the
      // user may rename in the dialog.
      name: "renamed.zip",
      createWritable: vi.fn().mockResolvedValue(writable),
    });

    await expect(
      saveBlobToDisk(new Blob(["zip"], { type: "application/zip" }), "e.zip"),
    ).resolves.toEqual({ status: "saved", name: "renamed.zip" });
    expect(writable.close).toHaveBeenCalledTimes(1);
    // Verified means verified: no anchor fallback ran behind it.
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("treats a null from the desktop bridge as cancelled, not a save", async () => {
    const createObjectURL = vi.fn(() => "blob:export");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    // The native dialog's cancel. Before the outcome type this returned
    // `null` and the caller read it as cancel by convention; now it is stated.
    (globalThis as { runnerHost?: unknown }).runnerHost = {
      fileDrops: { saveFile: vi.fn().mockResolvedValue(null) },
    };

    await expect(
      saveBlobToDisk(new Blob(["zip"], { type: "application/zip" }), "e.zip"),
    ).resolves.toEqual({ status: "cancelled" });
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
