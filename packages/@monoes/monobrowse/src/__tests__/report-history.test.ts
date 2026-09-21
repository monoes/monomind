/**
 * RIG-13 — run history on disk and the trends computed from it.
 *
 * The filesystem half uses a scratch directory under the monomind data dir
 * (never the shared /tmp) and points MONOBROWSE_HISTORY_DIR at it, so no test
 * can touch a real history.
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReport } from '../report/analyze.js';
import { DEFAULT_BUDGET } from '../report/budget.js';
import {
  type HistoryRun,
  historyKey,
  listRuns,
  loadRunScreenshot,
  pruneHistory,
  saveRun,
  toHistoryRun,
} from '../report/history.js';
import { encodePng, pngToDataUrl } from '../report/png.js';
import { buildTrend, formatTrendDelta, formatTrendValue } from '../report/trend.js';
import type { Budget, CaptureData, Report, VitalsData } from '../report/types.js';

function capture(partial: Partial<CaptureData> = {}): CaptureData {
  return {
    url: 'https://shop.test/checkout',
    finalUrl: 'https://shop.test/checkout',
    title: 'Checkout',
    capturedAt: '2026-09-21T10:00:00.000Z',
    durationMs: 1200,
    console: [],
    pageErrors: [],
    requests: [],
    vitals: { lcp: 2000, cls: 0.01, inp: 50 },
    a11y: [],
    screenshots: [],
    notes: [],
    ...partial,
  };
}

const report = (partial: Partial<CaptureData> = {}, budget: Budget = DEFAULT_BUDGET): Report =>
  buildReport(capture(partial), budget);

/** A prior run, shaped exactly as it comes back off disk. */
function historyRun(
  capturedAt: string,
  vitals: VitalsData,
  counts: Partial<Report['counts']> = {},
) {
  const run = toHistoryRun(report({ capturedAt, vitals }), `id-${capturedAt}`);
  run.counts = { ...run.counts, ...counts };
  run.verdict = (counts.consoleErrors ?? 0) > 0 ? 'fail' : 'pass';
  return run;
}

function tinyPng(width = 4, height = 4, shade = 200) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([shade, shade, shade, 255], i * 4);
  return encodePng({ width, height, data });
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe('historyKey', () => {
  it('is readable and includes a hash of the full URL', () => {
    expect(historyKey('https://shop.test/checkout')).toMatch(/^shop\.test-checkout-[0-9a-f]{8}$/);
  });

  it('does not collide across URLs that differ only in the query string', () => {
    expect(historyKey('https://a.test/list?page=2')).not.toBe(
      historyKey('https://a.test/list?page=3'),
    );
  });

  it('survives a string that is not a URL at all', () => {
    expect(historyKey('not a url')).toMatch(/^not-a-url-[0-9a-f]{8}$/);
  });
});

