import net from "node:net";

/**
 * Rewrites the `Host` and `Origin` headers of a buffered HTTP request head to
 * point at the given loopback port, and strips the gateway<->agent internal
 * auth header (`X-Traycer-Agent-Token`) - the loopback host has no business
 * seeing it, matching "a host's raw loopback port is never exposed beyond
 * its agent" in reverse: nothing about the tunnel hop leaks inward either.
 * Every other header (the WS handshake's `Sec-WebSocket-*` set, in
 * particular) is left untouched - this function only ever touches HTTP
 * upgrade headers, never a WS application frame, and the handshake itself
 * is negotiated end-to-end between the original client and the host.
 * Generalizes the necessity proven in `clients/mobile/tcp-host-proxy.mjs`
 * (the Traycer Host rejects a non-loopback `Host`) into a real,
 * parameterized module - no hardcoded port/IP.
 */
export function rewriteHeadForLoopback(
  head: string,
  loopbackPort: number,
): string {
  const loopbackHost = `127.0.0.1:${loopbackPort}`;
  const loopbackOrigin = `http://${loopbackHost}`;
  return head
    .replace(/Host:[^\r\n]*/i, `Host: ${loopbackHost}`)
    .replace(/Origin:[^\r\n]*/i, `Origin: ${loopbackOrigin}`)
    .replace(/X-Traycer-Agent-Token:[^\r\n]*\r\n/i, "");
}

/**
 * Splices `client` to a fresh loopback connection at `127.0.0.1:loopbackPort`,
 * rewriting the buffered request head before the first write, then piping
 * raw bytes both directions - the agent never parses a WS application
 * frame, only the HTTP upgrade head that precedes it.
 *
 * Both directions use `.pipe()`, not a manual `on("data") -> write()`: a
 * manual write ignores `Socket#write()`'s boolean return value, so a slow
 * peer either grows an unbounded in-process buffer or silently drops bytes
 * under backpressure - exactly the asymmetry in
 * `clients/mobile/tcp-host-proxy.mjs:52-55` (downstream already piped,
 * upstream written by hand). `.pipe()` gets real flow control (pause the
 * source on backpressure, resume on `drain`) for both directions for free,
 * which matters once large payloads (image attachments) are routine, not
 * exotic (M1 contract, R4).
 */
export function forwardToLoopback(params: {
  readonly client: net.Socket;
  readonly headBuffered: Buffer;
  readonly bodyAfterHead: Buffer;
  readonly loopbackPort: number;
}): void {
  const { client, headBuffered, bodyAfterHead, loopbackPort } = params;
  const upstream = net.connect(loopbackPort, "127.0.0.1");

  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());

  const head = rewriteHeadForLoopback(headBuffered.toString("utf8"), loopbackPort);
  upstream.write(Buffer.concat([Buffer.from(head, "utf8"), bodyAfterHead]));

  // Attaching `.pipe()` puts each stream in flowing mode, which resumes a
  // paused source itself - no separate `.resume()` call needed. Default
  // `pipe()` behavior also ends the destination when the source ends,
  // which is the close-propagation this used to wire by hand.
  upstream.pipe(client);
  client.pipe(upstream);
}
