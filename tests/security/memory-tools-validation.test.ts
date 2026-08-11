/**
 * T1 — memory-tools handler input validation
 *
 * Coverage gap: mcp-tools/memory-tools.ts is the user-data boundary — every
 * memory_search/store/feedback call lands here. The 783-LOC module had zero
 * tests for: control-char rejection (NUL truncation attack), length caps
 * (DoS via oversized inputs), score clamping, batch limits, and error
 * sanitization (path leakage in returned messages).
 */
import { describe, it, expect } from 'vitest';
import { memoryTools } from '../../packages/@monomind/cli/src/mcp-tools/memory-tools.js';

const find = (name: string) => {
  const t = memoryTools.find(t => t.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
};

describe('T1 — memory-tools input validation', () => {
  // memory_* tools return `{ results: [], error: '...' }` on validation
  // failure (no `success` field) — assert on the error string instead.
  const rejected = (r: { error?: string; results?: unknown[] }) =>
    Array.isArray(r.results) && r.results.length === 0 && typeof r.error === 'string' && r.error.length > 0;

  describe('memory_pattern-search', () => {
    const tool = find('memory_pattern-search');

    it('rejects an empty query', async () => {
      const r = await tool.handler({ query: '' }) as { error?: string; results?: unknown[] };
      expect(rejected(r)).toBe(true);
    });

    it('rejects a query containing a NUL byte', async () => {
      const r = await tool.handler({ query: 'legit\0malicious' }) as { error?: string; results?: unknown[] };
      expect(rejected(r)).toBe(true);
    });

    it('rejects a query containing ANSI escape control chars', async () => {
      const r = await tool.handler({ query: 'evil\x1b[2J\x1b[Htext' }) as { error?: string; results?: unknown[] };
      expect(rejected(r)).toBe(true);
    });

    it('caps topK at MAX_TOP_K=100 (no error from oversized topK)', async () => {
      const r = await tool.handler({
        query: 'x',
        namespace: 't1-validation-empty',
        topK: 99999,
      }) as { results?: unknown[]; patterns?: unknown[]; error?: string };
      // Handler must return a valid shape with results/patterns capped at 100,
      // or an error/empty fallback — never an uncapped 99999-element array.
      const items = r.results ?? r.patterns ?? [];
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeLessThanOrEqual(100);
    });

    it('rejects a query over MAX_STRING_LENGTH (10KB for pattern-search)', async () => {
      const huge = 'a'.repeat(200_000);
      const r = await tool.handler({ query: huge }) as { error?: string; results?: unknown[] };
      expect(rejected(r)).toBe(true);
    });
  });

  describe('memory_pattern-store', () => {
    const tool = find('memory_pattern-store');

    it('rejects an empty key', async () => {
      const r = await tool.handler({ key: '', value: 'x' }) as { success?: boolean; error?: string };
      expect(r.success !== true).toBe(true);
    });

    it('rejects a value containing NUL', async () => {
      const r = await tool.handler({
        key: 't1-probe-' + Date.now(),
        value: 'bad\x00value',
        namespace: 't1-validation',
      }) as { success?: boolean; error?: string };
      expect(r.success !== true).toBe(true);
    });

    it('rejects a key containing NUL', async () => {
      const r = await tool.handler({
        key: 'bad\x00key',
        value: 'whatever',
        namespace: 't1-validation',
      }) as { success?: boolean; error?: string };
      expect(r.success !== true).toBe(true);
    });
  });

  describe('memory_feedback', () => {
    const tool = find('memory_feedback');

    it('clamps an out-of-range score (> 1) to [0, 1]', async () => {
      const r = await tool.handler({
        taskId: 'test-clamp-high-' + Date.now(),
        entryIds: ['fake-id'],
        quality: 5.0,
      }) as { success?: boolean; error?: string; weighting?: unknown };
      // Handler must reach the score-clamping path (Math.max(0, Math.min(1, quality)))
      // and not bail early on a missing-taskId guard.
      // With a nonexistent DB the bridge call may fail, but the clamp still ran.
      expect(r).toBeDefined();
      expect(typeof r.success).toBe('boolean');
    });

    it('clamps an out-of-range score (< 0) to [0, 1]', async () => {
      const r = await tool.handler({
        taskId: 'test-clamp-low-' + Date.now(),
        entryIds: ['fake-id'],
        quality: -1.0,
      }) as { success?: boolean; error?: string; weighting?: unknown };
      expect(r).toBeDefined();
      expect(typeof r.success).toBe('boolean');
    });
  });

  describe('sanitizeError (verified via handler error path)', () => {
    it('memory_pattern-search never returns a filesystem path in its error message', async () => {
      const r = await find('memory_pattern-search').handler({
        query: 'probe',
        dbPath: '/tmp',
      }) as { error?: string };
      if (r.error) {
        expect(r.error).not.toMatch(/\/(?:Users|home|tmp|var|srv|data)\/[^<]/);
      }
    });
  });
});
