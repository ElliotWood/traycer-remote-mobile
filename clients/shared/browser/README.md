# `clients/shared/browser` — modules that need a DOM

Everything in this directory touches `document`, `window`, or another browser
global. **Node packages must not compile it.**

## Why it exists

`clients/shared` is one flat library, and several consumers are Node
programs (`remote-bridge`, `teams-bot`, `mobile-push-service`) whose tsconfig
includes `../shared` wholesale. When `css-color.ts` and `mermaid-runtime.ts`
were extracted into `shared/markdown`, they were correctly identified as
framework-agnostic — and it was **browser**-agnostic that mattered. Every Node
package that compiled `../shared` started failing with `Cannot find name
'document'`, and stayed failing, because the standing status report counted
tests and never compiles. A true number about a neighbouring subject.

## The rule

- A module needing a browser global goes **here**.
- Node packages **exclude `../shared/browser`** in tsconfig.
- Do **not** fix a DOM error by adding `"dom"` to a Node package's `lib`. That
  makes the type error disappear and lets a Node program reference `document`,
  which then fails at runtime instead of at build — strictly worse.

The directory name is the boundary. It is checkable at a glance, and one
exclude line covers every module added later.
