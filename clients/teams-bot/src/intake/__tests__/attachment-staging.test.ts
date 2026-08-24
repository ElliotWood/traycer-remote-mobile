import { describe, expect, it } from "vitest";
import { mkdtempSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyAttachment,
  isSafeFileName,
  isStagingId,
  listStagedFiles,
  stageAttachments,
  stagingDirectory,
  stagingRootFromEnv,
  stagingUnavailable,
  MAX_FILE_BYTES,
  type StagingOutcome,
} from "../attachment-staging";

const STAGING_ID = "1f0a2b3c-4d5e-4f60-8a91-b2c3d4e5f607";

/** A personal-chat file attachment, as Teams delivers it. */
function personalFile(name: string) {
  return personalFileFrom(name, "https://files.invalid/d?t=SECRET");
}

function personalFileFrom(name: string, url: string) {
  return {
    contentType: "application/vnd.microsoft.teams.file.download.info",
    name,
    content: { downloadUrl: url, uniqueId: "u1", fileType: "pdf" },
  };
}

/** A channel post's file, which is a SharePoint reference needing Graph. */
const CHANNEL_FILE = {
  contentType: "reference",
  name: "Tender.pdf",
  contentUrl: "https://contoso.sharepoint.com/sites/bids/Tender.pdf",
};

function okResponse(body: string): Response {
  return okResponseWith(body, {});
}

function okResponseWith(
  body: string,
  headers: Record<string, string>,
): Response {
  return new Response(new TextEncoder().encode(body), { status: 200, headers });
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "staging-"));
}

describe("classifyAttachment — which scope is this", () => {
  it("recognises a personal-chat download", () => {
    expect(classifyAttachment(personalFile("Tender.pdf"))).toEqual({
      kind: "file",
      name: "Tender.pdf",
      downloadUrl: "https://files.invalid/d?t=SECRET",
    });
  });

  it("CONTRACT: reads contentType under both spellings the wire has used", () => {
    // The SDK family has sent `contentType` and `contenttype` across
    // versions, and `attachment-capture.ts` records the same finding. Reading
    // one spelling would classify every file in one scope as "not a file" and
    // stage nothing, with no error anywhere.
    const lowered = {
      contenttype: "application/vnd.microsoft.teams.file.download.info",
      name: "Tender.pdf",
      content: { downloadurl: "https://files.invalid/d?t=x" },
    };
    expect(classifyAttachment(lowered).kind).toBe("file");
  });

  it("CONTRACT: a channel's SharePoint reference is its own kind, not a file", () => {
    expect(classifyAttachment(CHANNEL_FILE)).toEqual({
      kind: "needs-graph",
      name: "Tender.pdf",
    });
  });

  it("catches a SharePoint link arriving under some other contentType", () => {
    expect(
      classifyAttachment({
        contentType: "application/pdf",
        name: "Tender.pdf",
        contentUrl: "https://contoso.sharepoint.com/x/Tender.pdf",
      }).kind,
    ).toBe("needs-graph");
  });

  it("a download.info with no usable URL is unreadable, NOT 'not a file'", () => {
    // The user attached something. Silently dropping it from the count is how
    // an assessment runs against nothing and reads as complete.
    expect(
      classifyAttachment({ ...personalFile("x.pdf"), content: {} }).kind,
    ).toBe("unreadable");
    expect(
      classifyAttachment({
        ...personalFile("x.pdf"),
        content: { downloadUrl: "file:///etc/passwd" },
      }).kind,
    ).toBe("unreadable");
  });

  it("the message's own HTML body is not a document", () => {
    expect(
      classifyAttachment({ contentType: "text/html", content: "<p>hi</p>" }),
    ).toEqual({ kind: "not-a-file" });
    expect(classifyAttachment(null).kind).toBe("not-a-file");
    expect(classifyAttachment("nonsense").kind).toBe("not-a-file");
  });
});

