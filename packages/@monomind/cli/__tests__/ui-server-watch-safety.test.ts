/**
 * Dashboard server (src/ui/server.mjs) — watcher error safety.
 *
 * Issue #220: `ENOSPC: System limit for number of file watchers reached`
 * crashed the whole monomind process. Root cause: every fs.watch()/
 * chokidar.watch() call in server.mjs had no 'error' listener. Node's
 * default behavior for an unhandled EventEmitter 'error' event is to
 * throw synchronously — which happens from inside the watcher's internal
 * event handling, asynchronously, so no surrounding try/catch around the
 * initial watch() call can catch it.
 *
 * watchSafely() wraps every watcher with an 'error' listener that logs a
 * warning and closes the watcher instead of letting Node throw.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// @ts-expect-error — .mjs sibling has no type declarations
import * as uiServer from '../src/ui/server.mjs';

const { watchSafely } = uiServer as any;

describe('watchSafely', () => {
  it('does not crash the process when the watcher emits an error', () => {
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = vi.fn();

    watchSafely(watcher, 'test-watcher');

    // Before the fix, this emit() would throw synchronously (Node's default
    // unhandled-'error' behavior) and crash whatever process ran it.
    expect(() => {
      watcher.emit('error', new Error('ENOSPC: System limit for number of file watchers reached'));
    }).not.toThrow();
  });

  it('closes the watcher after an error', () => {
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = vi.fn();

    watchSafely(watcher, 'test-watcher');
    watcher.emit('error', new Error('ENOSPC'));

    expect(watcher.close).toHaveBeenCalledOnce();
  });

  it('survives a watcher whose close() itself throws', () => {
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = vi.fn(() => {
      throw new Error('already closed');
    });

    watchSafely(watcher, 'test-watcher');

    expect(() => {
      watcher.emit('error', new Error('ENOSPC'));
    }).not.toThrow();
  });

  it('returns the same watcher it was given', () => {
    const watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = vi.fn();

    expect(watchSafely(watcher, 'test-watcher')).toBe(watcher);
  });
});
