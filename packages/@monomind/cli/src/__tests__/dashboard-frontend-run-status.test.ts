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

  // The bus's plain 'org stopped' (summary.done) comes from org-complete and
  // from a bare manual stop alike; history and runtime.json tell them apart.
  const done = { done: true, mtimeMs: Date.now() };

  it('a manual stop (history line without closedBy) is ended, not complete', () => {
    const d = mk();
    writeFileSync(join(d, 'history.jsonl'), `${JSON.stringify({ run: 'r' })}\n`);
    expect(v2RunStatus(d, 'r', done)).toEqual({ status: 'ended', closedBy: null });
    expect(v2RunStatus(d, 'r', sum)).toEqual({ status: 'ended', closedBy: null });
  });

  it('a stopped bus with org-complete in history is complete', () => {
    const d = mk();
    writeFileSync(
      join(d, 'history.jsonl'),
      `${JSON.stringify({ run: 'r', closedBy: 'org-complete' })}\n`,
    );
    expect(v2RunStatus(d, 'r', done)).toEqual({ status: 'complete', closedBy: 'org-complete' });
  });

  it('without history, runtime.json decides: org-complete is complete, a bare stop is ended', () => {
    const d = mk();
    writeFileSync(
      join(d, 'runtime.json'),
      JSON.stringify({ run: 'r', status: 'stopped', closedBy: 'org-complete' }),
    );
    expect(v2RunStatus(d, 'r', done)).toEqual({ status: 'complete', closedBy: 'org-complete' });
    writeFileSync(join(d, 'runtime.json'), JSON.stringify({ run: 'r', status: 'stopped' }));
    expect(v2RunStatus(d, 'r', done)).toEqual({ status: 'ended', closedBy: null });
    // an older run whose stop the bus recorded, with no record of its own
    expect(v2RunStatus(d, 'older', done)).toEqual({ status: 'ended', closedBy: null });
  });

  it('a stopped bus with no records at all is ended', () => {
    expect(v2RunStatus(mk(), 'r', done)).toEqual({ status: 'ended', closedBy: null });
  });
});
