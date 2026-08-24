/**
 * The capture must answer R2's question and leak nothing.
 *
 * THE FIXTURE IS A REAL-SHAPED PAYLOAD, including the parts that make this
 * dangerous: a `downloadUrl` whose query string IS the authorisation, a
 * customer file name, and a SharePoint path carrying a tenant name. A fixture
 * with a tidy `https://example.com/f` would pass every assertion below while
 * proving none of them — the fifth polite fixture on this project was caught
 * today, and this is the shape of the mistake.
 *
 * The two claims are opposites and both must hold:
 *   1. every KEY survives, because a missing key is a missing finding
 *   2. no VALUE that is a document, a name, or a credential survives
 */
import { describe, expect, it } from "vitest";
import { describeAttachment } from "../attachment-capture";

/**
 * A personal-chat file attachment as Teams is documented to send one — the
 * exact shape R2 has to be designed against, with plausible secrets in it.
 */
const PERSONAL_CHAT_ATTACHMENT = {
  contentType: "application/vnd.microsoft.teams.file.download.info",
  contentUrl:
    "https://contoso.sharepoint.com/sites/Bids/Shared%20Documents/Q3-Pricing-Confidential.pptx",
  name: "Q3-Pricing-Confidential.pptx",
  content: {
    downloadUrl:
      "https://contoso.sharepoint.com/_layouts/15/download.aspx?UniqueId=abc&Translate=false&tempauth=eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0.SECRET-BEARER-MATERIAL&ApiVersion=2.0",
    uniqueId: "9f8a7b6c-1234-4567-8901-abcdefabcdef",
    fileType: "pptx",
    fileSize: 4_823_119,
  },
};

const serialise = (value: unknown): string => JSON.stringify(value);

describe("describeAttachment", () => {
  it("keeps every key, at every depth", () => {
    // The keys ARE the protocol finding. Selecting a subset would encode a
    // guess about which fields matter and then confirm it.
    const shape = serialise(describeAttachment(PERSONAL_CHAT_ATTACHMENT));
    for (const key of [
      "contentType",
      "contentUrl",
      "name",
      "content",
      "downloadUrl",
      "uniqueId",
      "fileType",
      "fileSize",
    ]) {
      expect(shape).toContain(key);
    }
  });

  it("reports contentType verbatim, because it is the answer to R2 vs R7", () => {
    const shape = describeAttachment(PERSONAL_CHAT_ATTACHMENT) as Record<
      string,
      unknown
    >;
    expect(shape["contentType"]).toBe(
      "application/vnd.microsoft.teams.file.download.info",
    );
  });

  it("reports the file SIZE, which is a number and not a document", () => {
    const shape = describeAttachment(PERSONAL_CHAT_ATTACHMENT) as Record<
      string,
      Record<string, unknown>
    >;
    expect(shape["content"]["fileSize"]).toBe(4_823_119);
    // 50MB is the ceiling the tab has to work around, so the size is not
    // incidental — it is the number that decides whether R2 can hold a file
    // in memory at all.
  });

  it("NEVER logs the bearer material in a downloadUrl", () => {
    // The query string of a Teams download link IS the credential. This is
    // the assertion that makes the flag safe to hand to Elliot.
    const shape = serialise(describeAttachment(PERSONAL_CHAT_ATTACHMENT));
    expect(shape).not.toContain("SECRET-BEARER-MATERIAL");
    expect(shape).not.toContain("tempauth");
    expect(shape).not.toContain("eyJ0eXAi");
    // …while still recording that a query existed, which is how we know the
    // link is pre-authorised rather than public.
    expect(shape).toContain("query=yes");
  });

  it("NEVER logs the customer's file name, from any of the three places it appears", () => {
    const shape = serialise(describeAttachment(PERSONAL_CHAT_ATTACHMENT));
    expect(shape).not.toContain("Q3-Pricing-Confidential");
    // The path carries it too, and the path also carries a tenant-shaped
    // site name — both gone, while the HOST survives so a SharePoint
    // reference can be told from a blob link.
    expect(shape).not.toContain("Shared%20Documents");
    expect(shape).toContain("contoso.sharepoint.com");
  });

  it("reports a string's length so the shape stays legible", () => {
    const shape = describeAttachment(PERSONAL_CHAT_ATTACHMENT) as Record<
      string,
      unknown
    >;
    expect(shape["name"]).toBe(
      `string(${String("Q3-Pricing-Confidential.pptx".length)})`,
    );
  });

  it("survives a cycle rather than throwing on it", () => {
    // `JSON.stringify` threw here; a capture that crashes on an unexpected
    // payload loses the very payload it exists to record.
    const cyclic: Record<string, unknown> = { contentType: "x" };
    cyclic["self"] = cyclic;
    expect(() => describeAttachment(cyclic)).not.toThrow();
  });

  it("does not treat a channel reference as a personal-chat download", () => {
    // The R2/R7 distinction, as a test rather than as documentation: a
    // channel attachment has no `content.downloadUrl`, and the shape must
    // make that visible rather than implying one.
    const channel = {
      contentType: "application/vnd.microsoft.teams.card.file.consent",
      contentUrl: "https://contoso.sharepoint.com/sites/Eng/Docs/spec.docx",
      name: "spec.docx",
    };
    const shape = serialise(describeAttachment(channel));
    expect(shape).not.toContain("downloadUrl");
    expect(shape).toContain("card.file.consent");
  });
});
