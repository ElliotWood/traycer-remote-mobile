/**
 * Measures whether the live deployment rate-limits anything.
 *
 * WHY THIS EXISTS AS A MEASUREMENT AND NOT A CONFIG READ. The IaC
 * (`infra/azure/scripts/bootstrap.sh:291`) puts
 * `limit_req zone=traycer_ingress burst=20 nodelay` at SERVER level in the 443
 * block, where nginx inherits it into every location. The live
 * `sites-available/traycer` has no such line. Reading a config is how you learn
 * what someone intended; only firing requests tells you what the box does.
 *
 * ARM C IS THE CONTROL AND IT IS THE POINT. `/authn/api/v3/user` is the ONE
 * location on the live box that carries its own `limit_req` (zone
 * traycer_authn, 5r/s, burst 10, limit_req_status 429). If arm C does not
 * produce 429s, this probe is measuring itself -- requests arriving too slowly
 * to exceed any budget -- and arms A and B mean nothing. A uniformly negative
 * result across a control that MUST fail is the harness indicting itself.
 *
 * No arm sends an Authorization header. `http-api.ts`'s `authorize()` 401s on a
 * missing bearer WITHOUT calling authn, so arm A generates zero upstream
 * traffic; a garbage bearer would be the amplifying shape and is deliberately
 * not what this fires in bulk.
 *
 * Usage: node rate-limit-probe.mjs [origin] [count]
 */

const ORIGIN =
  process.argv[2] ??
  "https://altra-traycer-host-aue.australiaeast.cloudapp.azure.com";
const COUNT = Number(process.argv[3] ?? 60);

async function burst(label, path, count) {
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: count }, async () => {
      try {
        const response = await fetch(`${ORIGIN}${path}`, {
          method: "GET",
          // Defeat any intermediary cache: a 200 served from cache never
          // reaches nginx's limiter and would read as "not limited".
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
        return response.status;
      } catch (err) {
        return `ERR:${err.code ?? err.message}`;
      }
    }),
  );
  const elapsedMs = Date.now() - started;
  const byStatus = {};
  for (const status of results) {
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return {
    label,
    path,
    count,
    elapsedMs,
    ratePerSec: Number((count / (elapsedMs / 1000)).toFixed(1)),
    byStatus,
    limited: (byStatus[429] ?? 0) + (byStatus[503] ?? 0),
  };
}

const arms = [
  ["A push", "/push/vapid-public-key"],
  ["B static", "/next/index.html"],
  ["C authn (CONTROL - must 429)", "/authn/api/v3/user"],
];

const out = [];
for (const [label, path] of arms) {
  out.push(await burst(label, path, COUNT));
  // Let each zone's bucket refill so one arm cannot contaminate the next.
  // The zones are keyed by $binary_remote_addr and are per-zone, but A and B
  // would share one if a server-level limit is ever added.
  await new Promise((r) => setTimeout(r, 5000));
}

console.log(JSON.stringify({ origin: ORIGIN, arms: out }, null, 2));

const control = out.find((a) => a.label.startsWith("C"));
if (control.limited === 0) {
  console.error(
    "\nCONTROL DID NOT FIRE: /authn produced no 429. This probe is measuring " +
      "itself, not the config. Every other arm's zero is meaningless.",
  );
  process.exitCode = 2;
}
