// Re-runs vm.bicep's OWN payload assembly, outside Azure, and reports what
// that assembly says should exist on the VM.
//
// WHY IT RE-RUNS THE ASSEMBLY RATHER THAN LISTING THE FILES. The obvious
// version of the parity check is a list: "these 24 paths should exist with
// these contents." That check tests the list. It passes forever after someone
// adds a file to vm.bicep and forgets the list, which is the same
// "committed, looks done, silently absent" gap the deploy path itself keeps
// producing - relocated into the checker.
//
// So nothing here knows the name of a single deployed file. It compiles
// vm.bicep, evaluates the `provisionScript` template expression exactly as
// ARM would, and then reads the heredocs out of the resulting script. Add a
// file to vm.bicep and it appears here with no edit; remove one and it
// disappears. The expected side cannot drift from the template because it IS
// the template, evaluated.
//
// It also never reads anything the VM wrote, and the VM-side collector never
// reads anything this produced. Neither side can launder the other's mistake
// into agreement - see verify-iac-parity.sh.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** ARM refuses any template expression whose evaluated result exceeds this. */
export const ARM_EXPRESSION_LIMIT = 131072;

/** `osProfile.customData`'s cap, in base64 characters (65,535 raw bytes). */
export const CUSTOM_DATA_LIMIT_BASE64 = 87380;

/**
 * Minimal evaluator for the ARM expression subset vm.bicep compiles to.
 *
 * Deliberately NOT a general ARM interpreter: it supports exactly the
 * functions this template's payload assembly uses, and THROWS on anything
 * else. A permissive evaluator that silently returned "" for an unsupported
 * function would make the expected side quietly wrong in the one direction
 * nobody checks - shorter than reality, so a missing file reads as agreement.
 */
function evaluate(expr, template, params, seen = new Set()) {
  if (typeof expr !== "string") throw new Error(`not a string expression: ${JSON.stringify(expr)}`);
  if (!expr.startsWith("[") || !expr.endsWith("]")) return expr; // plain literal
  return evalCall(expr.slice(1, -1).trim(), template, params, seen);
}

function evalCall(src, template, params, seen) {
  const open = src.indexOf("(");
  if (open === -1) throw new Error(`unsupported expression (no call): ${src.slice(0, 80)}`);
  const fn = src.slice(0, open).trim();
  if (!src.endsWith(")")) throw new Error(`unsupported expression (unterminated): ${src.slice(0, 80)}`);
  const args = splitArgs(src.slice(open + 1, -1));

  switch (fn) {
    case "variables": {
      const name = literal(args[0]);
      if (seen.has(name)) throw new Error(`variable cycle at ${name}`);
      const raw = template.variables?.[name];
      if (raw === undefined) throw new Error(`no such variable: ${name}`);
      return evaluate(raw, template, params, new Set([...seen, name]));
    }
    case "parameters": {
      const name = literal(args[0]);
      if (name in params) return params[name];
      const def = template.parameters?.[name]?.defaultValue;
      if (def === undefined) {
        throw new Error(
          `parameter '${name}' has no default and no value was supplied - pass it in params`,
        );
      }
      return typeof def === "string" ? evaluate(def, template, params, seen) : def;
    }
    case "format": {
      const fmt = literal(args[0]);
      const rest = args.slice(1).map((a) => evalArg(a, template, params, seen));
      return fmt.replace(/\{(\d+)\}/g, (_m, i) => String(rest[Number(i)]));
    }
    case "concat":
      return args.map((a) => evalArg(a, template, params, seen)).join("");
    case "join": {
      const list = evalArg(args[0], template, params, seen);
      return list.join(evalArg(args[1], template, params, seen));
    }
    case "base64":
      return Buffer.from(evalArg(args[0], template, params, seen), "utf8").toString("base64");
    case "toLower":
      return String(evalArg(args[0], template, params, seen)).toLowerCase();
    default:
      throw new Error(`unsupported ARM function in the payload path: ${fn}()`);
  }
}

function evalArg(arg, template, params, seen) {
  const t = arg.trim();
  if (t.startsWith("'")) return literal(t);
  return evalCall(t, template, params, seen);
}

