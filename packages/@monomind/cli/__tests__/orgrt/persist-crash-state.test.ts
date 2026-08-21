/**
 * #206 follow-up (round 3 review): persistCrashStateAll() never captured
 * WHY a run crashed — runOutcomeResult's "crashed: <error>" message
 * (org.ts) always read "crashed: unknown error" regardless of the actual
 * cause, since nothing ever populated runtime.json's `error` field on the
 * crash-handler path. persistCrashStateAll now accepts an optional error
 * string and writes it when given.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';

function fixture(root: string, name: string): void {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs', `${name}.json`), JSON.stringify({
    name, goal: `goal of ${name}`,
    roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
  }));
}

const hangingQuery = () => (async function* () { await new Promise(() => {}); })();

describe('persistCrashStateAll', () => {
  it('writes the given error message into runtime.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-crash-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false });
    await d.startOrg('alpha');

    d.persistCrashStateAll('uncaughtException: boom');

    const rt = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/runtime.json'), 'utf8'));
    expect(rt.status).toBe('crashed');
    expect(rt.closedBy).toBe('crash-handler');
    expect(rt.error).toBe('uncaughtException: boom');

    await d.stopOrg('alpha');
  });

  it('omits the error field when called with no argument (backward compatible)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-crash-noerr-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false });
    await d.startOrg('alpha');

    d.persistCrashStateAll();

    const rt = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/runtime.json'), 'utf8'));
    expect(rt.status).toBe('crashed');
    expect(rt.error).toBeUndefined();

    await d.stopOrg('alpha');
  });
});
