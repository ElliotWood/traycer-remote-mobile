---
title: "Sample technical note"
kind: spec
---

A representative technical note used only as a rendering fixture — not project
documentation. Shaped like the real artifact markdown this renderer has to
survive: a multi-node `mermaid` diagram with subgraphs and punctuation-heavy
labels, and a GFM table with hex color values, inline code, and mixed
formatting in the same cell.

## Data flow

```mermaid
graph TD
  subgraph client [client — runs in the browser]
    UI[UI: chats + artifacts list] --> Meta[artifact metadata: kind/title/status/parentId]
    Stream[stream.subscribe bytes] --> Body[per-room doc → getXmlFragment 'artifact-body:id']
  end
  subgraph host [host — WebSocket RPC]
    Snap[snapshot.messages + blockDelta/eventAppended] --> TX[full transcript: N block types]
  end
```

- **Transport:** `stream.subscribe` (snapshot + live `onBlockDelta`/`onEventAppended`).
- **Metadata:** a `{id, kind, title, parentId, status}` map, body in a per-item room.

## Visual system

| Kind | Icon | Icon hex | Card accent |
| --- | --- | --- | --- |
| spec | `FileText` | `#fbbf24` amber-400 | amber left-border + amber tint |
| ticket | `Ticket` | `#a78bfa` violet-400 | violet |
| story | `BookOpen` | `#34d399` emerald-400 | emerald |
| review | `ClipboardCheck` | `#fb7185` rose-400 | rose |

| Status | Dot |
| --- | --- |
| 0 Todo | slate `#94a3b8` |
| 1 In Progress | amber `#f59e0b` |
| 2 Done | emerald `#10b981` |

## Risks

1. **Diagram fidelity** — the mermaid fence must survive nested brackets and
   punctuation inside node labels (`[epic Y.Doc: chats + artifacts map]`).
2. **Table fidelity** — a cell can mix inline code, a hex value, *and* plain
   text on one line, which is exactly what the icon table above does.
