# The layout core — a deliberate verbatim copy, and how to prove it stayed one

`tile-tree.ts`, `tile-tree-constants.ts` and `resize-sizes.ts` are **byte-identical
copies** of files in `clients/gui-app`. They are the desktop client's split-tree
engine: pure, React-free, content-agnostic. Panes hold opaque `instanceId`
strings; the tree has never heard of a chat.

| Here | Origin in `clients/gui-app/src` |
| --- | --- |
| `tile-tree.ts` | `stores/epics/canvas/tile-tree.ts` |
| `tile-tree-constants.ts` | `stores/epics/canvas/tile-tree-constants.ts` |
| `resize-sizes.ts` | `components/epic-canvas/canvas/resize-handle-sizes.ts` |

## Why copied and not extracted to `clients/shared`

The project rule is *extract, don't duplicate*, and this is the exception with
its reason on the record rather than a quiet violation:

- **`tile-tree.ts` has 46 importers in `gui-app`**, and **`gui-app` does not
  depend on `@traycer-clients/shared` at all** (checked: no such entry in its
  `package.json`). Extracting means adding a dependency to that package and
  rewriting 46 import sites.
- **This work has never built `gui-app`.** Editing 46 files in a package whose
  suite I cannot run, to serve a different package's convenience, is the
  "looks correct, ships the class" move. The audit's own limits section says I
  did not run that suite; acting as though I could is worse than copying.

**Extraction stays available and gets cheaper, not dearer** — these files are
byte-identical, so a later move is a delete plus a path rewrite.

## The drift check, because "copy" without one becomes "fork" silently

```sh
node tools/check-canvas-core.mjs
```

Exits non-zero the moment either copy stops matching its origin. **The whole
value of a verbatim copy is that divergence is a command, not a code review** —
and the copies carry no added header precisely so `cmp` stays usable. Provenance
lives in this README instead of in the files.

If a change here is intentional, make it in `gui-app` first and re-copy, or
delete the entry from the checker with the reason — a fork nobody declared is
the thing this file exists to prevent.

## What was NOT copied, and why

- **`types.ts`** — the tile-ref union. Not content-agnostic: it names
  `git-diff`, `snapshot-diff`, `terminal` and `workspace-file`, all of which
  are out of scope for the Teams tab (deferred with reasons in the canvas
  audit). This package gets its own smaller union.
- **`pane-drop-geometry.ts`** — pure and liftable, but it exists only to serve
  drag-and-drop, which is sequenced last. Copying it now would add an unused
  module that reads as capability.
- **`canvas-persistence.ts` / `migrate-canvas.ts`** — the *shape*
  (sanitize-on-read, drop malformed entries, never throw) is the thing worth
  keeping; the code is bound to `EpicNodeRecord` and zustand `persist`, and
  this package uses neither.
- **the 223-line test fixture file** — only `pane` and `group` are tree-level.
  See `__tests__/tile-tree-fixtures.ts`.
