/**
 * Shared bridge base.
 *
 * Owns the load → guard → mock-fallback → status state machine once, so every
 * bridge built on it behaves identically on the same failure modes: an absent
 * OR wrong-shaped native module both fall back to a mock and end in `ready`
 * (never `error`). Only a genuinely thrown error surfaces as `error`.
 *
 * Subclasses provide: name/version, specifier(), validateShape(), createMock(),
 * and optionally adoptModule() for post-load setup (e.g. constructing an index).
 */

import type { WasmBridge, WasmModuleStatus } from '../types.js';
import { isNativeDisabled } from '../types.js';

export abstract class BaseBridge<T> implements WasmBridge<T> {
  abstract readonly name: string;
  abstract readonly version: string;

  protected _status: WasmModuleStatus = 'unloaded';
  protected _module: T | null = null;

  /** npm specifier to dynamically import */
  protected abstract specifier(): string;
  /** True if the imported module has the expected shape */
  protected abstract validateShape(mod: unknown): boolean;
  /** Build the mock fallback module */
  protected abstract createMock(): T;
  /**
   * Optional: called after _module is set (real or mock) so subclasses can do
   * post-load setup. `mod` is the raw imported module when a real one loaded &
   * validated, or null when the mock was used.
   */
  protected adoptModule(_mod: unknown): void {}

  get status(): WasmModuleStatus {
    return this._status;
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  getModule(): T | null {
    return this._module;
  }

  async init(): Promise<void> {
    if (this._status === 'ready' || this._status === 'loading' || this._status === 'error') return;

    // Native kill-switch — force pure-JS mock, skip the native load.
    if (isNativeDisabled()) {
      this._module = this.createMock();
      this.adoptModule(null);
      this._status = 'ready';
      return;
    }

    this._status = 'loading';
    try {
      const mod = await import(this.specifier()).catch(() => null);
      if (mod && this.validateShape(mod)) {
        this._module = mod as T;
        this.adoptModule(mod);
      } else {
        // Consistent behavior: wrong-shape OR absent → mock + ready (never 'error')
        this._module = this.createMock();
        this.adoptModule(null);
      }
      this._status = 'ready';
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this._module = null;
    this._status = 'unloaded';
  }
}
