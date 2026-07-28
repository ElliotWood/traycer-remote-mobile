/**
 * Fail-loud startup screen for a build missing required env config — see
 * `config-diagnostics.ts`. Rendered by `AppRoot` BEFORE constructing auth,
 * the host connection, or anything else, so a doomed build says so
 * immediately instead of the user burning a sign-in attempt against it.
 */
import type { ReactElement } from "react";
import type { ConfigProblem } from "@/config-diagnostics";
import { colors, screen } from "@/views/ui";

export function ConfigErrorScreen({
  problems,
}: {
  readonly problems: readonly ConfigProblem[];
}): ReactElement {
  return (
    <main style={screen}>
      <h1 style={{ fontSize: 20 }}>Traycer Remote</h1>
      <p style={{ color: colors.muted }}>
        This build is missing required configuration and can't work yet:
      </p>
      <ul style={{ color: colors.muted, paddingLeft: 20, margin: 0 }}>
        {problems.map((problem) => (
          <li key={problem.id} style={{ marginBottom: 8 }}>
            {problem.message}
          </li>
        ))}
      </ul>
      <p style={{ color: colors.muted }}>
        See <code>.env.example</code> for what to set, then rebuild.
      </p>
    </main>
  );
}
