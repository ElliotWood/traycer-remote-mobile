#!/usr/bin/env node
// Reports what vm.bicep's provisioning WOULD put on a VM, as JSON on stdout.
//
// The other half of the drift check; infra/azure/scripts/collect-vm-state.sh
// is the side read off the machine. Neither reads anything the other wrote:
// this one never contacts Azure and never reads a VM, and the collector is
// never handed a list of paths to look for.
//
// It also holds no list of its own. Everything below is obtained by
// evaluating the template's `provisionScript` expression and reading the
// resulting script - so a file added to vm.bicep appears here with no edit,
// and one removed disappears. See provision-payload.mjs for why that
// matters more than it looks like it should.
//
// Usage:
//   node infra/azure/scripts/derive-expected-state.mjs \
//     --hostname <public-hostname> --email <acme-email> \
//     --tenants alice,bob [--repos owner/repo@branch,...]

import { assembleProvisionScript, heredocWrites, sha256 } from "./provision-payload.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) {
    if (fallback === undefined) {
      console.error(`derive-expected-state: --${name} is required`);
      console.error(
        "  Every one of these changes the assembled script, so guessing one would produce an\n" +
          "  expected state that disagrees with the VM for a reason nobody would think to look for.",
      );
      process.exit(2);
    }
    return fallback;
  }
  return argv[i + 1];
};
const list = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

const tenantIds = list(arg("tenants", ""));
const { script } = assembleProvisionScript({
  params: {
    publicHostname: arg("hostname"),
    acmeContactEmail: arg("email"),
    tenantIds,
    repoSpecs: list(arg("repos", "")),
  },
});

const writes = heredocWrites(script);

// ─── the sed the script runs over its own unit files ─────────────────────
// Unit templates ship with __TRAYCER_OS_USER__ / __TRAYCER_HOME_ROOT__
// placeholders that the provisioning script substitutes AFTER writing them.
// Hashing the heredoc body instead of the substituted result would make every
// templated unit a permanent false red - and a check that is always red gets
// muted, which is the same outcome as no check.
//
// Parsed out of the script rather than reimplemented, for the same reason
// nothing else here is hardcoded: a new placeholder added to the sed is
// picked up automatically, and one removed stops being applied.
const sedRe = /^sed -i "([^"]*)" (.+)$/gm;
for (let m; (m = sedRe.exec(script)); ) {
  const subs = [...m[1].matchAll(/s\|([^|]*)\|([^|]*)\|g/g)].map((s) => [s[1], s[2]]);
  for (const path of m[2].trim().split(/\s+/)) {
    const body = writes.get(path);
    if (body === undefined) continue; // sed over a file this script did not write
    let out = body;
    for (const [from, to] of subs) out = out.split(from).join(to);
    writes.set(path, out);
  }
}

// ─── nginx: meaning, not bytes ────────────────────────────────────────────
// certbot rewrites the vhost after bootstrap.sh writes it, so its on-disk
// bytes legitimately differ from what the template emitted. Hashing it would
// be a permanent false red; what has to match is which target `traycer_host`
// resolves to and which locations the served vhost defines. These paths are
// therefore compared as resolved facts and EXCLUDED from the hash comparison
// below - an exclusion stated here, in the output, rather than left implicit,
// because a silently-skipped file is indistinguishable from a matching one.
const NGINX_PREFIX = "/etc/nginx/";

const upstreams = {};
const locations = new Set();
// Includes are compared too, because the Teams drop-in seam IS an include and
// nothing else would notice it going missing: a glob matching zero files is
// valid nginx, so an absent include and an empty drop-in directory produce
// identical, green `nginx -t` output and identical served routes.
const includes = new Set();
for (const [path, body] of writes) {
  if (!path.startsWith(NGINX_PREFIX)) continue;
  for (const m of body.matchAll(/^\s*include\s+([^;]+);/gm)) {
    // certbot injects its own includes into the vhost, so only the drop-in
    // seams this repo owns are asserted - anything under /etc/letsencrypt is
    // certbot's to manage and its absence is not this template's drift.
    const spec = m[1].trim();
    if (!spec.startsWith("/etc/letsencrypt/")) includes.add(spec);
  }
  for (const m of body.matchAll(/upstream\s+(\S+)\s*\{([^}]*)\}/g)) {
    upstreams[m[1]] = [...m[2].matchAll(/\bserver\s+([^;\s]+)\s*;/g)].map((s) => s[1]).sort();
  }
  // Only the TLS vhost's locations. The phase-1 HTTP placeholder writes the
  // same path and is overwritten by phase 2, so `writes` already holds the
  // later one - but a block without `listen 443` is filtered anyway, so a
  // future reordering cannot quietly substitute the catch-all's location set.
  for (const block of body.split(/\bserver\s*\{/)) {
    if (!/\blisten\s+443\b/.test(block)) continue;
    for (const m of block.matchAll(/^\s*location\s+(.+?)\s*\{/gm)) locations.add(m[1].trim());
  }
}

// ─── enabled units ────────────────────────────────────────────────────────
// Read off the script's own `systemctl enable` calls. Instanced units are
// enabled inside a loop over the tenant ids, so `${tenant_id}` is expanded
// with the tenant list this run was given - the same input the template gets,
// not a second source of truth.
const enabledUnits = new Set();
for (const m of script.matchAll(/^\s*systemctl enable (?:--now )?"?([^"\s|]+)"?/gm)) {
  const unit = m[1];
  if (unit.includes("${tenant_id}")) {
    for (const id of tenantIds) enabledUnits.add(unit.split("${tenant_id}").join(id));
  } else {
    enabledUnits.add(unit);
  }
}

const files = {};
for (const [path, body] of writes) {
  if (path.startsWith(NGINX_PREFIX)) continue;
  files[path] = sha256(body);
}

process.stdout.write(
  JSON.stringify(
    {
      schema: "traycer-vm-state/1",
      files,
      enabledUnits: Object.fromEntries([...enabledUnits].sort().map((u) => [u, "enabled"])),
      nginx: { upstreams, locations: [...locations].sort(), includes: [...includes].sort() },
      excludedFromHashing: [...writes.keys()].filter((p) => p.startsWith(NGINX_PREFIX)).sort(),
    },
    null,
    2,
  ) + "\n",
);
