/**
 * A HOSTILE artifact body. Every element is here because it is a claim that
 * can fail, not because a real document would contain all of it.
 *
 *   table            the card surface could not render one AT ALL — this is
 *                    the pivot's headline capability
 *   mermaid          renders as a diagram, not a code block
 *   BROKEN mermaid   must show the SOURCE plus a named failure, never a blank
 *   wireframe WITH   no background of its own — the case that proves the
 *                    iframe element's token fixes the white-rectangle defect,
 *                    and which is INVISIBLE on the default theme
 *   nested lists     indentation survives the renderer
 *   code fence       scrolls rather than reflowing
 *   blockquote       another kind the cards flattened
 *   inline HTML      must be sanitised, not executed
 *
 * A document of headings and paragraphs would render beautifully and prove
 * none of it.
 */
export const ARTIFACT_FIXTURE_TITLE = "Streaming transport reconnect";

export const ARTIFACT_FIXTURE_BODY = `# Streaming transport reconnect

The reconnect path currently drops the queue. This spec covers what survives a
drop and what does not.

## Decision

| Case | Behaviour | Why |
| --- | --- | --- |
| Socket closes mid-turn | Re-dial, replay queue | The turn is recoverable |
| Host restarts | Re-dial, discard queue | Sequence numbers reset |
| Auth expires | Revalidate, then re-dial | A retry without it loops |

## Flow

\`\`\`mermaid
flowchart TD
    A[socket closed] --> B{auth still valid?}
    B -->|yes| C[re-dial]
    B -->|no| D[revalidate]
    D --> C
    C --> E{queue replayable?}
    E -->|yes| F[replay]
    E -->|no| G[discard and report]
\`\`\`

## A diagram the agent got wrong

\`\`\`mermaid
flowchart TD
    A[ --> this is not valid mermaid
\`\`\`

## Proposed layout

\`\`\`wireframe
<!doctype html>
<html>
  <body style="margin:0;font-family:system-ui">
    <div style="padding:12px;border-bottom:1px solid #8884">
      <strong>Reconnecting…</strong>
    </div>
    <div style="padding:12px">Queue held: 3 messages</div>
  </body>
</html>
\`\`\`

> The wireframe above paints **no background of its own** — deliberately. On a
> dark theme it must take the surrounding surface, not render white.

## Open questions

1. Replay ordering
   - Does the host dedupe on \`clientActionId\`?
     - Verified for \`send\`
     - Assumed for \`approvalDecision\`
2. Backoff ceiling
   - 30s today

\`\`\`ts
const messenger = createRetryingMessenger(
  createAuthAwareMessenger(raw, auth),
  DEFAULT_TRANSPORT_RETRY_POLICY,
);
\`\`\`

<img src=x onerror="alert('xss')">

Inline \`code\` and a [link](https://example.invalid).
`;
