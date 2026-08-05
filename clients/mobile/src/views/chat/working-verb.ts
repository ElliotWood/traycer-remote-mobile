/**
 * P2 — the exact desktop working/elapsed verb lists (`working-verb.ts` in
 * gui-app), ported verbatim so the run indicator/elapsed footer read as the
 * same product, not a paraphrase. Seeded per-turn via a djb2 hash of the
 * turn/message id so the SAME turn always shows the SAME verb across
 * re-renders (not a new random pick every frame).
 */
export const WORKING_VERBS: readonly string[] = [
  "Cogitating",
  "Pondering",
  "Crunching",
  "Brewing",
  "Noodling",
  "Mulling",
  "Scheming",
  "Hatching",
  "Tinkering",
  "Conjuring",
  "Distilling",
  "Wrangling",
  "Marinating",
  "Riffing",
  "Sleuthing",
  "Plotting",
  "Stewing",
  "Forging",
  "Spelunking",
  "Channeling",
];

export const ELAPSED_VERBS: readonly string[] = [
  "Cogitated",
  "Pondered",
  "Crunched",
  "Brewed",
  "Noodled",
  "Mulled",
  "Schemed",
  "Hatched",
  "Tinkered",
  "Conjured",
  "Distilled",
  "Wrangled",
  "Marinated",
  "Riffed",
  "Sleuthed",
  "Plotted",
  "Stewed",
  "Forged",
  "Spelunked",
  "Channeled",
];

/** djb2 — the exact seeding algorithm desktop uses so the same id picks the same verb across both this port and gui-app. */
function djb2(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 33) ^ id.charCodeAt(i);
  }
  return hash >>> 0;
}

export function pickWorkingVerb(seed: string): string {
  return WORKING_VERBS[djb2(seed) % WORKING_VERBS.length] ?? WORKING_VERBS[0];
}

export function pickElapsedVerb(seed: string): string {
  return ELAPSED_VERBS[djb2(seed) % ELAPSED_VERBS.length] ?? ELAPSED_VERBS[0];
}

/** `<1000ms -> "<1s"`; else `Ns` / `Nm Xs` / `Nh Nm Xs` on floored seconds — mirrors `formatWorkedFor`/`formatClockDuration`. */
export function formatWorkedFor(elapsedMs: number): string {
  if (elapsedMs < 1000) return "<1s";
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** `>=$1 -> "$X.XX"`; `<0.0001 -> "<$0.0001"`; else 4dp, collapsing to 2dp once it rounds up to >=$1 — mirrors `formatUsd`. */
export function formatUsd(costUsd: number): string {
  if (costUsd >= 1) return `$${costUsd.toFixed(2)}`;
  if (costUsd < 0.0001) return "<$0.0001";
  const fourDp = costUsd.toFixed(4);
  return Number(fourDp) >= 1 ? `$${Number(fourDp).toFixed(2)}` : `$${fourDp}`;
}
