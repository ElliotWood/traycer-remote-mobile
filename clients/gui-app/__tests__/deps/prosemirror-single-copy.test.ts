/**
 * ProseMirror's view layer keys behaviour on class identity: `viewDecorations`
 * decides what a plugin's `decorations` prop returned by testing it against
 * `DecorationSet`, and a `DecorationGroup` built from a set of the *other*
 * copy ends up with `undefined` members. The symptom is not a resolution
 * error - it is `TypeError: Cannot read properties of undefined (reading
 * 'localsInner')` thrown from inside prosemirror-view during
 * `EditorView.updateState`, i.e. from a file nobody in this repo imports.
 *
 * That is how it happened: `@tiptap/y-tiptap` declares `prosemirror-view` as a
 * PEER dependency, bun satisfied it two different ways, and the collaboration
 * extensions bound to a 1.42.1 copy while the EditorView came from
 * `@tiptap/pm`'s 1.42.2. Every editor built with collaboration died on
 * construction. A source census cannot see this - `clients/gui-app` does not
 * depend on `prosemirror-view` directly, and both copies arrive transitively.
 *
 * The `prosemirror-view` override in the root package.json collapses that. This
 * test is the check the `@radix-ui/react-dialog` override commit (4af125f3)
 * asked a future reader to add, so an in-range bump cannot split the graph
 * silently again.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireHere = createRequire(import.meta.url);

/** Resolve `specifier` the way `from`'s own code would resolve it. */
function resolveFrom(fromEntry: string, specifier: string): string {
  return createRequire(fromEntry).resolve(specifier);
}

describe("ProseMirror singletons resolve to exactly one copy", () => {
  // The two consumers that must agree: the collaboration stack (which builds
  // decorations) and the view layer that consumes them.
  const consumers = [
    ["@tiptap/y-tiptap", requireHere.resolve("@tiptap/y-tiptap")],
    ["@tiptap/pm/view", requireHere.resolve("@tiptap/pm/view")],
  ] as const;

  // `prosemirror-view` is the one that was split. `-state` and `-model` hold
  // the same kind of identity-sensitive internals, so they are asserted too -
  // `prosemirror-model` already carries an override for this reason.
  for (const pkg of [
    "prosemirror-view",
    "prosemirror-state",
    "prosemirror-model",
  ]) {
    it(`${pkg} resolves to a single copy across consumers`, () => {
      const resolved = consumers.map(
        ([name, entry]) => [name, resolveFrom(entry, pkg)] as const,
      );
      const distinct = new Set(resolved.map(([, path]) => path));

      // Report which consumer landed where, so a failure names the split
      // rather than only its count.
      expect({
        distinctCopies: distinct.size,
        byConsumer: Object.fromEntries(resolved),
      }).toEqual({
        distinctCopies: 1,
        byConsumer: Object.fromEntries(
          resolved.map(([name]) => [name, resolved[0][1]]),
        ),
      });
    });
  }
});
