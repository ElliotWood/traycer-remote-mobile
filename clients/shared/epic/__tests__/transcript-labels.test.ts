import { describe, expect, it } from "vitest";
import {
  humaniseToolName,
  shortenWorkspacePath,
  toTranscriptBlock,
} from "../transcript";

/**
 * These rules were written in `teams-bot` first. The tab has its own renderer
 * and kept showing bare `[Tool call]` chips and full tenant paths after the
 * bot was fixed — a one-client fix for a protocol question, twice.
 *
 * They live here now, so the test covers both clients rather than whichever
 * one someone happened to be looking at.
 */
describe("block labels — grammar, shared by both clients", () => {
  it("CONTRACT: names the tool, not just the category", () => {
    // `[Tool call] [Tool call] [File change]` told a reader only that
    // something happened. The tool is the information.
    const block = toTranscriptBlock({
      type: "tool_call",
      toolName: "mcp__traycer_a2a__traycer_send_message",
    });
    expect(block.kind).toBe("other");
    if (block.kind !== "other") return;
    expect(block.label).toBe("Tool call: traycer send message");
  });

  it("CONTRACT: never renders the raw MCP identifier", () => {
    const block = toTranscriptBlock({
      type: "tool_call",
      toolName: "mcp__traycer_a2a__traycer_send_message",
    });
    if (block.kind !== "other") return;
    expect(block.label).not.toContain("mcp__");
  });

  it("names the file, with the tenant prefix removed", () => {
    // `/srv/traycer/tenants/<name>` embeds a tenant name, and this product is
    // heading for people looking at hosts they do not own.
    const block = toTranscriptBlock({
      type: "file_change",
      path: "/srv/traycer/tenants/someone/work/proj/PROOF.md",
    });
    if (block.kind !== "other") return;
    expect(block.label).toBe("File change: work/proj/PROOF.md");
    expect(block.label).not.toContain("tenants");
  });

  it("falls back to the category when the block carries no detail", () => {
    // Degrading to what we had is right; inventing a name is not.
    const block = toTranscriptBlock({ type: "tool_call" });
    if (block.kind !== "other") return;
    expect(block.label).toBe("Tool call");
  });

  it("leaves a non-MCP tool name alone", () => {
    expect(humaniseToolName("Bash")).toBe("Bash");
  });

  it("leaves a path it cannot confidently shorten intact", () => {
    expect(shortenWorkspacePath("src/index.ts")).toBe("src/index.ts");
    expect(shortenWorkspacePath("/opt/thing/x")).toBe("/opt/thing/x");
  });
});
