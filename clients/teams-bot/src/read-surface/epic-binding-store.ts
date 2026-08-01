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

/**
 * Falls back to a single configured epic for conversations that have not
 * bound one yet, so a fresh chat can run `fleet` without first typing a
 * UUID. An explicit `set` always wins and is per-conversation as normal.
 *
 * Only used when `TRAYCER_TEAMS_DEFAULT_EPIC_ID` is set. It is a
 * convenience, NOT an identity or authorisation shortcut: the epic is
 * still only ever read AFTER `resolveTenant` has accepted the principal,
 * and the bridge still runs under that tenant's own `HOME`, so a default
 * epic cannot expose another tenant's data — it only saves typing for the
 * one tenant already entitled to it.
 */
export class DefaultingEpicBindingStore implements EpicBindingStore {
  private readonly inner: EpicBindingStore;
  private readonly defaultEpicId: string;

  constructor(inner: EpicBindingStore, defaultEpicId: string) {
    this.inner = inner;
    this.defaultEpicId = defaultEpicId;
  }

  async get(conversationId: string): Promise<string | null> {
    const bound = await this.inner.get(conversationId);
    return bound ?? this.defaultEpicId;
  }

  async set(conversationId: string, epicId: string): Promise<void> {
    await this.inner.set(conversationId, epicId);
  }
}
