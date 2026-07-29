/**
 * Teams conversation -> epic binding. Deliberately NOT part of A2's
 * identity registry — an epic is not a property of a tenant (a person
 * participates in many epics; an epic is shared across people), it's
 * per-conversation Teams-side state, and nothing else owns it. See this
 * ticket's escalation exchange for why it doesn't belong in
 * `TenantMapping`.
 *
 * IN-MEMORY ONLY, STATED PLAINLY: this does not survive a process restart.
 * That's an honest gap, not a silent one — a real deployment needs a
 * persisted store (same shape of problem T4's proactive conversation-
 * reference store will need, likely the same mechanism), but building
 * that is not this ticket's read-surface scope. Do not let this
 * implementation quietly become "the" persistence layer by accretion;
 * replace it deliberately when T4 needs a real one.
 */

export interface EpicBindingStore {
  get(conversationId: string): Promise<string | null>;
  set(conversationId: string, epicId: string): Promise<void>;
}

export class InMemoryEpicBindingStore implements EpicBindingStore {
  private readonly bindings = new Map<string, string>();

  async get(conversationId: string): Promise<string | null> {
    return this.bindings.get(conversationId) ?? null;
  }

  async set(conversationId: string, epicId: string): Promise<void> {
    this.bindings.set(conversationId, epicId);
  }
}
