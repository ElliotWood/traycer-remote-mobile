/**
 * Sprint 1 proof surface (M1 + M2). Reachable at `?showcase=1` with NO auth
 * and NO host connection — Sprint 1 ships no host-data screen of its own, so
 * this static harness is what the Evaluator screenshots against rubric §1/§2.
 *
 * Renders every kind/status token combination and a fixed markdown sample
 * exercising every element the M2 renderer supports (contract's "showcase
 * harness" section).
 */
import type { ReactElement } from "react";
import { KindCard, KindIcon, type ArtifactStatus, type CardKind } from "./kind-tokens";
import { MobileMarkdown } from "./markdown/mobile-markdown";
import { colors, screen } from "./ui";

const CARD_KINDS: readonly CardKind[] = ["spec", "ticket", "story", "review"];
const STATUSES: readonly ArtifactStatus[] = [0, 1, 2];

const SAMPLE_MARKDOWN = `# Showcase document

## Structure

### Nested heading

A paragraph with **bold** and _italic_ text, exercising basic prose.

> A blockquote — the kind of aside a spec uses for a caveat or a decision note.

- Top-level item
- Another item
  - A nested sub-item
  - Another nested sub-item
- Third item

## Links

A safe link: [Traycer](https://traycer.ai). A neutralized link:
[click me](javascript:alert(1)) — its href must not survive as \`javascript:\`.

## Table

| Column A | Column B | Column C | Column D | Column E |
| --- | --- | --- | --- | --- |
| alpha | bravo | charlie | delta | echo |
| foxtrot | golf | hotel | india | juliet |

## Task list

- [x] Ship the token system
- [x] Ship the markdown renderer
- [ ] Ship the chat transcript (Sprint 2)

## Code

Inline \`code span\` example.

\`\`\`ts
export function hexToRgba(hex: string, alpha: number): string {
  return \`rgba(0, 0, 0, \${alpha})\`;
}
\`\`\`

## Diagram

\`\`\`mermaid
graph TD
  A[Kind tokens] --> B[Markdown renderer]
  B --> C[Chat transcript]
  B --> D[Artifact browse]
  C --> E[Comments]
  D --> E
\`\`\`

## Wireframe

\`\`\`wireframe
<!doctype html>
<html>
  <body style="margin:0;font-family:system-ui;padding:16px;background:#f5f5f5;">
    <h1 style="margin:0 0 8px;">Sandboxed preview</h1>
    <p style="color:#555;">Rendered inside an opaque-origin iframe.</p>
    <button style="padding:8px 14px;border-radius:6px;border:0;background:#4a9eff;color:#fff;">
      Tap target
    </button>
  </body>
</html>
\`\`\`
`;

export function ShowcaseView(): ReactElement {
  return (
    <main style={{ ...screen, maxWidth: 480 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Sprint 1 Showcase</h1>
      <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>
        Kind/status tokens + markdown renderer — no auth, no host.
      </p>

      <section aria-label="Kind cards" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, color: colors.muted, marginBottom: 8 }}>Kind cards</h2>
        {CARD_KINDS.map((kind) =>
          kind === "ticket" || kind === "story" ? (
            STATUSES.map((status) => (
              <KindCard
                key={`${kind}-${status}`}
                kind={kind}
                status={status}
                title={`${kind} — status ${status}`}
              />
            ))
          ) : (
            <KindCard key={kind} kind={kind} title={kind} />
          ),
        )}
        <KindIcon kind="chat" label="chat (icon only — no card chrome)" />
      </section>

      <section aria-label="Markdown sample">
        <h2 style={{ fontSize: 15, color: colors.muted, marginBottom: 8 }}>Markdown renderer</h2>
        <MobileMarkdown>{SAMPLE_MARKDOWN}</MobileMarkdown>
      </section>
    </main>
  );
}
