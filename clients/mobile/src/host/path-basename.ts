/**
 * Last path segment, tolerant of both separators.
 *
 * The host is whatever machine the user runs Traycer on, so these paths may be
 * POSIX or Windows and the phone cannot know which. Splitting on both is the
 * only correct answer from here; `path.basename` is Node-only and would be
 * wrong for the other platform anyway. Trailing separators are stripped first
 * so `/a/b/` yields `b` rather than `""`.
 *
 * Lives in `host/` rather than beside either consumer: the binding chip
 * (`views/chat`) and the workspace picker (`host/workspace-selection`) both
 * need it, and a view module is the wrong direction for a host module to
 * import from.
 */
export function pathBasename(value: string): string {
  const trimmed = value.replace(/[/\\]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}
