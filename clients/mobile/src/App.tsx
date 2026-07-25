import type { ReactElement } from "react";
import { FleetView } from "@/components/FleetView";

export function App(): ReactElement {
  return (
    <main>
      <h1>Traycer Remote</h1>
      <FleetView />
    </main>
  );
}
