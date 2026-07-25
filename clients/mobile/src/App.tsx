import { useState, type ReactElement } from "react";
import { BlockedView } from "@/components/BlockedView";
import { FleetView } from "@/components/FleetView";

export function App(): ReactElement {
  const [epicId, setEpicId] = useState("");
  const [chatId, setChatId] = useState("");
  const open = epicId.length > 0 && chatId.length > 0;

  return (
    <main>
      <h1>Traycer Remote</h1>

      <h2>Fleet</h2>
      <FleetView />

      <h2>Open a chat</h2>
      <form onSubmit={(event) => event.preventDefault()}>
        <label>
          Epic ID{" "}
          <input
            value={epicId}
            onChange={(event) => setEpicId(event.target.value)}
          />
        </label>{" "}
        <label>
          Chat ID{" "}
          <input
            value={chatId}
            onChange={(event) => setChatId(event.target.value)}
          />
        </label>
      </form>

      {open ? <BlockedView epicId={epicId} chatId={chatId} /> : null}
    </main>
  );
}
