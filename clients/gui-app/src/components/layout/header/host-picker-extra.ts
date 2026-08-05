import type { ReactNode } from "react";

/**
 * Shell-supplied content rendered under the host list in `<HostPicker />`,
 * for shells that own their own host list and therefore need somewhere to
 * manage it. A desktop shell, whose hosts come from the registry, registers
 * nothing and the picker renders exactly as before.
 *
 * Module-level rather than a prop because `<HostPicker />` is mounted deep
 * inside `<TraycerApp />` with no prop route from the shell - the same
 * reason `registerHostPickerDirectory` is module-level.
 *
 * Registration is expected BEFORE the first render (shells call it during
 * bootstrap, ahead of `createRoot().render()`). This deliberately does not
 * notify subscribers: a later call would not re-render, and a registration
 * API that silently no-ops after mount is worse than one that documents
 * when it must be called.
 */
let hostPickerExtra: ReactNode = null;

export function registerHostPickerExtra(node: ReactNode): void {
  hostPickerExtra = node;
}

export function getHostPickerExtra(): ReactNode {
  return hostPickerExtra;
}
