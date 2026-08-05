#!/usr/bin/env node
// Compares a VM's actual state against what vm.bicep would produce, and exits
// non-zero on any disagreement.
//
// Usage: node compare-vm-state.mjs <expected.json> <actual.json>
// Exit codes: 0 = in parity, 1 = drift found, 2 = usage/parse error.
//
// WHY THE COMPARISON IS ITS OWN FILE. It has to be testable without an Azure
// subscription, a VM, or a network - otherwise the only way to find out
// whether the drift check can actually go RED is to have drift on a real
// machine, and a check nobody has watched fail is a check nobody has
// verified. verify-iac-parity.test.sh drives this directly with synthetic
// documents, starting with the case it exists to catch.
//
// EVERY DIRECTION IS A FINDING, and the third one is the one that matters:
//
//   MISSING    in the template, absent from the VM   - a rebuild lost it
//   DIFFERENT  present on both, contents disagree    - edited in place
//   UNEXPECTED on the VM, in no template             - "it only ever existed
//                                                      as a manual change on
//                                                      the running box"
//
// That last direction is the one this epic keeps getting caught by, and it is
// invisible to any check built around verifying an expected list. It is only
// available because the two sides enumerate independently.

import { readFileSync } from "node:fs";

const [expectedPath, actualPath] = process.argv.slice(2);
if (!expectedPath || !actualPath) {
  console.error("usage: compare-vm-state.mjs <expected.json> <actual.json>");
  process.exit(2);
}

const load = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    console.error(`compare-vm-state: could not read ${p}: ${err.message}`);
    process.exit(2);
  }
};

const expected = load(expectedPath);
const actual = load(actualPath);

const findings = [];
const note = (kind, detail) => findings.push({ kind, detail });

// A collector that failed to read the config must not be able to look like a
// VM whose config simply matches. Absent evidence is not evidence of parity.
if (actual.nginx?.configReadable === false) {
  note("COLLECTOR", "nginx -T produced nothing on the VM - the nginx findings below cannot be trusted; fix this before reading them");
}
if (actual.schema !== expected.schema) {
  note("COLLECTOR", `schema mismatch: expected "${expected.schema}", actual "${actual.schema}" - the two sides are different versions`);
}

// ── files ────────────────────────────────────────────────────────────────
{
  const e = expected.files ?? {};
  const a = actual.files ?? {};
  // An empty expected side would report every VM file as UNEXPECTED and no
  // file as MISSING, which reads as a loud, wrong answer rather than a
  // failure to derive. Refuse instead.
  if (Object.keys(e).length === 0) {
    console.error("compare-vm-state: the expected side lists no files at all - the derivation failed rather than the VM being empty");
    process.exit(2);
  }
  for (const [path, hash] of Object.entries(e)) {
    if (!(path in a)) note("MISSING", `${path} - the template writes it, the VM does not have it`);
    else if (a[path] !== hash) note("DIFFERENT", `${path}\n    expected sha256 ${hash}\n    actual   sha256 ${a[path]}`);
  }
  for (const path of Object.keys(a)) {
    if (!(path in e)) note("UNEXPECTED", `${path} - present on the VM, produced by no template`);
  }
}

// ── enabled units ────────────────────────────────────────────────────────
{
  const e = expected.enabledUnits ?? {};
  const a = actual.enabledUnits ?? {};
  for (const unit of Object.keys(e)) {
    if (!(unit in a)) note("UNIT-NOT-ENABLED", `${unit} - the provisioning script enables it, the VM does not have it enabled`);
    else if (a[unit] !== "enabled") {
      // `enabled-runtime` survives until reboot and no longer. On a box whose
      // whole purpose is surviving a rebuild, that is drift wearing the word
      // "enabled", so it is reported rather than normalised.
      note("UNIT-STATE", `${unit} is "${a[unit]}", not "enabled" - it will not survive a reboot`);
    }
  }
  for (const unit of Object.keys(a)) {
    if (!(unit in e)) note("UNIT-UNEXPECTED", `${unit} is enabled on the VM and by no template`);
  }
}

