import type { ServerResponse } from "node:http";

/**
 * Structural shape `CloudAdapter.process()` and this module's own middleware
 * require (`@microsoft/agents-hosting`'s `WebResponse`). Node's core
 * `http.ServerResponse` already has `setHeader`/`end`/`headersSent`/
 * `writableEnded`; this only needs to add `.status()`/`.send()`.
 */
export interface WebResponseLike {
  status(code: number): this;
  setHeader(name: string, value: string): this;
  /** `unknown` already admits `undefined` explicitly passed — no `?:` needed, and the SDK's `WebResponse` caller always passes an argument. */
  send(body: unknown): this;
  end(): this;
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
}

export function toWebResponse(res: ServerResponse): WebResponseLike {
  const adapter: WebResponseLike = {
    status(code) {
      res.statusCode = code;
      return adapter;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
      return adapter;
    },
    send(body) {
      if (body === undefined) {
        res.end();
        return adapter;
      }
      if (typeof body === "string" || Buffer.isBuffer(body)) {
        res.end(body);
        return adapter;
      }
      if (!res.hasHeader("content-type")) {
        res.setHeader("content-type", "application/json");
      }
      res.end(JSON.stringify(body));
      return adapter;
    },
    end() {
      res.end();
      return adapter;
    },
    get headersSent() {
      return res.headersSent;
    },
    get writableEnded() {
      return res.writableEnded;
    },
  };
  return adapter;
}