describe("staging paths — the id is checked before it is joined", () => {
  it("accepts a UUID and refuses everything else", () => {
    expect(isStagingId(STAGING_ID)).toBe(true);
    for (const bad of [
      "",
      "..",
      "../../etc",
      `${STAGING_ID}/../..`,
      "1f0a2b3c4d5e4f608a91b2c3d4e5f607",
      "ZZZZZZZZ-4d5e-4f60-8a91-b2c3d4e5f607",
    ]) {
      expect(isStagingId(bad), bad).toBe(false);
    }
  });

  it("CONTRACT: a malformed id yields null, never a joined path", () => {
    // The id rides in a card payload Bot Service relays. Joining it unchecked
    // is a path traversal out of the staging root.
    expect(stagingDirectory("/srv/intake", "../../etc")).toBeNull();
    expect(stagingDirectory("/srv/intake", STAGING_ID)).toBe(
      `/srv/intake/${STAGING_ID}`,
    );
  });

  it("takes the explicit variable, then the state dir, then a documented default", () => {
    expect(
      stagingRootFromEnv({ TRAYCER_TEAMS_STAGING_DIR: "/data/intake" }),
    ).toBe("/data/intake");
    expect(stagingRootFromEnv({ TRAYCER_TEAMS_STATE_DIR: "/var/bot" })).toBe(
      "/var/bot/intake",
    );
    // NOT `$HOME`: the bot's home on the VM is `/srv/traycer/tenants`, which
    // is not `/srv/traycer`, and assuming otherwise caused a bug once.
    expect(stagingRootFromEnv({})).toBe("/srv/traycer/teams-bot/state/intake");
  });
});

