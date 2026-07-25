import type { ReactElement } from "react";
import { HOST_WS_URL } from "@/config";

// D1 app shell. The live fleet view (chat.subscribe stream over the HostClient
// built in src/host/) lands in the next slice; this renders the real
// configuration state — never placeholder data.
export function App(): ReactElement {
  return (
    <main>
      <h1>Traycer Remote</h1>
      {HOST_WS_URL === null ? (
        <p>
          Set <code>VITE_HOST_WS_URL</code> to your Traycer host — e.g.{" "}
          <code>ws://127.0.0.1:PORT/rpc</code> — then reload.
        </p>
      ) : (
        <p>
          Host endpoint: <code>{HOST_WS_URL}</code>
        </p>
      )}
    </main>
  );
}
