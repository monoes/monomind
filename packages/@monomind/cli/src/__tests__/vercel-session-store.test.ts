/**
 * Unit tests for VercelSessionStore — the disk-persisted conversation history
 * that backs VercelAgentRunner's resume capability.
 *
 * Pure filesystem code (no dynamic imports to mock), so this is the one piece
 * of the Vercel runner's critical-fix-#1 (session resume) that we can test
 * directly without mocking the `ai` package.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VercelSessionStore } from '../orgrt/vercel-session-store.js';

describe('VercelSessionStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monomind-session-store-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('mints a stable sessionId when none provided', () => {
    const store = new VercelSessionStore(dir, 'worker');
    expect(store.sessionId).toMatch(/^worker-[0-9a-f-]{36}$/);
  });

  it('reuses provided sessionId (resume path)', () => {
    const store = new VercelSessionStore(dir, 'worker', 'existing-session-id');
    expect(store.sessionId).toBe('existing-session-id');
  });

  it('save → load round-trips messages', async () => {
    const store = new VercelSessionStore(dir, 'worker', 'rt-session');
    const messages = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi there' },
    ];
    await store.save(messages);

    // New store instance, same sessionId — simulates resume after restart.
    const restored = new VercelSessionStore(dir, 'worker', 'rt-session');
    const loaded = await restored.load();
    expect(loaded).toEqual(messages);
  });

  it('load returns [] when no file exists (cold start)', async () => {
    const store = new VercelSessionStore(dir, 'worker', 'never-saved');
    expect(await store.load()).toEqual([]);
  });

  it('trims to MAX_MESSAGES (200), preserving system messages', async () => {
    const store = new VercelSessionStore(dir, 'worker', 'trim-session');
    // 5 system + 250 user/assistant pairs → 505 messages total
    const messages = [
      ...Array.from({ length: 5 }, (_, i) => ({ role: 'system' as const, content: `sys-${i}` })),
      ...Array.from({ length: 250 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `msg-${i}`,
      })),
    ];
    await store.save(messages);

    const restored = new VercelSessionStore(dir, 'worker', 'trim-session');
    const loaded = await restored.load();

    // Expect: 5 system messages preserved + last (200-1)=199 non-system = 204 total.
    // The trim budget for non-system is MAX_MESSAGES - 1 (room reserved for one system).
    // All 5 system messages are kept verbatim; only non-system is capped.
    const systemCount = loaded.filter((m) => m.role === 'system').length;
    const nonSystemCount = loaded.filter((m) => m.role !== 'system').length;
    expect(systemCount).toBe(5);
    expect(nonSystemCount).toBeLessThanOrEqual(199);
    expect(loaded.length).toBeLessThanOrEqual(messages.length);

    // The LAST non-system message should be preserved (most recent turn).
    const lastNonSystem = loaded.filter((m) => m.role !== 'system').pop();
    expect(lastNonSystem?.content).toBe('msg-249');
  });

  it('does not trim when under the cap', async () => {
    const store = new VercelSessionStore(dir, 'worker', 'small');
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m-${i}`,
    }));
    await store.save(messages);

    const restored = new VercelSessionStore(dir, 'worker', 'small');
    const loaded = await restored.load();
    expect(loaded).toHaveLength(10);
  });

  it('overwrites file on re-save (no duplication)', async () => {
    const store = new VercelSessionStore(dir, 'worker', 'ow-session');
    await store.save([{ role: 'user', content: 'first' }]);
    await store.save([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ]);

    const restored = new VercelSessionStore(dir, 'worker', 'ow-session');
    const loaded = await restored.load();
    expect(loaded).toHaveLength(3);
    expect(loaded[2].content).toBe('second');
  });

  it('sessionId is deterministic per role (filename-based)', async () => {
    // Two stores with the same role + same UUID resume the same file.
    const id = 'fixed-uuid';
    const s1 = new VercelSessionStore(dir, 'worker', id);
    await s1.save([{ role: 'user', content: 'from-s1' }]);
    const s2 = new VercelSessionStore(dir, 'worker', id);
    expect(s2.sessionId).toBe(s1.sessionId);
    const loaded = await s2.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe('from-s1');
  });
});
