/**
 * Builds the sideloadable Teams app package.
 *
 * `manifest.json` is committed with PLACEHOLDERS — an all-zeros app id and a
 * `REPLACE_WITH_TAB_HOST` domain — because app ids, tenant ids and the VM's
 * FQDN are deployment facts and this repo is open source. The real values
 * live in `appPackage/local-ids.json`, which is gitignored, and are
 * substituted here at package time.
 *
 * So the committed manifest is never valid to install, and the installable
 * one is never committed. That is the intended asymmetry, not an oversight.
 *
 * Usage:
 *   node appPackage/make-package.mjs
 *
 * Requires `appPackage/local-ids.json`:
 *   { "appId": "…", "botId": "…", "tabHost": "example.azure.com" }
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const ids = JSON.parse(await readFile(join(HERE, "local-ids.json"), "utf8"));
for (const key of ["appId", "botId", "tabHost"]) {
  if (typeof ids[key] !== "string" || ids[key].length === 0) {
    console.error(`local-ids.json is missing "${key}"`);
    process.exit(1);
  }
}

const manifest = JSON.parse(await readFile(join(HERE, "manifest.json"), "utf8"));

manifest.id = ids.appId;
manifest.bots[0].botId = ids.botId;
manifest.validDomains = [ids.tabHost];
for (const tab of manifest.staticTabs) {
  tab.contentUrl = tab.contentUrl.replace("REPLACE_WITH_TAB_HOST", ids.tabHost);
  tab.websiteUrl = tab.websiteUrl.replace("REPLACE_WITH_TAB_HOST", ids.tabHost);
}
// Teams rejects a package whose developer block still reads like a template,
// and a rejection at upload time is a confusing place to discover it.
manifest.developer.name = ids.developerName ?? "Traycer";

// Fail LOUDLY on anything left unsubstituted. A package that uploads and then
// shows a blank tab because one URL still said REPLACE_WITH_TAB_HOST is the
// worst possible failure mode — it looks like the app is broken.
const rendered = JSON.stringify(manifest, null, 2);
const leftovers = [...rendered.matchAll(/REPLACE_WITH_[A-Z_]+/g)].map(
  (m) => m[0],
);
if (leftovers.length > 0) {
  console.error(`manifest still contains placeholders: ${leftovers.join(", ")}`);
  process.exit(1);
}
if (rendered.includes("00000000-0000-0000-0000-000000000000")) {
  console.error("manifest still contains the all-zeros placeholder id");
  process.exit(1);
}

const out = join(HERE, "build");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(join(out, "manifest.json"), `${rendered}\n`);
for (const icon of ["color.png", "outline.png"]) {
  await writeFile(join(out, icon), await readFile(join(HERE, icon)));
}

/**
 * A Teams package is a plain ZIP with the manifest and icons at its ROOT —
 * no containing folder, or Teams rejects it.
 *
 * Written by hand with `store` (no compression) rather than shelling out.
 * `powershell.exe` was the first attempt and fails with ENOENT when node is
 * invoked from a POSIX-shell environment whose PATH has no Windows entries,
 * which is exactly how this gets run here. A 40-line writer has no PATH
 * dependency and no npm dependency either.
 */
const zip = join(HERE, "traycer-remote.zip");
await rm(zip, { force: true });
await writeZip(zip, [
  ["manifest.json", Buffer.from(`${rendered}\n`, "utf8")],
  ["color.png", await readFile(join(HERE, "color.png"))],
  ["outline.png", await readFile(join(HERE, "outline.png"))],
]);

async function writeZip(path, entries) {
  const { crc32 } = await import("node:zlib");
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // store
    // A DOS date of 0 is month 0 / day 0, which is not a valid date and
    // which some readers reject. 0x0021 is 1980-01-01, the epoch of the
    // format, and keeps the archive byte-identical across builds.
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x0021, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 30);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(path, Buffer.concat([...chunks, centralBuf, end]));
}

console.log(`package: ${zip}`);
console.log(`  app id  ${manifest.id}`);
console.log(`  tabs    ${manifest.staticTabs.map((t) => t.contentUrl).join(", ")}`);
console.log(`  domains ${manifest.validDomains.join(", ")}`);
