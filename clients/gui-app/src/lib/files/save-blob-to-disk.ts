interface FsaFileHandle {
  readonly name: string;
  createWritable: () => Promise<FsaWritable>;
}
interface FsaWritable {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}
interface SaveFilePickerType {
  readonly description: string;
  readonly accept: Record<string, ReadonlyArray<string>>;
}
interface SaveFilePickerOptions {
  readonly suggestedName: string;
  readonly types: ReadonlyArray<SaveFilePickerType>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (
      options: SaveFilePickerOptions,
    ) => Promise<FsaFileHandle>;
  }
}

interface DesktopSaveFileInput {
  readonly name: string;
  readonly type: string;
  readonly bytes: ArrayBuffer;
}

type DesktopSaveFile = (input: DesktopSaveFileInput) => Promise<string | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDesktopSaveFile(value: unknown): value is DesktopSaveFile {
  return typeof value === "function";
}

/**
 * Traycer Desktop exposes a native save bridge under
 * `runnerHost.fileDrops.saveFile`. The sandboxed Electron renderer cannot use
 * the File System Access API's `createWritable()` (it throws `NotAllowedError`),
 * so the bytes are handed to the main process, which writes them after a native
 * save dialog. Returns `null` in any non-desktop runtime (browser, dev shell).
 */
function getDesktopSaveFile(): DesktopSaveFile | null {
  const runnerHost = (globalThis as { runnerHost?: unknown }).runnerHost;
  if (!isRecord(runnerHost)) return null;
  const fileDrops = runnerHost.fileDrops;
  if (!isRecord(fileDrops)) return null;
  const saveFile = fileDrops.saveFile;
  return isDesktopSaveFile(saveFile) ? saveFile : null;
}

/**
 * Derive the picker's accept-type hint from the blob's MIME type and the
 * suggested name's extension. Empty when either is unknown — the helper is
 * generic, so it must not hardcode any one format.
 */
function buildSaveFilePickerTypes(
  blob: Blob,
  suggestedName: string,
): ReadonlyArray<SaveFilePickerType> {
  const dot = suggestedName.lastIndexOf(".");
  const extension = dot >= 0 ? suggestedName.slice(dot) : "";
  if (blob.type.length === 0 || extension.length === 0) return [];
  return [{ description: blob.type, accept: { [blob.type]: [extension] } }];
}

/**
 * What the app is entitled to say about a save, which is not the same for
 * every mechanism:
 *
 * - `saved` — the bytes are on disk and something confirmed it. The desktop
 *   bridge returns the path its main process wrote; `createWritable()` +
 *   `close()` resolve only after the write completes.
 * - `started` — the blob was handed to the browser through `<a download>` and
 *   **nothing observed the outcome.** An anchor click returns `undefined`
 *   whether the browser accepted the download or dropped it on the floor, and
 *   there is no in-frame read that tells those apart: measured 2026-08-13 over
 *   13 readings in two frames differing by exactly one sandbox token, `0`
 *   differ, with `allow-modals` as the control that proves the battery was not
 *   simply blind. `featurePolicy.allowsFeature("downloads")` reads `false`
 *   even where downloads demonstrably work — downloads are a sandbox flag, not
 *   a policy feature, so the API that looks like the right question does not
 *   answer it.
 * - `cancelled` — the user dismissed a picker, or the desktop dialog returned
 *   no path. Nothing was saved and nothing should be announced.
 *
 * The distinction exists because a Teams tab is a cross-origin sandboxed
 * iframe, and Chrome blocks downloads from one unless `allow-downloads` is in
 * the sandbox attribute. Whether Teams sets it is unresolved — Microsoft's own
 * forum answer on the question (2020-06-08) says "we have an active work item,
 * no ETA" and the thread closes with no confirmation it shipped. So `started`
 * is a genuinely open outcome on this surface rather than a pedantic one, and
 * a caller that renders it as "Saved" is telling the user a file exists that
 * may not.
 */
export type SaveBlobOutcome =
  | { readonly status: "saved"; readonly name: string }
  | { readonly status: "started"; readonly name: string }
  | { readonly status: "cancelled" };

/**
 * Persist a Blob to disk, picking the best mechanism for the current runtime:
 *   1. Traycer Desktop → native save dialog via the `runnerHost` IPC bridge.
 *   2. Browsers with the File System Access API → `showSaveFilePicker`.
 *   3. Everything else (and recoverable FSA write failures) → `<a download>`.
 *
 * Returns which of those ran and what it is worth — see `SaveBlobOutcome`.
 * Callers must not collapse `started` into `saved`; that is the whole point of
 * the type.
 *
 * Shared across the app — not Mermaid-specific — so any feature that needs a
 * "save this blob" affordance gets the desktop-sandbox-safe path for free.
 */
export async function saveBlobToDisk(
  blob: Blob,
  suggestedName: string,
): Promise<SaveBlobOutcome> {
  const desktopSaveFile = getDesktopSaveFile();
  if (desktopSaveFile !== null) {
    const savedPath = await desktopSaveFile({
      name: suggestedName,
      type: blob.type,
      bytes: await blob.arrayBuffer(),
    });
    // The main process writes before it answers, so a path here is a file on
    // disk. `null` is the native dialog's cancel.
    return savedPath === null
      ? { status: "cancelled" }
      : { status: "saved", name: savedPath };
  }

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: buildSaveFilePickerTypes(blob, suggestedName),
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { status: "saved", name: handle.name };
    } catch (err) {
      // User dismissed the picker — a no-op; never fall through to a download.
      if (err instanceof DOMException && err.name === "AbortError") {
        return { status: "cancelled" };
      }
      // A non-cancel failure (locked file, transient I/O) must not lose the
      // file: fall through to the <a download> path so the browser still saves
      // it. Desktop never reaches here — getDesktopSaveFile() handled it above.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
  // Deliberately NOT `saved`. Nothing above observed a file being written, and
  // nothing on this surface can.
  return { status: "started", name: suggestedName };
}
