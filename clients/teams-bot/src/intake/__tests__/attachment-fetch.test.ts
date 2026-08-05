import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_DOWNLOAD_HOST_SUFFIXES,
  classifyAttachment,
  fetchAttachment,
  ingestAttachments,
  isAllowedDownloadHost,
  type FetchFn,
  TEAMS_FILE_DOWNLOAD_CONTENT_TYPE,
  TEAMS_FILE_INFO_CONTENT_TYPE,
} from "../attachment-fetch";

const HOST = "contoso.sharepoint.com";
const URL_OK = `https://${HOST}/personal/x/_layouts/download.aspx?token=SECRET`;

function downloadAttachment(name: string, downloadUrl: string): unknown {
  return {
    contentType: TEAMS_FILE_DOWNLOAD_CONTENT_TYPE,
    name,
    content: { downloadUrl, uniqueId: "u-1", fileType: "pptx" },
  };
}

/** A `Response` with a real stream body, so the capped reader is exercised. */
function bodyResponse(
  bytes: Uint8Array,
  init: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(bytes, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

describe("classifyAttachment", () => {
  it("recognises the personal-chat download shape and lifts the URL", () => {
    const result = classifyAttachment(downloadAttachment("Retail Presentation.pptx", URL_OK));
    expect(result).toEqual({
      kind: "downloadable",
      name: "Retail Presentation.pptx",
      downloadUrl: URL_OK,
    });
  });

  it("CONTRACT: text/html is NOT a file — the shape production actually sends", () => {
    // Measured on the live bot, not inferred. The only attachment shape ever
    // captured in the deployed journal was
    // {"contentType":"text/html","content":"string(11)"} on a plain text
    // message, and `classify` was reading `attachments.length > 0` as "has a
    // document" for every formatted message because of it.
    expect(
      classifyAttachment({ contentType: "text/html", content: "<p>hello</p>" }),
    ).toEqual({ kind: "not_a_file" });
  });

  it("accepts the lower-cased key spelling the wire has also used", () => {
    expect(
      classifyAttachment({
        contenttype: TEAMS_FILE_DOWNLOAD_CONTENT_TYPE,
        name: "a.pdf",
        content: { downloadUrl: URL_OK },
      }).kind,
    ).toBe("downloadable");
  });

  it("CONTRACT: a channel/SharePoint reference is 'needs_graph', never 'not a file'", () => {
    // Counting it as zero is the exact defect this epic is fixing: the user
    // watched themselves upload a document and the skill is told none arrived.
    expect(
      classifyAttachment({
        contentType: TEAMS_FILE_INFO_CONTENT_TYPE,
        name: "Deck.pptx",
      }),
    ).toEqual({ kind: "needs_graph", name: "Deck.pptx" });
  });

  it("a download shape with no downloadUrl is still reported as a file", () => {
    expect(
      classifyAttachment({
        contentType: TEAMS_FILE_DOWNLOAD_CONTENT_TYPE,
        name: "Deck.pptx",
        content: {},
      }).kind,
    ).toBe("needs_graph");
  });

  it("survives junk without throwing", () => {
    for (const junk of [null, undefined, 42, "string", []]) {
      expect(classifyAttachment(junk).kind).toBe("not_a_file");
    }
  });
});

describe("isAllowedDownloadHost", () => {
  it("accepts a real SharePoint host and its exact suffixes", () => {
    expect(isAllowedDownloadHost("contoso.sharepoint.com")).toBe(true);
    expect(isAllowedDownloadHost("CONTOSO.SharePoint.com")).toBe(true);
    for (const suffix of ALLOWED_DOWNLOAD_HOST_SUFFIXES) {
      expect(isAllowedDownloadHost(suffix)).toBe(true);
    }
  });

  it("CONTRACT: matches on a label boundary — a suffix is not a substring", () => {
    // `evil-sharepoint.com` ends with `sharepoint.com`. A naive `endsWith`
    // would let an attacker register it and be allowlisted.
    expect(isAllowedDownloadHost("evil-sharepoint.com")).toBe(false);
    expect(isAllowedDownloadHost("notsvc.ms")).toBe(false);
  });

  it("refuses the addresses that make this an SSRF sink", () => {
    for (const host of ["169.254.169.254", "localhost", "127.0.0.1", "metadata.google.internal"]) {
      expect(isAllowedDownloadHost(host)).toBe(false);
    }
  });
});

describe("fetchAttachment", () => {
  it("returns the bytes for an allowlisted https URL", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(bodyResponse(payload, {}));
    const outcome = await fetchAttachment(
      { name: "a.pptx", downloadUrl: URL_OK },
      { fetchFn },
    );
    expect(outcome.kind).toBe("fetched");
    if (outcome.kind !== "fetched") return;
    expect(Array.from(outcome.file.bytes)).toEqual([1, 2, 3, 4]);
    expect(outcome.file.name).toBe("a.pptx");
  });

  it("CONTRACT: never opens a socket to a non-allowlisted host", async () => {
    // The check is BEFORE the fetch, not a filter on its result. An SSRF
    // guard that fires after the request has already reached IMDS is not one.
    const fetchFn = vi.fn<FetchFn>();
    const outcome = await fetchAttachment(
      {
        name: "token",
        downloadUrl: "https://169.254.169.254/metadata/identity/oauth2/token",
      },
      { fetchFn },
    );
    expect(outcome.kind).toBe("refused");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("CONTRACT: refuses plain http even on an allowlisted host", async () => {
    const fetchFn = vi.fn<FetchFn>();
    const outcome = await fetchAttachment(
      { name: "a", downloadUrl: `http://${HOST}/x` },
      { fetchFn },
    );
    expect(outcome.kind).toBe("refused");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("CONTRACT: re-checks the allowlist on EVERY redirect hop", async () => {
    // This is the bypass that `redirect: "follow"` would leave open: hop 0
    // passes the check, and SharePoint's own 302 chain carries the request
    // anywhere the redirector points. Manual redirects exist for this test.
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/metadata" },
        }),
      )
      .mockResolvedValue(bodyResponse(new Uint8Array([9]), {}));

    const outcome = await fetchAttachment(
      { name: "a", downloadUrl: URL_OK },
      { fetchFn },
    );
    expect(outcome.kind).toBe("refused");
    // Exactly one call: the first hop. The redirect target was never fetched.
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("follows a redirect that stays inside the allowlist", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://${HOST}/real/file` },
        }),
      )
      .mockResolvedValueOnce(bodyResponse(new Uint8Array([7, 7]), {}));
    const outcome = await fetchAttachment(
      { name: "a", downloadUrl: URL_OK },
      { fetchFn },
    );
    expect(outcome.kind).toBe("fetched");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("CONTRACT: enforces the size cap while reading, not just on content-length", async () => {
    // A `content-length` header can be absent or simply lie, so a cap that
    // only reads it caps nothing. The stream is what has to be counted.
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(bodyResponse(new Uint8Array(4096), {}));
    const outcome = await fetchAttachment(
      { name: "a", downloadUrl: URL_OK },
      { fetchFn, maxBytes: 100 },
    );
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toMatch(/limit/i);
  });

  it("refuses early when content-length already exceeds the cap", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(
        bodyResponse(new Uint8Array([1]), {
          headers: { "content-length": "999999999" },
        }),
      );
    const outcome = await fetchAttachment(
      { name: "a", downloadUrl: URL_OK },
      { fetchFn, maxBytes: 100 },
    );
    expect(outcome.kind).toBe("refused");
  });

  it("reports an HTTP error as failed rather than storing an error page", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(new Response("nope", { status: 403 }));
    const outcome = await fetchAttachment(
      { name: "a", downloadUrl: URL_OK },
      { fetchFn },
    );
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.reason).toContain("403");
  });

  it("reports a thrown fetch rather than escaping", async () => {
    const fetchFn = vi.fn<FetchFn>().mockRejectedValue(new Error("ETIMEDOUT"));
    const outcome = await fetchAttachment(
      { name: "a", downloadUrl: URL_OK },
      { fetchFn },
    );
    expect(outcome).toEqual({ kind: "failed", reason: "ETIMEDOUT" });
  });
});

