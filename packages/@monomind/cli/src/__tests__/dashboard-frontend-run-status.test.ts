import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { v2RunStatus } from '../ui/org-run-summary.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const mk = () => {
  const d = mkdtempSync(join(process.env.TMPDIR ?? '/var/tmp', 'run-status-'));
  dirs.push(d);
  mkdirSync(d, { recursive: true });
  return d;
};
const sum = { done: false, mtimeMs: Date.now() };

describe('v2RunStatus: ended vs stale', () => {
  it('org-complete is the only complete', () => {
    const d = mk();
    writeFileSync(
      join(d, 'history.jsonl'),
      `${JSON.stringify({ run: 'r', closedBy: 'org-complete' })}\n`,
    );
    expect(v2RunStatus(d, 'r', sum).status).toBe('complete');
  });

  it('any other closedBy is ended and carries the reason', () => {
    const d = mk();
    writeFileSync(
      join(d, 'history.jsonl'),
      `${JSON.stringify({ run: 'r', closedBy: 'idle-stop' })}\n`,
    );
    expect(v2RunStatus(d, 'r', sum)).toEqual({ status: 'ended', closedBy: 'idle-stop' });
  });

  it('a stopped current runtime is ended; an unknown run stays stale', () => {
    const d = mk();
    writeFileSync(
      join(d, 'runtime.json'),
      JSON.stringify({ run: 'r', status: 'stopped', closedBy: 'stop-file' }),
    );
    expect(v2RunStatus(d, 'r', sum)).toEqual({ status: 'ended', closedBy: 'stop-file' });
    expect(v2RunStatus(d, 'other', sum).status).toBe('stale');
  });
});
