#!/usr/bin/env node
// Regenerates every size number in vm.bicep's provisioning comment.
//
// Those numbers are the reason this template uses `runCommands` rather than
// customData or a CustomScript extension, and a size claim in a comment is a
// claim that expires - the previous version of that comment stated the
// extension's ceiling was "far higher" and that the template sat "well inside
// it", and both halves were wrong. This script is how the next reader checks
// rather than inherits.
//
// It measures the payload the way ARM does, not the way a file listing would:
// by evaluating the template's own `provisionScript` expression. `wc -c` over
// the loadTextContent sources undercounts it, because the assembly adds the
// heredoc scaffolding around every one of them.
//
// Exit codes: 0 = fits under the mechanism in use, 1 = over.
//
// Usage: node infra/azure/scripts/measure-provision-payload.mjs

import {
  ARM_EXPRESSION_LIMIT,
  CUSTOM_DATA_LIMIT_BASE64,
  assembleProvisionScript,
  heredocWrites,
  utf8Bytes,
} from "./provision-payload.mjs";

// Representative, not real. The payload depends on these only through their
// LENGTH, and a real hostname or tenant name in a repo file is an OSS-hygiene
// violation in exchange for a number that would not move. Two tenants rather
// than zero because the empty case is the smallest one and would flatter the
// measurement; each additional tenant adds only its id to one env var, so the
// figure is near-flat in tenant count.
const { script } = assembleProvisionScript({
  params: {
    publicHostname: "host.example-region.cloudapp.azure.com",
    acmeContactEmail: "ops@example.com",
    tenantIds: ["tenant-one", "tenant-two"],
    repoSpecs: ["example-owner/example-repo@main"],
  },
});

// ARM's limit counts CHARACTERS; this counts UTF-8 BYTES, which is >= the
// character count and so errs toward refusing a payload ARM would accept, not
// toward accepting one it would refuse. The gap is 2 today (a single U+2713
// in the payload). Stated because the two units differ, and picking whichever
// is smaller is how a limit gets "corrected" into a wrong one.
const raw = utf8Bytes(script);
const chars = script.length;
const base64 = Buffer.from(script, "utf8").toString("base64").length;
const writes = heredocWrites(script);

const rows = [
  [`raw script, UTF-8 bytes (plaintext, what runCommands carries; ${chars} chars)`, raw, ARM_EXPRESSION_LIMIT],
  ["base64 of it (what an extension would carry)", base64, ARM_EXPRESSION_LIMIT],
  ["base64 vs customData's own cap", base64, CUSTOM_DATA_LIMIT_BASE64],
];

for (const [label, value, limit] of rows) {
  const verdict = value <= limit ? "fits" : `OVER by ${value - limit}`;
  console.log(`${String(value).padStart(8)} / ${String(limit).padStart(6)}  ${verdict.padEnd(16)} ${label}`);
}

console.log(`\nheadroom under runCommands: ${ARM_EXPRESSION_LIMIT - raw} chars (${((1 - raw / ARM_EXPRESSION_LIMIT) * 100).toFixed(1)}%)`);
console.log(`files the assembly writes:   ${writes.size}`);

if (raw > ARM_EXPRESSION_LIMIT) {
  console.error(
    `\nmeasure-provision-payload: FAIL - the plaintext script exceeds ARM's ${ARM_EXPRESSION_LIMIT}-character expression limit.\n` +
      `Do NOT try to fix this with concat() of two literals: the limit applies to the expression's RESULT, so a split inside one\n` +
      `property still fails (see vm.bicep's comment, and probe-arm-expression-limit.sh for the two error strings). Split at a phase\n` +
      `boundary into a SECOND Microsoft.Compute/virtualMachines/runCommands resource instead - separate properties, separate budgets.`,
  );
  process.exit(1);
}
console.log("\nmeasure-provision-payload: PASS");
