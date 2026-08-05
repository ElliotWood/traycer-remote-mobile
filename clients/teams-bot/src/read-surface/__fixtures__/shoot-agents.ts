/**
 * The screenshot harness's agent fixtures — IN TYPESCRIPT, deliberately.
 *
 * They used to live as plain object literals inside `tools/shoot.mjs`, and
 * they omitted `capabilities` and `isLocal` — fields
 * `agentStatusPresentation` reads directly. The card parses through a zod
 * schema that `.catch`es both to defaults at RUNTIME, so production was
 * unaffected and only the harness, which passes raw objects, could see it.
 *
 * The result: `01-fleet` failed to build for a long time, and every fleet
 * screenshot anyone reviewed showed "Activity not visible from here" on every
 * row — a state almost no real agent is in. "Active" and "Idle" had never
 * been rendered at all.
 *
 * `readonly AgentSummary[]` is the fix, and it is a TOOLCHAIN fix rather than
 * a vigilance one: a fixture missing a field the renderer reads is now a
 * COMPILE ERROR, not 99 successful images of the wrong thing. Same move as
 * requiring every field of `ChatSnapshotView` — a partial fixture should not
 * be constructible.
 *
 * Keep the SHAPE realistic and the CONTENT invented: mixed harnesses and
 * surfaces, one untitled row, one unreachable, one reachable-but-unobservable,
 * titles long enough to truncate. Real internal work titles were published
 * from this file once already.
 */
import type { AgentSummary } from "../bridge-types";

export const SHOOT_AGENTS: readonly AgentSummary[] =
[
  {
    agentId: "a1000000-0000-4000-8000-000000000001",
    title: "Investigate flaky integration suite",
    harnessId: "claude",
    surface: "gui",
    active: true,
    // Explicit, because the CARD now offers a Reply button and must not
    // offer it for an agent this host cannot message. Agent 3 says no, so
    // the disabled path is in every screenshot rather than in a comment.
    capabilities: { readTranscript: true, sendMessage: true },
    isLocal: true,
    hostId: "f1000000-0000-4000-8000-00000000aaaa",
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000002",
    title: "Review: streaming reconnect logic",
    harnessId: "claude",
    surface: "gui",
    active: false,
    // Explicit, because the CARD now offers a Reply button and must not
    // offer it for an agent this host cannot message. Agent 3 says no, so
    // the disabled path is in every screenshot rather than in a comment.
    capabilities: { readTranscript: true, sendMessage: true },
    isLocal: true,
    hostId: "f1000000-0000-4000-8000-00000000aaaa",
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000003",
    title: "Research: cache invalidation strategy",
    harnessId: "claude",
    surface: "gui",
    active: false,
    // Explicit, because the CARD now offers a Reply button and must not
    // offer it for an agent this host cannot message. Agent 3 says no, so
    // the disabled path is in every screenshot rather than in a comment.
    capabilities: { readTranscript: true, sendMessage: false },
    isLocal: false,
    hostId: "f1000000-0000-4000-8000-00000000bbbb",
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000004",
    title: "Migrate config loader to zod",
    harnessId: "claude",
    surface: "gui",
    active: true,
    // Explicit, because the CARD now offers a Reply button and must not
    // offer it for an agent this host cannot message. Agent 3 says no, so
    // the disabled path is in every screenshot rather than in a comment.
    capabilities: { readTranscript: true, sendMessage: true },
    isLocal: true,
    hostId: "f1000000-0000-4000-8000-00000000aaaa",
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000005",
    title: "Audit: dependency licence report",
    harnessId: "codex",
    surface: "tui",
    active: false,
    // Explicit, because the CARD now offers a Reply button and must not
    // offer it for an agent this host cannot message. Agent 3 says no, so
    // the disabled path is in every screenshot rather than in a comment.
    capabilities: { readTranscript: true, sendMessage: true },
    isLocal: true,
    hostId: "f1000000-0000-4000-8000-00000000aaaa",
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000006",
    title: null,
    harnessId: null,
    surface: "tui",
    active: false,
    // Explicit, because the CARD now offers a Reply button and must not
    // offer it for an agent this host cannot message. Agent 3 says no, so
    // the disabled path is in every screenshot rather than in a comment.
    capabilities: { readTranscript: true, sendMessage: true },
    isLocal: false,
    hostId: "f1000000-0000-4000-8000-00000000bbbb",
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000007",
    title: "Prototype: offline draft sync",
    harnessId: "claude",
    surface: "gui",
    active: true,
    // Explicit, because the CARD now offers a Reply button and must not
    // offer it for an agent this host cannot message. Agent 3 says no, so
    // the disabled path is in every screenshot rather than in a comment.
    capabilities: { readTranscript: true, sendMessage: true },
    isLocal: true,
    hostId: "f1000000-0000-4000-8000-00000000aaaa",
  },
  {
    agentId: "a1000000-0000-4000-8000-000000000008",
    title: "Refactor the notification queue",
    harnessId: "claude",
    surface: "gui",
    active: false,
    // Explicit, because the CARD now offers a Reply button and must not
    // offer it for an agent this host cannot message. Agent 3 says no, so
    // the disabled path is in every screenshot rather than in a comment.
    capabilities: { readTranscript: true, sendMessage: true },
    isLocal: true,
    hostId: "f1000000-0000-4000-8000-00000000aaaa",
  },
];