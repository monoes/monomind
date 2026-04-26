/**
 * Tests for Agent Definition Versioning + Rollback (Task 29).
 *
 * Uses vitest globals (describe, it, expect, beforeEach, afterEach, vi).
 * Run: npx vitest run tests/agents/version-store.test.ts --globals
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentVersionStore } from '../../packages/@monomind/cli/src/agents/version-store.js';
import type { AgentVersionRecord } from '../../packages/@monomind/shared/src/types/agent-version.js';
import { computeUnifiedDiff } from '../../packages/@monomind/cli/src/agents/version-diff.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-ver-'));
}

describe('AgentVersionStore', () => {
  let dir: string;
  let store: AgentVersionStore;

  beforeEach(() => {
    dir = makeTmpDir();
    store = new AgentVersionStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saveVersion stores record with correct SHA-256 hash', () => {
    const content = 'You are a coder agent.';
    const expectedHash = createHash('sha256').update(content).digest('hex');

    const record = store.saveVersion('coder', content, '1.0.0', 'Initial version');

    expect(record.slug).toBe('coder');
    expect(record.version).toBe('1.0.0');
    expect(record.contentHash).toBe(expectedHash);
    expect(record.content).toBe(content);
    expect(record.isCurrent).toBe(true);
    expect(record.id).toBeTruthy();
    expect(record.capturedAt).toBeInstanceOf(Date);
  });

  it('saveVersion marks previous version as non-current', () => {
    store.saveVersion('coder', 'v1 content', '1.0.0', 'First');
    store.saveVersion('coder', 'v2 content', '2.0.0', 'Second');

    const versions = store.listVersions('coder');
    const v1 = versions.find((v) => v.version === '1.0.0')!;
    const v2 = versions.find((v) => v.version === '2.0.0')!;

    expect(v1.isCurrent).toBe(false);
    expect(v2.isCurrent).toBe(true);
  });

  it('listVersions returns sorted by capturedAt DESC', () => {
    store.saveVersion('coder', 'v1', '1.0.0', 'First');
    store.saveVersion('coder', 'v2', '2.0.0', 'Second');
    store.saveVersion('coder', 'v1', '3.0.0', 'Third');

    const versions = store.listVersions('coder');

    expect(versions).toHaveLength(3);
    expect(versions[0].version).toBe('3.0.0');
    expect(versions[1].version).toBe('2.0.0');
    expect(versions[2].version).toBe('1.0.0');
  });

  it('getCurrent returns latest current version', () => {
    store.saveVersion('coder', 'v1', '1.0.0', 'First');
    store.saveVersion('coder', 'v2', '2.0.0', 'Second');

    const current = store.getCurrent('coder');

    expect(current).not.toBeNull();
    expect(current!.version).toBe('2.0.0');
    expect(current!.isCurrent).toBe(true);
  });

  it('getCurrent returns null for unknown slug', () => {
    const current = store.getCurrent('nonexistent');
    expect(current).toBeNull();
  });

  it('rollback restores correct version as current', () => {
    store.saveVersion('coder', 'v1', '1.0.0', 'First');
    store.saveVersion('coder', 'v2', '2.0.0', 'Second');
    store.saveVersion('coder', 'v1', '3.0.0', 'Third');

    const restored = store.rollback('coder', '1.0.0');

    expect(restored.version).toBe('1.0.0');
    expect(restored.isCurrent).toBe(true);

    // Verify via getCurrent
    const current = store.getCurrent('coder');
    expect(current!.version).toBe('1.0.0');

    // Verify others are non-current
    const versions = store.listVersions('coder');
    for (const v of versions) {
      if (v.version !== '1.0.0') {
        expect(v.isCurrent).toBe(false);
      }
    }
  });

  it('rollback throws for unknown version', () => {
    store.saveVersion('coder', 'v1', '1.0.0', 'First');

    expect(() => store.rollback('coder', '9.9.9')).toThrow(
      'Version "9.9.9" not found for agent "coder"',
    );
  });

  it('diff counts additions and deletions', () => {
    store.saveVersion('coder', 'line1\nline2\nline3', '1.0.0', 'First');
    store.saveVersion('coder', 'line1\nchanged\nline3\nline4', '2.0.0', 'Second');

    const result = store.diff('coder', '1.0.0', '2.0.0');

    expect(result.slug).toBe('coder');
    expect(result.fromVersion).toBe('1.0.0');
    expect(result.toVersion).toBe('2.0.0');
    expect(result.additions).toBeGreaterThan(0);
    expect(result.deletions).toBeGreaterThan(0);
    expect(result.hunks).toContain('+');
    expect(result.hunks).toContain('-');
  });

  it('saveVersion with deprecated=true stores correctly', () => {
    const record = store.saveVersion('coder', 'old content', '1.0.0', 'Deprecated', {
      deprecated: true,
      deprecatedBy: '2.0.0',
      capturedBy: 'admin',
    });

    expect(record.deprecated).toBe(true);
    expect(record.deprecatedBy).toBe('2.0.0');
    expect(record.capturedBy).toBe('admin');
  });

  it('multiple versions for same slug all stored', () => {
    store.saveVersion('coder', 'v1', '1.0.0', 'First');
    store.saveVersion('coder', 'v2', '2.0.0', 'Second');
    store.saveVersion('coder', 'v1', '3.0.0', 'Third');
    store.saveVersion('researcher', 'r1', '1.0.0', 'Researcher first');

    const coderVersions = store.listVersions('coder');
    const researcherVersions = store.listVersions('researcher');

    expect(coderVersions).toHaveLength(3);
    expect(researcherVersions).toHaveLength(1);

    // Only latest of each slug is current
    expect(coderVersions.filter((v) => v.isCurrent)).toHaveLength(1);
    expect(researcherVersions[0].isCurrent).toBe(true);
  });
});

describe('computeUnifiedDiff', () => {
  it('detects additions and deletions correctly', () => {
    const result = computeUnifiedDiff('a\nb\nc', 'a\nx\nc\nd');

    expect(result.additions).toBeGreaterThan(0);
    expect(result.deletions).toBeGreaterThan(0);
    expect(typeof result.hunks).toBe('string');
  });

  it('returns zero changes for identical content', () => {
    const result = computeUnifiedDiff('same\ncontent', 'same\ncontent');

    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });
});
