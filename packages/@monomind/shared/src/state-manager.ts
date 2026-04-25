/**
 * StateManager — thread-safe (per-key lock via promise chaining) state manager
 * that applies registered reducers on every write.
 */

import { REDUCERS } from './reducers.js';
import type { SwarmState } from './swarm-state.js';
import { createDefaultSwarmState } from './swarm-state.js';

export class StateManager {
  private state: SwarmState;
  /** Per-key promise chain used as a cooperative lock. */
  private locks: Map<string, Promise<void>> = new Map();

  constructor(initial?: Partial<SwarmState>) {
    const defaults = createDefaultSwarmState();
    if (initial) {
      for (const k of Object.keys(initial) as Array<keyof SwarmState>) {
        if (initial[k] !== undefined) {
          (defaults as Record<string, unknown>)[k] = initial[k];
        }
      }
    }
    this.state = defaults;
  }

  /**
   * Write a value to a state field. The registered reducer merges the
   * incoming value with the current value. Writes to the same key are
   * serialised via promise chaining so no data is lost under concurrency.
   */
  async write(
    key: keyof SwarmState,
    value: unknown,
    _agentId: string,
  ): Promise<void> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(() => {
      const field = this.state[key];
      const reducerFn = REDUCERS[field.reducer];
      if (!reducerFn) {
        throw new Error(`No reducer registered for "${field.reducer}"`);
      }
      (field as { value: unknown }).value = reducerFn(field.value, value);
    });
    this.locks.set(key, next);
    await next;
  }

  /**
   * Read the current value of a state field.
   */
  read<K extends keyof SwarmState>(key: K): SwarmState[K]['value'] {
    return this.state[key].value;
  }

  /**
   * Batch-merge multiple writes. Each write is applied sequentially per key.
   */
  async mergeLevel(
    writes: Array<{ key: keyof SwarmState; value: unknown; agentId: string }>,
  ): Promise<void> {
    await Promise.all(
      writes.map((w) => this.write(w.key, w.value, w.agentId)),
    );
  }

  /**
   * Return a deep-frozen snapshot of the entire state.
   */
  snapshot(): Readonly<SwarmState> {
    return deepFreeze(structuredClone(this.state)) as Readonly<SwarmState>;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const val of Object.values(obj as Record<string, unknown>)) {
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}
