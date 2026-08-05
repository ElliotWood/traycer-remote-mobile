import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { FileIntakeStore, sanitiseFileName } from "../intake-store";
import type { FetchedFile } from "../attachment-fetch";

function store(): FileIntakeStore {
  return new FileIntakeStore(mkdtempSync(join(tmpdir(), "intake-")));
}

function file(name: string, bytes: readonly number[]): FetchedFile {
  return {
    name,
    bytes: new Uint8Array(bytes),
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
}

describe("sanitiseFileName", () => {
  it("keeps an ordinary name, extension and all", () => {
    // The extension is load-bearing: the tool that opens the document
    // dispatches on it, so a "safe" name that strips it breaks the feature.
    expect(sanitiseFileName("Retail Presentation.pptx")).toBe(
      "Retail Presentation.pptx",
    );
  });

  it("CONTRACT: a traversal name cannot stay a traversal", () => {
    expect(sanitiseFileName("../../etc/passwd")).not.toContain("/");
    expect(sanitiseFileName("..\\..\\windows\\system32")).not.toContain("\\");
    expect(sanitiseFileName("../../etc/passwd").startsWith(".")).toBe(false);
  });

  it("strips control characters", () => {
    expect(sanitiseFileName("a\u0000b\u001fc.pdf")).toBe("abc.pdf");
  });

  it("never returns an empty name", () => {
    expect(sanitiseFileName("...")).toBe("document");
    expect(sanitiseFileName("   ")).toBe("document");
    expect(sanitiseFileName("")).toBe("document");
  });

  it("caps a very long name", () => {
    expect(sanitiseFileName("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe("FileIntakeStore", () => {
  it("writes the bytes and returns a path that reads back", () => {
    const s = store();
    const record = s.put({
      fetched: [file("Retail Presentation.pptx", [7, 7, 7])],
      unavailable: [],
      now: 1000,
    });
    expect(record.files).toHaveLength(1);
    const stored = record.files[0];
    if (stored === undefined) throw new Error("no file");
    expect(Array.from(readFileSync(stored.path))).toEqual([7, 7, 7]);
    expect(stored.bytes).toBe(3);
    expect(stored.name).toBe("Retail Presentation.pptx");
  });

  it("round-trips the record through get()", () => {
    const s = store();
    const record = s.put({
      fetched: [file("a.pptx", [1, 2, 3])],
      unavailable: [{ name: "b.pptx", reason: "needs Graph" }],
      now: 1000,
    });
    // Whole-object: a field-by-field check only covers the fields someone
    // thought of, and this record is what decides what the skill is told.
    expect(s.get(record.intakeId)).toEqual(record);
  });

  it("CONTRACT: refuses a non-UUID intake id before it reaches a path", () => {
    // `intakeId` rides in a card payload and comes back through Bot Service,
    // so it is request data joined into a filesystem path.
    const s = store();
    for (const bad of [
      "../../../etc",
      "..",
      "",
      "not-a-uuid",
      "../".repeat(10),
      "00000000-0000-0000-0000-00000000000",
    ]) {
      expect(s.get(bad)).toBeNull();
    }
  });

  it("returns null for a well-formed id that was never issued", () => {
    expect(store().get("11111111-2222-3333-4444-555555555555")).toBeNull();
  });

  it("CONTRACT: a traversal file name lands inside the intake directory", () => {
    const root = mkdtempSync(join(tmpdir(), "intake-"));
    const s = new FileIntakeStore(root);
    const record = s.put({
      fetched: [file("../../escaped.pptx", [1, 2, 3])],
      unavailable: [],
      now: 1000,
    });
    const stored = record.files[0];
    if (stored === undefined) throw new Error("no file");
    expect(stored.path.startsWith(join(root, record.intakeId))).toBe(true);
    // And nothing was written beside the intake root.
    expect(readdirSync(root)).toEqual([record.intakeId]);
  });

  it("CONTRACT: a file called manifest.json cannot overwrite the manifest", () => {
    const s = store();
    const record = s.put({
      fetched: [file("manifest.json", [1])],
      unavailable: [],
      now: 1000,
    });
    // The record still reads back, so the manifest survived.
    expect(s.get(record.intakeId)?.files).toHaveLength(1);
  });

  it("does not silently collapse two files with the same name", () => {
    const s = store();
    const record = s.put({
      fetched: [file("report.pdf", [1]), file("report.pdf", [2])],
      unavailable: [],
      now: 1000,
    });
    expect(record.files).toHaveLength(2);
    const paths = new Set(record.files.map((f) => f.path));
    expect(paths.size).toBe(2);
    expect(Array.from(readFileSync(record.files[1]!.path))).toEqual([2]);
  });

  it.skipIf(platform() === "win32")(
    "CONTRACT: the document is 0600 in a 0700 directory — the whole 'never public' story",
    () => {
      const root = mkdtempSync(join(tmpdir(), "intake-"));
      const s = new FileIntakeStore(root);
      const record = s.put({ fetched: [file("a.pptx", [1, 2, 3])], unavailable: [], now: 1 });
      const stored = record.files[0];
      if (stored === undefined) throw new Error("no file");
      // eslint-disable-next-line no-bitwise -- mode bits are bit flags
      expect(statSync(stored.path).mode & 0o777).toBe(0o600);
      // eslint-disable-next-line no-bitwise -- mode bits are bit flags
      expect(statSync(join(root, record.intakeId, "files")).mode & 0o777).toBe(
        0o700,
      );
    },
  );

  it("keeps a record even when every file failed to fetch", () => {
    // The skill still has to be TOLD. A record with no files and a named
    // unavailable entry is the difference between "we lost your document"
    // and "you did not attach one".
    const s = store();
    const record = s.put({
      fetched: [],
      unavailable: [{ name: "Deck.pptx", reason: "HTTP 403" }],
      now: 1000,
    });
    expect(s.get(record.intakeId)?.unavailable).toEqual([
      { name: "Deck.pptx", reason: "HTTP 403" },
    ]);
  });
});