describe("isSafeFileName — refused, not sanitised", () => {
  it("accepts the names real tender documents have", () => {
    for (const name of [
      "Tender.pdf",
      "Schedule A — pricing.xlsx",
      "RFP (final) v2.docx",
      "résumé.pdf",
    ]) {
      expect(isSafeFileName(name), name).toBe(true);
    }
  });

  it("CONTRACT: refuses anything that could leave the staging directory", () => {
    for (const name of [
      "",
      ".",
      "..",
      "../escape.pdf",
      "a/b.pdf",
      "a\\b.pdf",
      "x".repeat(201),
    ]) {
      expect(isSafeFileName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it("refuses control characters, including the NUL a path API truncates on", () => {
    // Built by code point rather than typed as an escape: an escape typed
    // into a source file can land as a REAL control byte, which turns the
    // file binary and the check into a no-op every gate still passes.
    expect(isSafeFileName(`a${String.fromCharCode(0)}.pdf`)).toBe(false);
    expect(isSafeFileName(`a${String.fromCharCode(10)}b.pdf`)).toBe(false);
    expect(isSafeFileName(`a${String.fromCharCode(127)}b.pdf`)).toBe(false);
  });
});

describe("stageAttachments — bytes on disk, or a loud refusal", () => {
  it("writes every document and reports where they went", async () => {
    const root = tempRoot();
    const outcome = await stageAttachments(
      [personalFile("Tender.pdf"), personalFile("Schedule A.xlsx")],
      {
        stagingRoot: root,
        fetchImpl: async () => okResponse("PDF-BYTES"),
        newId: () => STAGING_ID,
      },
    );
    expect(outcome.kind).toBe("staged");
    if (outcome.kind !== "staged") return;
    expect(outcome.files.map((f) => f.name)).toEqual([
      "Tender.pdf",
      "Schedule A.xlsx",
    ]);
    // Read back off the REAL filesystem — the whole gap being closed is that
    // nothing was ever written, and a mocked writer could not tell us.
    expect(await readFile(join(outcome.directory, "Tender.pdf"), "utf8")).toBe(
      "PDF-BYTES",
    );
    expect(await listStagedFiles(outcome.directory)).toContain("Tender.pdf");
  });

  it("CONTRACT: staged files are not world-readable", async () => {
    // These are customer tender documents on a shared VM, where the default
    // umask leaves new files readable by everyone with an account.
    const root = tempRoot();
    const outcome = await stageAttachments([personalFile("Tender.pdf")], {
      stagingRoot: root,
      fetchImpl: async () => okResponse("x"),
      newId: () => STAGING_ID,
    });
    expect(outcome.kind).toBe("staged");
    if (outcome.kind !== "staged") return;
    if (process.platform === "win32") return; // POSIX modes only.
    expect(statSync(outcome.directory).mode & 0o077).toBe(0);
    expect(statSync(join(outcome.directory, "Tender.pdf")).mode & 0o077).toBe(
      0,
    );
  });

  it("CONTRACT: a channel post REFUSES rather than staging zero files", async () => {
    // Only personal scope is built. Proceeding would start an assessment
    // against nothing and return an answer that reads as finished work.
    let fetched = 0;
    const outcome = await stageAttachments([CHANNEL_FILE], {
      stagingRoot: tempRoot(),
      fetchImpl: async () => {
        fetched++;
        return okResponse("x");
      },
    });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toContain("channel");
    expect(fetched).toBe(0);
  });

  it("CONTRACT: refuses two files sharing a name instead of renaming one", () => {
    // `assemble-bundle` treats a basename collision as a hard failure only a
    // human rename can fix. Inventing `Tender (2).pdf` here pushes the same
    // collision downstream and destroys "exactly as supplied" on the way.
    return stageAttachments(
      [personalFile("Tender.pdf"), personalFile("Tender.pdf")],
      { stagingRoot: tempRoot(), fetchImpl: async () => okResponse("x") },
    ).then((outcome) => {
      expect(outcome.kind).toBe("refused");
      if (outcome.kind !== "refused") return;
      expect(outcome.reason).toContain("Tender.pdf");
    });
  });

  it("refuses an undownloadable attachment rather than dropping it", async () => {
    const outcome = await stageAttachments(
      [{ ...personalFile("x.pdf"), content: {} }],
      { stagingRoot: tempRoot(), fetchImpl: async () => okResponse("x") },
    );
    expect(outcome.kind).toBe("refused");
  });

  it("ALL OR NOTHING: a failure on the second file refuses the whole intake", async () => {
    // A partial stage runs an assessment against some of a tender and
    // presents it as a complete one.
    let call = 0;
    const outcome = await stageAttachments(
      [personalFile("a.pdf"), personalFile("b.pdf")],
      {
        stagingRoot: tempRoot(),
        fetchImpl: async () => {
          call++;
          return call === 1
            ? okResponse("ok")
            : new Response("nope", { status: 403 });
        },
      },
    );
    expect(outcome.kind).toBe("refused");
  });

  it("survives a fetch that throws", async () => {
    const outcome = await stageAttachments([personalFile("a.pdf")], {
      stagingRoot: tempRoot(),
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      },
    });
    expect(outcome.kind).toBe("refused");
  });

  it("refuses a body larger than the cap, by declared size and by actual size", async () => {
    const byHeader = await stageAttachments([personalFile("huge.pdf")], {
      stagingRoot: tempRoot(),
      fetchImpl: async () =>
        okResponseWith("x", { "content-length": String(MAX_FILE_BYTES + 1) }),
    });
    expect(byHeader.kind).toBe("refused");
  });

  it("no attachments at all is a legitimate intake, not a refusal", async () => {
    const outcome: StagingOutcome = await stageAttachments(undefined, {
      stagingRoot: tempRoot(),
      fetchImpl: async () => okResponse("x"),
    });
    expect(outcome.kind).toBe("none");
    expect(
      (
        await stageAttachments(
          [{ contentType: "text/html", content: "<p/>" }],
          {
            stagingRoot: tempRoot(),
            fetchImpl: async () => okResponse("x"),
          },
        )
      ).kind,
    ).toBe("none");
  });

  it("CONTRACT: the download URL never leaves this module", async () => {
    // A Teams `downloadUrl` carries its authorisation in the query string. It
    // is a credential, and the whole outcome object is what the caller — and
    // through it a card payload — can see.
    const outcome = await stageAttachments(
      [
        personalFileFrom(
          "Tender.pdf",
          "https://files.invalid/d?token=SUPERSECRET",
        ),
      ],
      {
        stagingRoot: tempRoot(),
        fetchImpl: async () => okResponse("x"),
        newId: () => STAGING_ID,
      },
    );
    expect(JSON.stringify(outcome)).not.toContain("SUPERSECRET");
    expect(JSON.stringify(outcome)).not.toContain("token=");
  });

  it("a fresh directory per message, so a retry cannot half-overwrite the first", async () => {
    const root = tempRoot();
    const stage = (): Promise<StagingOutcome> =>
      stageAttachments([personalFile("Tender.pdf")], {
        stagingRoot: root,
        fetchImpl: async () => okResponse("x"),
      });
    const first = await stage();
    const second = await stage();
    expect(first.kind).toBe("staged");
    expect(second.kind).toBe("staged");
    if (first.kind !== "staged" || second.kind !== "staged") return;
    expect(first.directory).not.toBe(second.directory);
  });

  it("CONTRACT: a deployment with no stager refuses files rather than dropping them", () => {
    // The alternative is "assessment started" on a request whose documents
    // were silently discarded — a confident answer about a tender nobody
    // read. A request with no files at all is still legitimate.
    expect(stagingUnavailable(undefined).kind).toBe("none");
    expect(
      stagingUnavailable([{ contentType: "text/html", content: "<p/>" }]).kind,
    ).toBe("none");
    expect(stagingUnavailable([personalFile("Tender.pdf")]).kind).toBe(
      "refused",
    );
    // A channel reference too: it is still a document the user attached.
    expect(stagingUnavailable([CHANNEL_FILE]).kind).toBe("refused");
  });

  it("listStagedFiles returns null for a directory that is not there", async () => {
    // `null` and `[]` are different facts: one is a staging id that no longer
    // resolves, the other is a directory that exists and is empty. The caller
    // refuses on both, but only because it can tell them from a real listing.
    expect(await listStagedFiles(join(tempRoot(), "nope"))).toBeNull();
  });
});
