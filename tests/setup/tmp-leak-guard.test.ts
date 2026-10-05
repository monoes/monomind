import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoTmpLeak, leakedEntries } from './tmp-leak-guard.js';

const made: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-leak-guard-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('tmp leak guard', () => {
  it('passes for an empty or missing dir and for a few entries', () => {
    const dir = scratch();
    expect(() => assertNoTmpLeak(dir)).not.toThrow();
    expect(() => assertNoTmpLeak(join(dir, 'missing'))).not.toThrow();
    for (let i = 0; i < 5; i++) mkdirSync(join(dir, `d${i}`));
    expect(() => assertNoTmpLeak(dir)).not.toThrow();
  });

  it('fails and names the leaked entries past the limit', () => {
    const dir = scratch();
    for (let i = 0; i < 6; i++) writeFileSync(join(dir, `leak-${i}`), '');
    expect(leakedEntries(dir)).toHaveLength(6);
    expect(() => assertNoTmpLeak(dir)).toThrow(/leaked 6 entries.*leak-0/);
    expect(() => assertNoTmpLeak(dir, 6)).not.toThrow();
  });
});

describe('tool-owned entries', () => {
  it('are not counted', () => {
    const dir = scratch();
    for (const n of ['node-compile-cache', 'claude-1000', 'srt-mux-1-0.sock'])
      mkdirSync(join(dir, n));
    expect(leakedEntries(dir)).toEqual([]);
  });
});

describe('the test run keeps TMPDIR in its own temp root', () => {
  it('points os.tmpdir() at a run temp dir, outside the throwaway home', () => {
    expect(basename(tmpdir())).toMatch(/^mm-test-(run-)?tmp-/);
    expect(tmpdir().startsWith(process.env.HOME as string)).toBe(false);
  });
});