describe("ingestAttachments", () => {
  it("fetches files and ignores the text/html formatting blob", async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(bodyResponse(new Uint8Array([5]), {}));
    const result = await ingestAttachments(
      [{ contentType: "text/html", content: "<p>hi</p>" }, downloadAttachment("Retail Presentation.pptx", URL_OK)],
      { fetchFn },
    );
    expect(result.fetched).toHaveLength(1);
    expect(result.unavailable).toHaveLength(0);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("CONTRACT: one bad file does not lose a good one", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(bodyResponse(new Uint8Array([5]), {}));
    const result = await ingestAttachments(
      [downloadAttachment("bad.pptx", URL_OK), downloadAttachment("good.pptx", URL_OK)],
      { fetchFn },
    );
    expect(result.fetched.map((f) => f.name)).toEqual(["good.pptx"]);
    expect(result.unavailable.map((f) => f.name)).toEqual(["bad.pptx"]);
  });

  it("CONTRACT: a channel file is reported unavailable, never dropped", async () => {
    const fetchFn = vi.fn<FetchFn>();
    const result = await ingestAttachments(
      [{ contentType: TEAMS_FILE_INFO_CONTENT_TYPE, name: "Deck.pptx" }],
      { fetchFn },
    );
    expect(result.fetched).toHaveLength(0);
    expect(result.unavailable).toEqual([
      { name: "Deck.pptx", reason: "the bot cannot read files shared in a channel yet" },
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns empty for no attachments at all", async () => {
    expect(await ingestAttachments(undefined, {})).toEqual({
      fetched: [],
      unavailable: [],
    });
  });
});

describe("the download URL is a credential", () => {
  it("CONTRACT: no log line ever contains the URL or its query", async () => {
    // A Teams downloadUrl carries its authorisation in the query string.
    // Anything that logs it has written a bearer capability for a customer's
    // document into a file that outlives the question.
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      });
    try {
      const fetchFn = vi
        .fn<FetchFn>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: `https://${HOST}/next?token=SECRET2` },
          }),
        )
        .mockResolvedValueOnce(bodyResponse(new Uint8Array([1]), {}));
      await fetchAttachment(
        { name: "a", downloadUrl: URL_OK },
        { fetchFn },
      );
    } finally {
      spy.mockRestore();
    }
    const all = written.join("");
    expect(all).not.toContain("SECRET");
    expect(all).not.toContain("SECRET2");
    expect(all).not.toContain("download.aspx");
    // The host IS logged — it is the diagnostic and it is not customer data.
    expect(all).toContain(HOST);
  });
});
