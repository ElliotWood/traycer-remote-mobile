import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * `remote-agent` config shape (M1 contract, "Agent config" section).
 * Hand-authored JSON for M1 - `traycer-remote init` (M4) writes this file
 * for real. Every field is read from disk at process start; nothing here is
 * a literal baked into source.
 */
export const agentConfigSchema = z.object({
  agentId: z.string().uuid(),
  token: z.string().min(1),
  label: z.string().min(1),
  gatewayRegistrationUrl: z.string().url(),
  tunnelListen: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
  reachableUrl: z.string().url(),
  traycerEnvironment: z.enum(["production", "dev"]),
  traycerDevSlot: z.string().min(1).optional(),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export async function loadAgentConfig(path: string): Promise<AgentConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = agentConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `traycer-remote: invalid agent config at ${path}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
