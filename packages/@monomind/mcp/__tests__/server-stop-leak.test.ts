/**
 * PKG-1 regression test — `MCPServer.stop()` used to call
 * `sessionManager.clearAll()` and never `sessionManager.destroy()`, leaving
 * the SessionManager's `setInterval(..., 60_000)` cleanup timer firing
 * forever after stop. This test fails on the pre-fix code path and passes
 * once stop() routes through destroy().
 */

import { describe, it, expect, vi } from 'vitest';
import { createMCPServer } from '../src/index.js';
import type { ILogger } from '../src/types.js';

const createMockLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('PKG-1 — server.stop() tears down SessionManager cleanup interval', () => {
  it('every setInterval started during the server lifetime is cleared by stop()', async () => {
    // Wrap setInterval/clearInterval so we can prove the cleanup timer is
    // actually detached. The pre-fix code path left one interval live.
    const liveIntervals = new Set<unknown>();
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;

    globalThis.setInterval = ((fn: (...args: unknown[]) => void, ms?: number) => {
      const handle = originalSetInterval(fn, ms);
      liveIntervals.add(handle);
      return handle;
    }) as typeof setInterval;
    globalThis.clearInterval = ((handle: unknown) => {
      liveIntervals.delete(handle);
      return originalClearInterval(handle as NodeJS.Timeout);
    }) as typeof clearInterval;

    try {
      const server = createMCPServer(
        { name: 'Stop Leak Test', transport: 'in-process' },
        createMockLogger(),
      );
      await server.start();

      // Sanity check: at least the SessionManager cleanup interval is live.
      expect(liveIntervals.size).toBeGreaterThan(0);

      await server.stop();

      // After stop(), every interval created during the server's lifetime
      // — including the SessionManager cleanup timer — must be cleared.
      // Pre-fix this was 1 (the leaked cleanup timer); post-fix it is 0.
      expect(liveIntervals.size).toBe(0);
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});