describe('run history on disk', () => {
  let root: string;

  beforeEach(async () => {
    await mkdir(join(homedir(), '.monomind'), { recursive: true });
    root = await mkdtemp(join(homedir(), '.monomind', 'monobrowse-history-test-'));
    process.env.MONOBROWSE_HISTORY_DIR = root;
  });

  afterEach(async () => {
    delete process.env.MONOBROWSE_HISTORY_DIR;
    await rm(root, { recursive: true, force: true });
  });

  it('writes one JSON record per run, keyed by URL', async () => {
    const saved = await saveRun(report(), { root, id: '20260921T100000Z-aaaaaaaa' });
    expect(saved.dir).toBe(join(root, historyKey('https://shop.test/checkout')));
    const files = await readdir(saved.dir);
    expect(files).toContain('20260921T100000Z-aaaaaaaa.json');
    expect(files).toContain('url.txt');
  });

  it('archives the main screenshot alongside so the next run can diff pixels', async () => {
    const png = tinyPng();
    const saved = await saveRun(
      report({
        screenshots: [{ label: 'page', width: 4, height: 4, dataUrl: pngToDataUrl(png) }],
      }),
      { root, id: '20260921T100000Z-bbbbbbbb' },
    );
    expect(saved.run.screenshotFile).toBe('20260921T100000Z-bbbbbbbb.png');
    const loaded = await loadRunScreenshot(saved.dir, saved.run);
    expect(loaded && Buffer.from(loaded).equals(png)).toBe(true);
  });

  it('returns null for a screenshot that was never archived', async () => {
    const saved = await saveRun(report(), { root, id: '20260921T100000Z-cccccccc' });
    expect(await loadRunScreenshot(saved.dir, saved.run)).toBeNull();
  });

  it('lists runs oldest first', async () => {
    for (const ts of ['2026-09-21T12:00:00.000Z', '2026-09-21T10:00:00.000Z']) {
      await saveRun(report({ capturedAt: ts }), { root });
    }
    const dir = join(root, historyKey('https://shop.test/checkout'));
    expect((await listRuns(dir)).map((r) => r.capturedAt)).toEqual([
      '2026-09-21T10:00:00.000Z',
      '2026-09-21T12:00:00.000Z',
    ]);
  });

  it('prunes to the configured maximum, oldest first, taking the PNGs with them', async () => {
    const dir = join(root, historyKey('https://shop.test/checkout'));
    for (let i = 0; i < 5; i++) {
      await saveRun(
        report({
          capturedAt: `2026-09-2${i + 1}T10:00:00.000Z`,
          screenshots: [{ label: 'page', width: 4, height: 4, dataUrl: pngToDataUrl(tinyPng()) }],
        }),
        { root, max: 3, id: `2026092${i + 1}T100000Z-0000000${i}` },
      );
    }
    const runs = await listRuns(dir);
    expect(runs.map((r) => r.capturedAt)).toEqual([
      '2026-09-23T10:00:00.000Z',
      '2026-09-24T10:00:00.000Z',
      '2026-09-25T10:00:00.000Z',
    ]);
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith('.png')).length).toBe(3);
  });

  it('keeps everything when the history is shorter than the maximum', async () => {
    const dir = join(root, historyKey('https://shop.test/checkout'));
    await saveRun(report(), { root, max: 10 });
    expect(await pruneHistory(dir, 10)).toEqual([]);
  });

  it('skips a corrupt record instead of failing the whole read', async () => {
    const dir = join(root, historyKey('https://shop.test/checkout'));
    await saveRun(report(), { root, id: '20260921T100000Z-dddddddd' });
    await writeFile(join(dir, '20260922T100000Z-eeeeeeee.json'), '{ truncated', 'utf8');
    const runs = await listRuns(dir);
    expect(runs.map((r) => r.id)).toEqual(['20260921T100000Z-dddddddd']);
  });

  it('returns an empty history for a URL never reported on', async () => {
    expect(await listRuns(join(root, 'never-seen-00000000'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

describe('buildTrend', () => {
  it('reports no prior runs on a first run without inventing a direction', () => {
    const trend = buildTrend(report(), []);
    expect(trend.runs).toBe(0);
    expect(trend.windowFrom).toBeNull();
    expect(trend.series.every((s) => s.direction === 'new')).toBe(true);
    expect(trend.headlines).toEqual([]);
  });

  it('names the slow decay the story is about', () => {
    // LCP walks 2000 -> 2400ms across nine prior runs, never once crossing
    // the 2500ms budget, so no individual run ever failed.
    const history: HistoryRun[] = [];
    for (let i = 0; i < 9; i++) {
      history.push(historyRun(`2026-09-${10 + i}T10:00:00.000Z`, { lcp: 2000 + i * 50 }));
    }
    const trend = buildTrend(
      report({ capturedAt: '2026-09-21T10:00:00.000Z', vitals: { lcp: 2400 } }),
      history,
    );
    const lcp = trend.series.find((s) => s.key === 'lcp');
    expect(lcp?.deltaFromOldest).toBe(400);
    expect(lcp?.creep).toBe('LCP has crept up 400ms over 10 runs (2.00s → 2.40s).');
    expect(trend.headlines[0]).toContain('crept up 400ms');
  });

  it('does not call rasteriser-scale jitter a regression', () => {
    const history = [historyRun('2026-09-20T10:00:00.000Z', { lcp: 2000 })];
    const trend = buildTrend(report({ vitals: { lcp: 2010 } }), history);
    expect(trend.series.find((s) => s.key === 'lcp')?.direction).toBe('flat');
  });

  it('calls a real movement a regression, and the reverse an improvement', () => {
    const history = [historyRun('2026-09-20T10:00:00.000Z', { lcp: 2000 })];
    expect(
      buildTrend(report({ vitals: { lcp: 2600 } }), history).series.find((s) => s.key === 'lcp')
        ?.direction,
    ).toBe('regressed');
    expect(
      buildTrend(report({ vitals: { lcp: 1400 } }), history).series.find((s) => s.key === 'lcp')
        ?.direction,
    ).toBe('improved');
  });

  it('treats a single new console error as a regression', () => {
    const history = [historyRun('2026-09-20T10:00:00.000Z', { lcp: 2000 })];
    const current = report({
      console: [{ type: 'error', text: 'boom', timestamp: 0 }],
    });
    const errors = buildTrend(current, history).series.find((s) => s.key === 'consoleErrors');
    expect(errors).toMatchObject({
      current: 1,
      previous: 0,
      deltaFromPrevious: 1,
      direction: 'regressed',
    });
  });

  it('leads with a first failure after a clean window', () => {
    const history = [1, 2, 3].map((i) => historyRun(`2026-09-1${i}T10:00:00.000Z`, { lcp: 2000 }));
    const failing = report({ console: [{ type: 'error', text: 'boom', timestamp: 0 }] });
    expect(failing.verdict).toBe('fail');
    expect(buildTrend(failing, history).headlines[0]).toBe(
      'First failure in this window — the previous 3 run(s) all passed.',
    );
  });

  it('includes this run as the last point of every series', () => {
    const history = [historyRun('2026-09-20T10:00:00.000Z', { lcp: 2000 })];
    const trend = buildTrend(
      report({ capturedAt: '2026-09-21T10:00:00.000Z', vitals: { lcp: 2100 } }),
      history,
    );
    const lcp = trend.series.find((s) => s.key === 'lcp');
    expect(lcp?.points).toEqual([
      { capturedAt: '2026-09-20T10:00:00.000Z', value: 2000 },
      { capturedAt: '2026-09-21T10:00:00.000Z', value: 2100 },
    ]);
    expect(trend.verdictHistory.at(-1)).toEqual({
      capturedAt: '2026-09-21T10:00:00.000Z',
      verdict: 'pass',
    });
  });

  it('ignores runs that never measured the metric when picking a baseline', () => {
    const history = [
      historyRun('2026-09-18T10:00:00.000Z', { lcp: 2000 }),
      historyRun('2026-09-19T10:00:00.000Z', {}),
    ];
    const lcp = buildTrend(report({ vitals: { lcp: 2600 } }), history).series.find(
      (s) => s.key === 'lcp',
    );
    expect(lcp?.previous).toBe(2000);
    expect(lcp?.deltaFromPrevious).toBe(600);
  });
});

describe('trend formatting', () => {
  it('switches to seconds past a second so a reader can see the scale', () => {
    expect(formatTrendValue('ms', 412)).toBe('412ms');
    expect(formatTrendValue('ms', 2450)).toBe('2.45s');
    expect(formatTrendValue('score', 0.1234)).toBe('0.123');
    expect(formatTrendValue('count', 3)).toBe('3');
    expect(formatTrendValue('ms', null)).toBe('—');
  });

  it('signs deltas, and says so plainly when there is no change', () => {
    expect(formatTrendDelta('ms', 400)).toBe('+400ms');
    expect(formatTrendDelta('ms', -400)).toBe('−400ms');
    expect(formatTrendDelta('count', 0)).toBe('no change');
    expect(formatTrendDelta('count', null)).toBe('no change');
  });
});
