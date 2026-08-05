import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * `traycer-remote gateway` config shape (M1 contract, "Gateway config"
 * section). Hand-authored JSON for M1 - `traycer-remote init` (M4) writes
 * this file for real. Every field is read from disk at process start;
 * nothing here is a literal baked into source. `5280`/`5281` in the M1
 * contract are documented *defaults* for the operator to put in this file -
 * they never appear as fallback constants in the code itself.
 */
export const gatewayConfigSchema = z.object({
  publicListen: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
  internalListen: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
  devUpstream: z.string().url().nullable(),
  staticDir: z.string().min(1).nullable(),
  authnUpstream: z.string().url(),
  pushUpstream: z.string().url(),
  // R2 + Evaluator security review: null = derive scheme/host from the
  // inbound request's X-Forwarded-Proto / X-Forwarded-Host, but ONLY when
  // the connection is from a trusted local proxy (loopback) - never from an
  // arbitrary direct caller, who could forge those headers. Set explicitly
  // for a BYO setup with no reverse-proxy signal, or to pin the value a
  // direct (non-loopback) caller gets instead of trusting their own Host
  // header.
  publicScheme: z.enum(["ws", "wss"]).nullable(),
  publicHost: z.string().min(1).nullable(),
  legacyLocalAgentId: z.string().uuid(),
  agents: z.record(z.string().uuid(), z.object({ token: z.string().min(1) })),
  heartbeatTimeoutMs: z.number().int().positive(),
  dialTimeoutMs: z.number().int().positive().optional(),
});
export type GatewayConfig = z.infer<typeof gatewayConfigSchema>;

const DEFAULT_DIAL_TIMEOUT_MS = 5_000;

export function dialTimeoutMs(config: GatewayConfig): number {
  return config.dialTimeoutMs ?? DEFAULT_DIAL_TIMEOUT_MS;
}

export async function loadGatewayConfig(path: string): Promise<GatewayConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = gatewayConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `traycer-remote: invalid gateway config at ${path}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
