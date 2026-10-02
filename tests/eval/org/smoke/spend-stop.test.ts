import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs modules
import { spendOf, watchSpend } from './spend-stop.mjs';

const usage = (cost?: unknown) =>
  JSON.stringify({ type: 'usage', from: 'lead', data: { tokens: 1, cost_usd: cost } });
const orgStopped = JSON.stringify({ type: 'status', reason: 'org-stopped' });

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'spend-stop-'));
  const orgDir = join(root, '.monomind/orgs/o');
  const write = (run: string, lines: string[], torn = '') => {
    mkdirSync(join(orgDir, run), { recursive: true });
    writeFileSync(join(orgDir, run, 'bus.jsonl'), lines.map((l) => `${l}\n`).join('') + torn);
  };
  return { root, orgDir, write, run: (r: string) => join(orgDir, r) };
}

describe('spendOf', () => {
  it('sums every usage cost, ignoring null, missing and non-numeric costs', () => {
    const s = setup();
    s.write('run-1', [
      usage(1.5),
      usage(null),
      usage(),
      usage('2'),
      usage(0.25),
      JSON.stringify({ type: 'tool', data: { cost_usd: 99 } }),
    ]);
    expect(spendOf(s.run('run-1'))).toBeCloseTo(1.75);
  });

  it('tolerates a torn last line', () => {
    const s = setup();
    s.write('run-1', [usage(1)], '{"type":"usage","data":{"cost_us');
    expect(spendOf(s.run('run-1'))).toBe(1);
  });

  it('is 0 for a missing file or directory', () => {
    const s = setup();
    expect(spendOf(s.run('run-9'))).toBe(0);
    mkdirSync(s.run('run-2'), { recursive: true });
    expect(spendOf(s.run('run-2'))).toBe(0);
  });
});

describe('watchSpend', () => {
  const opts = (s: ReturnType<typeof setup>, sleep: () => Promise<void>) => ({
    root: s.root,
    name: 'o',
    limitUsd: 10,
    pollMs: 1,
    now: () => '2026-01-01T00:00:00.000Z',
    sleep,
  });

  it('reads the latest run only', async () => {
    const s = setup();
    s.write('run-1', [usage(50), orgStopped]);
    s.write('run-2', [usage(1)]);
    let polls = 0;
    const out = await watchSpend(
      opts(s, async () => {
        if (++polls === 2) s.write('run-2', [usage(1), orgStopped]);
      }),
    );
    expect(out).toBe('org-stopped');
    expect(polls).toBe(2); // run-1's spend and org-stopped did not count
    expect(existsSync(join(s.orgDir, 'stop'))).toBe(false);
  });

  it('writes the stopfile and the record once, only when the limit is crossed', async () => {
    const s = setup();
    s.write('run-1', [usage(4)]);
    const stopfile = join(s.orgDir, 'stop');
    const seen: boolean[] = [];
    let polls = 0;
    const out = await watchSpend(
      opts(s, async () => {
        seen.push(existsSync(stopfile));
        polls++;
        if (polls === 1) s.write('run-1', [usage(4), usage(5.9)]); // 9.9: below
        if (polls === 2) s.write('run-1', [usage(4), usage(5.9), usage(0.1)]); // 10.0: at the limit
      }),
    );
    expect(out).toBe('spend-stopped');
    expect(seen).toEqual([false, false]); // nothing written before the crossing
    expect(polls).toBe(2); // returned right after writing, no further polling
    expect(Number.isNaN(Date.parse(readFileSync(stopfile, 'utf8')))).toBe(false);
    const rec = JSON.parse(readFileSync(join(s.root, 'spend-stopped.json'), 'utf8'));
    expect(rec).toEqual({ atUsd: 10, limitUsd: 10, at: '2026-01-01T00:00:00.000Z' });
  });

  it('returns without writing when org-stopped appears first, even if over the limit', async () => {
    const s = setup();
    s.write('run-1', [usage(20), orgStopped]);
    const out = await watchSpend(
      opts(s, async () => {
        throw new Error('should not sleep');
      }),
    );
    expect(out).toBe('org-stopped');
    expect(existsSync(join(s.orgDir, 'stop'))).toBe(false);
    expect(existsSync(join(s.root, 'spend-stopped.json'))).toBe(false);
  });
});
