import net from "node:net";

export const HEAD_MAX_BYTES = 65_536;

export function parseRequestLine(
  head: string,
): { readonly method: string; readonly path: string } | null {
  const firstLine = head.split("\r\n", 1)[0] ?? "";
  const match = /^([A-Z]+)\s+(\S+)\s+HTTP\/\d\.\d$/.exec(firstLine);
  if (match === null) return null;
  return { method: match[1], path: match[2] };
}

export function extractBearerToken(head: string): string | null {
  const match = /Authorization:\s*Bearer\s+(\S+)/i.exec(head);
  return match === null ? null : match[1];
}

export function extractHeader(head: string, name: string): string | null {
  const match = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(head);
  return match === null ? null : match[1].trim();
}

export function writeRawResponse(
  socket: net.Socket,
  status: number,
  statusText: string,
  body: { readonly json: unknown } | null,
): void {
  if (body === null) {
    socket.end(
      `HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    return;
  }
  const payload = Buffer.from(JSON.stringify(body.json), "utf8");
  socket.end(
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\n\r\n`,
        "utf8",
      ),
      payload,
    ]),
  );
}

/**
 * Buffers a raw TCP connection until the HTTP request head (`\r\n\r\n`) is
 * complete, then hands off to `onHead` with the socket **paused** - the
 * caller must resume it itself (typically by piping it, which resumes
 * implicitly), never by attaching a second manual `data` handler. Pausing
 * before any async work in `onHead` is what prevents bytes arriving in that
 * gap from being silently dropped (see the agent tunnel-server's regression
 * test) - shared here so the gateway's proxy gets the same guarantee for
 * free instead of re-deriving it.
 */
export function bufferHttpHead(
  client: net.Socket,
  onHead: (params: {
    readonly headBuffered: Buffer;
    readonly headEndIdx: number;
    readonly bodyAfterHead: Buffer;
  }) => void,
): void {
  let buf = Buffer.alloc(0);
  let handled = false;

  client.on("data", (chunk: Buffer | string) => {
    if (handled) return;
    buf = Buffer.concat([
      buf,
      typeof chunk === "string" ? Buffer.from(chunk) : chunk,
    ]);
    const idx = buf.indexOf("\r\n\r\n");
    if (idx === -1) {
      if (buf.length > HEAD_MAX_BYTES) {
        handled = true;
        writeRawResponse(client, 400, "Bad Request", null);
      }
      return;
    }
    handled = true;
    client.pause();
    onHead({
      headBuffered: buf.subarray(0, idx + 4),
      headEndIdx: idx,
      bodyAfterHead: buf.subarray(idx + 4),
    });
  });

  client.on("error", () => {
    // Swallow - a pre-handshake error just means the peer went away before
    // the head was ever read.
  });
}
