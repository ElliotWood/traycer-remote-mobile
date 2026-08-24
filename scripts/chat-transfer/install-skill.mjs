#!/usr/bin/env node
// Install `SKILL.md` into the skill roots the harnesses read.
//
// The repo copy is canonical. These are copies, and Traycer owns those
// directories - a host update that reconciles its own bundled skills may
// remove an entry it does not know about, so this is re-runnable and reports
// exactly what it wrote. It deliberately does NOT write a
// `.traycer-managed.json`: this skill is not Traycer-managed and should never
// claim to be.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "SKILL.md");
const TRAYCER_ROOT = process.env.TRAYCER_ROOT ?? join(homedir(), ".traycer");
const HARNESS_DIRS = [".claude", ".agents", ".codex", ".opencode"];

const name = /^name:\s*(\S+)\s*$/m.exec(readFileSync(SOURCE, "utf8"))?.[1];
if (name === undefined) {
  console.error(`${SOURCE} has no \`name:\` in its frontmatter`);
  process.exit(1);
}

let installed = 0;
for (const harness of HARNESS_DIRS) {
  const root = join(TRAYCER_ROOT, harness, "skills");
  if (!existsSync(root)) {
    console.log(`skip  ${root} (not present)`);
    continue;
  }
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  copyFileSync(SOURCE, join(dir, "SKILL.md"));
  console.log(`ok    ${join(dir, "SKILL.md")}`);
  installed += 1;
}

if (installed === 0) {
  console.error(`\nNo skill roots found under ${TRAYCER_ROOT}. Is Traycer installed for this user?`);
  process.exit(1);
}
console.log(`\nInstalled /${name} into ${installed} root(s). Re-run this after a Traycer host update.`);
