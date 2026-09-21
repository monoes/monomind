/**
 * The orchestration seam in report/index.ts: history is read before the run
 * is saved, evidence is only built when it is warranted, and `--repeat`
 * judges the set rather than the last run.
 *
 * `collect` is mocked, so nothing here launches Chrome. Output and history
 * both go to a scratch directory under the monomind data dir — never the
 * shared /tmp.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import { historyKey, listRuns } from '../report/history.js';
import { encodePng, pngToDataUrl } from '../report/png.js';
import type { CaptureData } from '../report/types.js';

const collect = vi.hoisted(() => vi.fn());
vi.mock('../report/collect.js', () => ({ collect }));

const { runReport, runReportRepeated, readHistory } = await import('../report/index.js');

const URL_UNDER_TEST = 'https://shop.test/checkout';
const client = {} as CdpClient;

function shot(shade: number, width = 8, height = 8) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([shade, shade, shade, 255], i * 4);
  return {
    label: 'page',
    width,
    height,
    dataUrl: pngToDataUrl(encodePng({ width, height, data })),
  };
}

function capture(partial: Partial<CaptureData> = {}): CaptureData {
  return {
    url: URL_UNDER_TEST,
    finalUrl: URL_UNDER_TEST,
    title: 'Checkout',
    capturedAt: '2026-09-21T10:00:00.000Z',
    durationMs: 1000,
    console: [],
    pageErrors: [],
    requests: [],
    vitals: { lcp: 2000, cls: 0.01, inp: 50 },
    a11y: [],
    structure: [{ path: '/main[1]/button[1]', role: 'button', name: 'Pay now', depth: 1 }],
    screenshots: [shot(200)],
    notes: [],
    ...partial,
  };
}

let root: string;
let outDir: string;

beforeEach(async () => {
  await mkdir(join(homedir(), '.monomind'), { recursive: true });
  root = await mkdtemp(join(homedir(), '.monomind', 'monobrowse-run-test-'));
  outDir = join(root, 'out');
  await mkdir(outDir, { recursive: true });
  collect.mockReset();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = (data: CaptureData, extra: Record<string, unknown> = {}) => {
  collect.mockResolvedValueOnce(data);
  return runReport(client, 'S1', {
    url: URL_UNDER_TEST,
    out: join(outDir, `${Math.random().toString(36).slice(2)}.html`),
    historyDir: root,
    cwd: outDir,
    ...extra,
  });
};

describe('runReport and history', () => {
  it('does not let the first run trend or diff against itself', async () => {
    const result = await run(capture());
    expect(result.report.trend?.runs).toBe(0);
    expect(result.report.diff).toBeUndefined();
    // ...but it is on disk for the next run to compare against.
    expect((await listRuns(join(root, historyKey(URL_UNDER_TEST)))).length).toBe(1);
  });

  it('trends and diffs the second run against the first', async () => {
    await run(capture());
    const second = await run(
      capture({
        capturedAt: '2026-09-21T11:00:00.000Z',
        vitals: { lcp: 2600, cls: 0.01, inp: 50 },
        structure: [{ path: '/main[1]/button[1]', role: 'button', name: 'Place order', depth: 1 }],
        screenshots: [shot(40)],
      }),
    );

    expect(second.report.trend?.runs).toBe(1);
    const lcp = second.report.trend?.series.find((s) => s.key === 'lcp');
    expect(lcp).toMatchObject({ previous: 2000, current: 2600, direction: 'regressed' });

    expect(second.report.diff?.previousCapturedAt).toBe('2026-09-21T10:00:00.000Z');
    expect(second.report.diff?.structure?.renamed).toEqual([
      { path: '/main[1]/button[1]', role: 'button', from: 'Pay now', to: 'Place order' },
    ]);
    // Every pixel went from light grey to dark — a whole-screenshot change.
    expect(second.report.diff?.pixels?.changedPercent).toBe(100);
  });

  it('reports the history directory it wrote to', async () => {
    const result = await run(capture());
    expect(result.historyDir).toBe(join(root, historyKey(URL_UNDER_TEST)));
  });

  it('prunes to the configured maximum across runs', async () => {
    for (let i = 0; i < 4; i++) {
      await run(capture({ capturedAt: `2026-09-2${i + 1}T10:00:00.000Z` }), { historyMax: 2 });
    }
    const runs = await listRuns(join(root, historyKey(URL_UNDER_TEST)));
    expect(runs.map((r) => r.capturedAt)).toEqual([
      '2026-09-23T10:00:00.000Z',
      '2026-09-24T10:00:00.000Z',
    ]);
  });

  it('writes nothing to the store when history is off, and says nothing about trends', async () => {
    const result = await run(capture(), { history: false });
    expect(result.report.trend).toBeUndefined();
    expect(result.historyDir).toBeUndefined();
    await expect(readdir(join(root, historyKey(URL_UNDER_TEST)))).rejects.toThrow();
  });

  it('keeps the report when the history store cannot be written', async () => {
    // A regular file where the store's directory needs to be: mkdir fails
    // with ENOTDIR, and the report still has to come out.
    const blocked = join(root, 'blocked-store');
    await writeFile(blocked, 'not a directory', 'utf8');
    const result = await run(capture(), { historyDir: blocked });
    expect(result.report.verdict).toBe('pass');
    expect(result.report.notes.join(' ')).toMatch(/Run history unavailable/);
    expect(result.historyDir).toBeUndefined();
  });

  it('exposes the stored runs through readHistory', async () => {
    await run(capture());
    const { runs } = await readHistory(URL_UNDER_TEST, { historyDir: root });
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatchObject({ url: URL_UNDER_TEST, verdict: 'pass' });
  });
});

describe('runReport and evidence', () => {
  const recording = {
    startedAtMs: 1_000_000,
    frames: [
      { offsetMs: 0, data: 'AAAA', bytes: 4 },
      { offsetMs: 900, data: 'BBBB', bytes: 4 },
    ],
    droppedFrames: 0,
    requested: false,
  };

  it('attaches evidence when the run breaches its budget', async () => {
    const result = await run(
      capture({
        recording,
        console: [{ type: 'error', text: 'boom', timestamp: 1_000_800 }],
      }),
    );
    expect(result.report.verdict).toBe('fail');
    expect(result.report.evidence?.reason).toBe('budget-failure');
    expect(result.report.evidence?.focusOffsetMs).toBe(800);
    expect(result.report.evidence?.frames.length).toBe(2);
  });

  it('does not attach evidence to a passing run that did not ask for it', async () => {
    const result = await run(capture({ recording }));
    expect(result.report.verdict).toBe('pass');
    expect(result.report.evidence).toBeUndefined();
  });

  it('attaches evidence to a passing run when --record asked for it', async () => {
    const result = await run(capture({ recording: { ...recording, requested: true } }));
    expect(result.report.evidence?.reason).toBe('requested');
  });

  it('never leaves the raw recording on the report it returns', async () => {
    const result = await run(capture({ recording: { ...recording, requested: true } }));
    expect(result.report.recording).toBeUndefined();
  });

  it('keeps the frame images out of the JSON sibling', async () => {
    const result = await run(capture({ recording: { ...recording, requested: true } }));
    const json = JSON.parse(await readFile(result.jsonPath, 'utf8'));
    expect(json.evidence.frames).toEqual([
      { offsetMs: 0, bytes: 4 },
      { offsetMs: 900, bytes: 4 },
    ]);
  });
});

describe('runReportRepeated', () => {
  const failing = capture({ console: [{ type: 'error', text: 'boom', timestamp: 0 }] });

  it('runs the URL N times and judges the set', async () => {
    for (const data of [capture(), failing, capture()]) collect.mockResolvedValueOnce(data);
    const result = await runReportRepeated(client, 'S1', {
      url: URL_UNDER_TEST,
      out: join(outDir, 'repeat.html'),
      historyDir: root,
      cwd: outDir,
      repeat: 3,
    });

    expect(collect).toHaveBeenCalledTimes(3);
    expect(result.reports.length).toBe(3);
    expect(result.flake.verdict).toBe('flaky');
    expect(result.summary).toMatch(/^FLAKY/);
  });

  it('refuses to call a sometimes-failing URL a pass, even when the last run is green', async () => {
    for (const data of [failing, capture()]) collect.mockResolvedValueOnce(data);
    const result = await runReportRepeated(client, 'S1', {
      url: URL_UNDER_TEST,
      out: join(outDir, 'repeat2.html'),
      historyDir: root,
      cwd: outDir,
      repeat: 2,
    });
    expect(result.report.verdict).toBe('pass'); // the last run alone
    expect(result.flake.verdict).toBe('flaky'); // what the command reports
  });

  it('writes one history entry for the whole command, not one per run', async () => {
    for (const data of [capture(), capture(), capture()]) collect.mockResolvedValueOnce(data);
    await runReportRepeated(client, 'S1', {
      url: URL_UNDER_TEST,
      out: join(outDir, 'repeat3.html'),
      historyDir: root,
      cwd: outDir,
      repeat: 3,
    });
    expect((await listRuns(join(root, historyKey(URL_UNDER_TEST)))).length).toBe(1);
  });

  it('puts the flake analysis in the JSON sibling', async () => {
    for (const data of [capture(), failing]) collect.mockResolvedValueOnce(data);
    const result = await runReportRepeated(client, 'S1', {
      url: URL_UNDER_TEST,
      out: join(outDir, 'repeat4.html'),
      historyDir: root,
      cwd: outDir,
      repeat: 2,
    });
    const json = JSON.parse(await readFile(result.jsonPath, 'utf8'));
    expect(json.flake.verdict).toBe('flaky');
    expect(json.flake.runs).toBe(2);
  });
});
