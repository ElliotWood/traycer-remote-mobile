/**
 * M6 item 2 — "Review all": the whole cumulative changeset on one scrollable
 * surface, with a jump-list.
 *
 * The panel's existing affordance is one-at-a-time disclosure: reviewing a
 * 12-file change means tapping twelve rows and losing your place between each.
 * This is the phone-shaped alternative — every diff already inline (the
 * before/after content is on the wire, so no extra RPC, per the ticket's
 * scope-out), stacked in order, with a jump-list above it.
 *
 * ## Identity is `filePath`, never the displayed label
 *
 * An artifact row displays `artifact.title`, and two artifacts can share a
 * title — so a jump-list keyed by what it SHOWS would scroll to the wrong
 * section and look right doing it. Both the jump entries and the sections key
 * off `filePath`, which is the panel's own row key and unique by construction.
 *
 * ## Back closes this, not the chat
 *
 * `useDismissLayer` is the whole contract: the OS back gesture, the ✕ and a
 * jump-list tap all route through the same navigation model, so back cannot
 * pop the chat route out from underneath an open review.
 */
import { useMemo, useRef, type ReactElement } from "react";
import { X } from "lucide-react";
import type { ChatAccumulatedFileChange } from "@traycer/protocol/host/agent/gui/subscribe";
import { useDismissLayer } from "@/router/nav-host";
import { radius, theme, type } from "@/views/design-tokens";
import { computeLineDelta } from "./line-delta";
import { DiffView } from "./diff-view";

export interface ReviewAllSheetProps {
  readonly changes: readonly ChatAccumulatedFileChange[];
  readonly onClose: () => void;
}

/** What a row is called on screen — an artifact by its title, a file by its path. */
function displayPath(change: ChatAccumulatedFileChange): string {
  return change.artifact?.title ?? change.filePath;
}

export function ReviewAllSheet({ changes, onClose }: ReviewAllSheetProps): ReactElement {
  const dismiss = useDismissLayer(true, onClose);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const deltas = useMemo(
    () =>
      changes.map((change) => computeLineDelta(change.beforeContent, change.afterContent, change.reason)),
    [changes],
  );
  const totals = useMemo(() => {
    let added = 0;
    let deleted = 0;
    for (const delta of deltas) {
      added += delta.added;
      deleted += delta.deleted;
    }
    return { added, deleted };
  }, [deltas]);

  const jumpTo = (filePath: string): void => {
    const section = sectionRefs.current[filePath];
    if (section === null || section === undefined) return;
    // jsdom has no `scrollIntoView`, and neither did every browser this app
    // has to run in — the same guard `chat-view.tsx`'s scroll uses. Landing
    // on the section without animating is a degraded jump, not a crash.
    if (typeof section.scrollIntoView === "function") {
      section.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Review all changes"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        background: theme.background,
      }}
    >
      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "12px 14px",
          borderBottom: `1px solid ${theme.borderHairline}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 style={{ ...type.titleSm, margin: 0, color: theme.text }}>Review all changes</h2>
          <span style={{ ...type.bodyXs, color: theme.mutedText }}>
            {changes.length} file{changes.length === 1 ? "" : "s"}
            {" · "}
            <span style={{ color: theme.success }}>+{totals.added}</span>{" "}
            <span style={{ color: theme.danger }}>-{totals.deleted}</span>
          </span>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={dismiss}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: 44,
            height: 44,
            border: "none",
            background: "transparent",
            color: theme.mutedText,
            cursor: "pointer",
          }}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {/*
        The jump-list scrolls horizontally rather than eating the screen
        vertically: on a 12-file change a vertical index would push the first
        diff below the fold, which is the problem this surface exists to fix.
      */}
      <nav
        aria-label="Jump to file"
        style={{
          flexShrink: 0,
          display: "flex",
          gap: 6,
          overflowX: "auto",
          padding: "8px 14px",
          borderBottom: `1px solid ${theme.borderHairline}`,
        }}
      >
        {changes.map((change, index) => (
          <button
            key={change.filePath}
            type="button"
            data-jump-path={change.filePath}
            onClick={() => jumpTo(change.filePath)}
            style={{
              flexShrink: 0,
              maxWidth: 180,
              minHeight: 32,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              padding: "0 10px",
              borderRadius: radius.row,
              border: `1px solid ${theme.borderHairline}`,
              background: theme.surface,
              color: theme.textRow,
              ...type.bodyXs,
              cursor: "pointer",
            }}
          >
            {/*
              Truncate from the LEFT, the same way the `@` sheet's rows do and
              for a stronger reason: a jump-list is for TELLING ROWS APART, and
              a chip that ellipsizes at the end renders twelve deep paths as
              twelve copies of the repo root. Found in a photograph of a real
              changeset — `C:\…\.traycer\scr…` — because jsdom cannot see it.

              Both properties are load-bearing and are asserted together:
              `direction: rtl` on the box picks the truncation side, the inner
              `bdi` isolate keeps the path's own characters in order. RTL
              reorders BIDI-NEUTRALS, and a path is almost entirely neutrals —
              that is the defect that shipped in the `@` sheet.
            */}
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                direction: "rtl",
                textAlign: "left",
              }}
            >
              <bdi data-testid="jump-label" style={{ direction: "ltr", unicodeBidi: "isolate" }}>
                {displayPath(change)}
              </bdi>
              {" "}
              <span style={{ color: theme.success }}>+{deltas[index]?.added ?? 0}</span>{" "}
              <span style={{ color: theme.danger }}>-{deltas[index]?.deleted ?? 0}</span>
            </span>
          </button>
        ))}
      </nav>

      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 14px 24px" }}>
        {changes.map((change, index) => (
          <section
            key={change.filePath}
            data-review-path={change.filePath}
            ref={(el) => {
              sectionRefs.current[change.filePath] = el;
            }}
            style={{ paddingTop: 14 }}
          >
            <h3
              style={{
                ...type.bodySm,
                margin: "0 0 6px",
                color: theme.textRow,
                overflowWrap: "anywhere",
              }}
            >
              {displayPath(change)}
              {" "}
              <span style={{ color: theme.success }}>+{deltas[index]?.added ?? 0}</span>{" "}
              <span style={{ color: theme.danger }}>-{deltas[index]?.deleted ?? 0}</span>
            </h3>
            <DiffView
              beforeContent={change.beforeContent}
              afterContent={change.afterContent}
              reason={change.reason}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
