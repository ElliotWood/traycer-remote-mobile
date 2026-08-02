import { readJsonFileOrNull, writeJsonFileAtomic } from "./storage/fs-atomic";
import { pushedStatePath } from "./storage/paths";

/**
 * The narrow surface `ActionableDetector` depends on — separated from the
 * concrete class so a test fake can satisfy it structurally (a class with
 * private fields is otherwise only assignable from itself/subclasses).
 */
export interface PushedStateReader {
  get(id: string): boolean | undefined;
  set(id: string, wasActionable: boolean): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * Persisted edge-trigger dedup state for the actionable-entry detector
 * (`actionable-detector.ts`): `id -> wasActionable`. Persisted (not just
 * in-memory) so a push-service process restart doesn't re-arm already-pushed
 * ids as fresh — see the contract's "Actionable-entry detection" section.
 */
export class PushedStateStore implements PushedStateReader {
  private readonly path: string;
  private state: Record<string, boolean> = {};
  private loaded = false;

  /** Callers pass `pushedStatePath()` for the real `~/.traycer/push-service/pushed-state.json`; tests inject a temp path so they never touch real runtime state. */
  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    const stored = await readJsonFileOrNull<Record<string, boolean>>(this.path);
    this.state = stored !== null && typeof stored === "object" ? stored : {};
    this.loaded = true;
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error("PushedStateStore.load() must be awaited before use");
    }
  }

  /** `undefined` means "never observed" — distinct from `false` (seen, not actionable). */
  get(id: string): boolean | undefined {
    this.assertLoaded();
    return this.state[id];
  }

  async set(id: string, wasActionable: boolean): Promise<void> {
    this.assertLoaded();
    this.state = { ...this.state, [id]: wasActionable };
    await this.persist();
  }

  /** Drops the id entirely (on `removed`/`cleared`) so a later, genuinely new occurrence of the same id starts fresh. */
  async delete(id: string): Promise<void> {
    this.assertLoaded();
    if (!(id in this.state)) return;
    const { [id]: _removed, ...rest } = this.state;
    this.state = rest;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeJsonFileAtomic(this.path, this.state);
  }
}
