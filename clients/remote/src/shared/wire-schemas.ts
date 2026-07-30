import { z } from "zod";

/**
 * Agent -> gateway internal registration wire shapes. Pinned (M1 contract,
 * B-open-item-1): agent and gateway are separate processes that ship and
 * restart independently, so an unpinned shape is exactly where version skew
 * hides. Deliberately minimal - not a versioned protocol, just pinned enough
 * that a shape drift fails loudly (400) instead of silently.
 */
export const agentRegisterRequestSchema = z.object({
  agentId: z.string().uuid(),
  hostId: z.string().min(1),
  label: z.string().min(1),
  version: z.string().min(1),
  reachableUrl: z.string().url(),
});
export type AgentRegisterRequest = z.infer<typeof agentRegisterRequestSchema>;

// Heartbeat re-sends the full current state each beat - idempotent, same shape
// as register.
export const agentHeartbeatRequestSchema = agentRegisterRequestSchema;
export type AgentHeartbeatRequest = z.infer<typeof agentHeartbeatRequestSchema>;

export const agentUnregisterRequestSchema = z.object({
  agentId: z.string().uuid(),
});
export type AgentUnregisterRequest = z.infer<
  typeof agentUnregisterRequestSchema
>;

/** Error body shape for both the internal listener and the public proxy routes. */
export const wireErrorBodySchema = z.object({
  error: z.string(),
  hostId: z.string().optional(),
});
export type WireErrorBody = z.infer<typeof wireErrorBodySchema>;
