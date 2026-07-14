import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queueMessage, drainInbox, inboxCount } from '../../src/orgrt/inbox.js';
import { ORG_DIR } from '../../src/orgrt/types.js';

describe('orgrt inbox', () => {
  it('queueMessage creates the inbox file and appends messages', () => {
    const root = mkdtempSync(join(tmpdir(), 'inbox-'));
    try {
      queueMessage(root, 'myorg', { fromQualified: 'a:boss', toRole: 'dev', subject: 'hello', body: 'world', ts: 1 });
      queueMessage(root, 'myorg', { fromQualified: 'b:lead', toRole: 'dev', subject: 'hi', body: 'again', ts: 2 });

      const path = join(root, ORG_DIR, 'myorg', 'inbox.jsonl');
      expect(existsSync(path)).toBe(true);
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).subject).toBe('hello');
      expect(JSON.parse(lines[1]).subject).toBe('hi');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('drainInbox returns all queued messages and truncates the file', () => {
    const root = mkdtempSync(join(tmpdir(), 'inbox-'));
    try {
      queueMessage(root, 'org1', { fromQualified: 'x:y', toRole: 'z', subject: 's1', body: 'b1', ts: 1 });
      queueMessage(root, 'org1', { fromQualified: 'x:y', toRole: 'z', subject: 's2', body: 'b2', ts: 2 });

      const msgs = drainInbox(root, 'org1');
      expect(msgs).toHaveLength(2);
      expect(msgs[0].subject).toBe('s1');
      expect(msgs[1].subject).toBe('s2');

      // File should be empty after drain
      const second = drainInbox(root, 'org1');
      expect(second).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('drainInbox returns empty array when no inbox exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'inbox-'));
    try {
      expect(drainInbox(root, 'nonexistent')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('inboxCount returns the number of queued messages', () => {
    const root = mkdtempSync(join(tmpdir(), 'inbox-'));
    try {
      expect(inboxCount(root, 'org2')).toBe(0);
      queueMessage(root, 'org2', { fromQualified: 'a:b', toRole: 'c', subject: 's', body: '', ts: 1 });
      expect(inboxCount(root, 'org2')).toBe(1);
      queueMessage(root, 'org2', { fromQualified: 'a:b', toRole: 'c', subject: 's', body: '', ts: 2 });
      expect(inboxCount(root, 'org2')).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('drainInbox skips corrupt lines gracefully', () => {
    const root = mkdtempSync(join(tmpdir(), 'inbox-'));
    try {
      const dir = join(root, ORG_DIR, 'corrupt');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'inbox.jsonl'), '{"fromQualified":"a:b","toRole":"c","subject":"ok","body":"","ts":1}\nBAD JSON\n');

      const msgs = drainInbox(root, 'corrupt');
      expect(msgs).toHaveLength(1);
      expect(msgs[0].subject).toBe('ok');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
