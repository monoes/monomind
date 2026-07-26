// packages/@monomind/cli/__tests__/orgrt/inbox-drain-window.test.ts
//
// Regression (c): drainInbox used to empty its snapshot file and rename it back over
// inbox.jsonl. A sender that queued between the snapshot rename and that rename-back had
// already been told "queued" — and its message was silently destroyed.
//
// The window is internal to a synchronous function, so it is opened deterministically by
// wrapping node:fs's readFileSync (the last thing drainInbox does to the snapshot) and
// queueing from inside it. Own file because the module mock is file-scoped.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hook = vi.hoisted(() => ({ onDrainingRead: null as null | (() => void) }));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const readFileSync = (p: any, ...rest: any[]) => {
    const out = (actual.readFileSync as any)(p, ...rest);
    if (typeof p === 'string' && p.endsWith('.draining') && hook.onDrainingRead) {
      const fn = hook.onDrainingRead;
      hook.onDrainingRead = null;
      fn();
    }
    return out;
  };
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

const { queueMessage, drainInbox } = await import('../../src/orgrt/inbox.js');
const { ORG_DIR } = await import('../../src/orgrt/types.js');

describe('drainInbox — mid-drain queueing', () => {
  it('does not destroy a message queued after the snapshot was taken', () => {
    const root = mkdtempSync(join(tmpdir(), 'drain-window-'));
    try {
      queueMessage(root, 'org1', { fromQualified: 'a:b', toRole: 'z', subject: 'before', body: '', ts: 1 });
      const path = join(root, ORG_DIR, 'org1', 'inbox.jsonl');

      hook.onDrainingRead = () => {
        // sender gets a "queued" receipt here
        queueMessage(root, 'org1', { fromQualified: 'a:b', toRole: 'z', subject: 'MIDDRAIN', body: '', ts: 2 });
      };
      const first = drainInbox(root, 'org1');
      expect(hook.onDrainingRead).toBeNull(); // the window really was hit
      expect(first.map(m => m.subject)).toEqual(['before']);

      // Pre-fix: `path` had been clobbered by the emptied snapshot and MIDDRAIN was gone.
      expect(existsSync(path)).toBe(true);
      const second = drainInbox(root, 'org1');
      expect(second.map(m => m.subject)).toEqual(['MIDDRAIN']);
      expect(drainInbox(root, 'org1')).toEqual([]);
    } finally {
      hook.onDrainingRead = null;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