/** Unquotes an ARM single-quoted literal, undoubling its `''` escapes. */
function literal(arg) {
  const t = arg.trim();
  if (!t.startsWith("'") || !t.endsWith("'")) throw new Error(`not a literal: ${t.slice(0, 60)}`);
  return t.slice(1, -1).replace(/''/g, "'");
}

/** Splits a call's arguments on top-level commas, respecting quotes and nesting. */
function splitArgs(src) {
  const out = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuote) {
      if (c === "'") {
        if (src[i + 1] === "'") i++;
        else inQuote = false;
      }
      continue;
    }
    if (c === "'") inQuote = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  const tail = src.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/**
 * Compiles vm.bicep and returns the provisioning script ARM would produce.
 *
 * `params` supplies deploy-time parameter values. Anything omitted falls back
 * to the template's own default, and a parameter with neither throws rather
 * than defaulting to empty - an empty hostname would silently change the
 * assembled script and make every downstream hash disagree for a reason
 * nobody would look for.
 */
export function assembleProvisionScript({ repoRoot, params = {} } = {}) {
  // infra/azure/scripts -> repo root.
  const root = repoRoot ?? join(import.meta.dirname, "..", "..", "..");
  const bicep = join(root, "infra", "azure", "bicep", "modules", "vm.bicep");
  const dir = mkdtempSync(join(tmpdir(), "traycer-parity-"));
  const out = join(dir, "vm.json");
  try {
    // `az bicep build --stdout` is unusable on Windows: the CLI encodes its
    // stdout as cp1252 and this payload contains a U+2713, so it dies with a
    // UnicodeEncodeError that looks like a template error and is not one.
    // --outfile writes UTF-8 and sidesteps it entirely.
    execFileSync("az", ["bicep", "build", "--file", bicep, "--outfile", out], {
      stdio: ["ignore", "ignore", "pipe"],
      shell: process.platform === "win32",
    });
    const template = JSON.parse(readFileSync(out, "utf8"));
    const script = evaluate(template.variables.provisionScript, template, params);
    return { script, template };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Reads the (path, content) pairs a shell script writes via quoted heredocs.
 *
 * Nested heredocs are handled by construction: once a `cat > PATH <<'MARKER'`
 * opens, every following line is content until a line that is exactly MARKER,
 * so a heredoc appearing INSIDE another heredoc's body is skipped rather than
 * mistaken for a write. That matters here because bootstrap.sh is appended
 * into this script raw, and several of the payload scripts write files of
 * their own.
 *
 * Only single-quoted markers are recognised. An unquoted heredoc interpolates
 * at write time, so its on-disk content is not knowable from the script text
 * - recognising one would produce a confidently wrong expectation. There are
 * none today; `strictUnquoted` makes a future one an error rather than a
 * silent omission.
 */
export function heredocWrites(script, { strictUnquoted = true } = {}) {
  const lines = script.split("\n");
  const writes = new Map();
  const open = /^\s*cat\s+>\s*(\S+)\s*<<\s*'([A-Za-z0-9_]+)'\s*$/;
  const openUnquoted = /^\s*cat\s+>\s*(\S+)\s*<<\s*([A-Za-z0-9_]+)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const m = open.exec(lines[i]);
    if (!m) {
      if (strictUnquoted && openUnquoted.test(lines[i]) && !open.test(lines[i])) {
        throw new Error(
          `line ${i + 1}: unquoted heredoc - its content is interpolated at write time, so it cannot be derived from the script text: ${lines[i].trim()}`,
        );
      }
      continue;
    }
    const [, path, marker] = m;
    const body = [];
    let j = i + 1;
    for (; j < lines.length && lines[j] !== marker; j++) body.push(lines[j]);
    if (j === lines.length) throw new Error(`unterminated heredoc '${marker}' opened at line ${i + 1}`);
    // The trailing newline `cat` writes: a heredoc body always ends with one.
    writes.set(path, `${body.join("\n")}\n`);
    i = j;
  }
  return writes;
}

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** Byte length of a UTF-8 string - `.length` counts UTF-16 units and would undercount the U+2713 in this payload. */
export const utf8Bytes = (text) => Buffer.byteLength(text, "utf8");