// ── nginx: resolved meaning, not bytes ───────────────────────────────────
{
  const e = expected.nginx ?? {};
  const a = actual.nginx ?? {};

  // THE ACCEPTANCE CASE. Repointing `traycer_host` from the router to one
  // tenant's host is a one-line edit that keeps `nginx -t` green and keeps
  // the site serving, while removing A2's identity check from the request
  // path entirely. Nothing else in this repo notices it. This does.
  const eu = e.upstreams ?? {};
  const au = a.upstreams ?? {};
  for (const [name, servers] of Object.entries(eu)) {
    const got = au[name];
    if (!got) note("UPSTREAM-MISSING", `upstream ${name} is not defined in the VM's resolved config - nginx would refuse to load a vhost referencing it`);
    else if (JSON.stringify(got) !== JSON.stringify(servers)) {
      note(
        "UPSTREAM-REPOINTED",
        `upstream ${name} resolves to a different target\n` +
          `    expected ${JSON.stringify(servers)}\n` +
          `    actual   ${JSON.stringify(got)}\n` +
          `    This is the failure the check exists for: nginx -t stays green and the site keeps\n` +
          `    serving, but traffic no longer passes through the identity router.`,
      );
    }
  }

  const setDiff = (kind, label, want = [], got = []) => {
    const missing = want.filter((x) => !got.includes(x));
    const extra = got.filter((x) => !want.includes(x));
    // Compared as whole sets, not as "are the ones I thought of present".
    // A count would be invariant under a one-in-one-out swap, and a
    // spot-check of known names cannot see a route nobody listed.
    if (missing.length) note(kind, `${label} missing from the VM: ${JSON.stringify(missing)}`);
    if (extra.length) note(kind, `${label} on the VM and in no template: ${JSON.stringify(extra)}`);
  };
  setDiff("LOCATIONS", "vhost locations", e.locations, a.locations);

  // Includes are compared in ONE direction only, and the asymmetry is
  // deliberate rather than an oversight. Every expected include must be
  // present - that is what catches the drop-in seam going missing, which no
  // other check can see, since an include whose glob matches zero files is
  // valid nginx and an absent one produces identical served routes and an
  // identical green `nginx -t`.
  //
  // The other direction is noise: `nginx -T` reports stock includes this repo
  // does not own and must not assert on (mime.types, modules-enabled/,
  // sites-enabled/, conf.d/, and certbot's own options-ssl-nginx.conf).
  // Reporting those as drift is how a real finding gets lost in a list nobody
  // reads to the end.
  const missingIncludes = (e.includes ?? []).filter((i) => !(a.includes ?? []).includes(i));
  if (missingIncludes.length) {
    note("INCLUDES", `vhost includes missing from the VM: ${JSON.stringify(missingIncludes)}`);
  }
}

// ── config vs. reality ───────────────────────────────────────────────────
// nginx -T parses what is ON DISK. A config edited without a reload reads as
// already in effect. This cross-check asks the kernel who actually holds the
// port the upstream points at, so "the file says the router" and "the router
// is not running" cannot both pass unnoticed.
{
  const target = (expected.nginx?.upstreams?.traycer_host ?? [])[0];
  const listening = actual.listening ?? {};
  // Which unit SHOULD hold it is derived, not asserted: it is the one the
  // template writes with the router's ExecStart. Falling back to the literal
  // name only if that derivation finds nothing.
  const routerUnit =
    Object.keys(expected.enabledUnits ?? {}).find((u) => /tenant-router/.test(u)) ?? "traycer-tenant-router.service";

  if (target && Object.keys(listening).length > 0) {
    const port = target.split(":").pop();
    const hit = Object.entries(listening).find(([addr]) => addr.split(":").pop() === port);
    if (!hit) {
      note("UPSTREAM-DEAD", `nothing is listening on ${target}, which traycer_host points at - /rpc and /stream will 502`);
    } else {
      // Compared by UNIT, never by process name. Every relevant process on
      // this box is `node` - the router, a tenant's host, and the relay the
      // router replaced are identical by that measure, so a name-based check
      // could not distinguish the correct configuration from the failure it
      // is supposed to catch. It would have fired on a healthy box and stayed
      // quiet on a repointed one.
      const unit = hit[1]?.unit ?? "(unknown)";
      if (unit !== routerUnit) {
        note(
          "UPSTREAM-IMPOSTOR",
          `${target} is held by unit "${unit}", not "${routerUnit}" (pid ${hit[1]?.pid}) - ` +
            `the config points at the right port and the wrong process`,
        );
      }
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────
if (findings.length === 0) {
  console.log("compare-vm-state: PASS - the VM matches what vm.bicep would produce");
  process.exit(0);
}

const byKind = new Map();
for (const f of findings) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f.detail]);
console.error(`compare-vm-state: FAIL - ${findings.length} finding(s)\n`);
for (const [kind, details] of byKind) {
  console.error(`${kind} (${details.length})`);
  for (const d of details) console.error(`  - ${d}`);
  console.error("");
}
process.exit(1);
