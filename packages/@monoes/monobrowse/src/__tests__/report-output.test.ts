/**
 * Everything around the two files the command leaves behind: where they go,
 * what the JSON carries, plus the two pure helpers from the collectors
 * (request classification and locator upgrading) that a stub client can
 * exercise without launching Chrome.
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import { buildReport } from '../report/analyze.js';
import { DEFAULT_BUDGET } from '../report/budget.js';
import { toRequestEntries } from '../report/collect.js';
import { upgradeLocators } from '../report/collect-a11y.js';
import { resolveOutPath, toJsonReport, writeReportFiles } from '../report/index.js';
import type { A11yFinding, AxNode, CaptureData, Report } from '../report/types.js';

function capture(partial: Partial<CaptureData> = {}): CaptureData {
  return {
    url: 'https://shop.test/checkout',
    finalUrl: 'https://shop.test/checkout',
    title: 'Checkout',
    capturedAt: '2026-09-21T10:00:00.000Z',
    durationMs: 3200,
    console: [],
    pageErrors: [],
    requests: [],
    vitals: { lcp: 100, cls: 0, inp: 10 },
    a11y: [],
    screenshots: [],
    notes: [],
    ...partial,
  };
}

const report = (partial: Partial<CaptureData> = {}): Report =>
  buildReport(capture(partial), DEFAULT_BUDGET);

describe('resolveOutPath', () => {
  const when = '2026-09-21T10:00:00.000Z';

  it('derives a dated, host-and-path filename when --out is omitted', async () => {
    const path = await resolveOutPath(undefined, 'https://shop.test/checkout', when, '/work');
    expect(path).toBe('/work/monobrowse-report-shop.test-checkout-20260921T100000Z.html');
  });

  it('uses an explicit .html path as given', async () => {
    expect(await resolveOutPath('/tmp/out.html', 'https://a.test/', when, '/work')).toBe(
      '/tmp/out.html',
    );
  });

  it('resolves a relative path against the working directory', async () => {
    expect(await resolveOutPath('reports/run.html', 'https://a.test/', when, '/work')).toBe(
      '/work/reports/run.html',
    );
  });

  it('adds .html to a path that has no extension and is not a directory', async () => {
    expect(await resolveOutPath('/tmp/run', 'https://a.test/', when, '/work')).toBe(
      '/tmp/run.html',
    );
  });

  it('treats a trailing-separator path as a directory to drop the report into', async () => {
    const path = await resolveOutPath('reports/', 'https://a.test/', when, '/work');
    expect(path).toBe('/work/reports/monobrowse-report-a.test-20260921T100000Z.html');
  });

  it('treats an existing directory as a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'monobrowse-out-'));
    const path = await resolveOutPath(dir, 'https://a.test/', when, '/work');
    expect(path).toBe(join(dir, 'monobrowse-report-a.test-20260921T100000Z.html'));
  });
});

describe('writeReportFiles', () => {
  it('writes the HTML and a sibling JSON carrying the verdict and failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'monobrowse-write-'));
    const r = report({ pageErrors: [{ text: 'boom', timestamp: 0 }] });
    const paths = await writeReportFiles(r, join(dir, 'run.html'));

    expect(paths.jsonPath).toBe(join(dir, 'run.json'));
    const html = await readFile(paths.htmlPath, 'utf8');
    expect(html).toContain('<!doctype html>');

    const json = JSON.parse(await readFile(paths.jsonPath, 'utf8'));
    expect(json.verdict).toBe('fail');
    expect(json.failures[0]).toMatchObject({ budget: 'maxPageErrors', actual: '1' });
  });

  it('creates the output directory if it does not exist yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'monobrowse-write-'));
    const paths = await writeReportFiles(report(), join(dir, 'nested', 'deep', 'run.html'));
    await expect(readFile(paths.htmlPath, 'utf8')).resolves.toContain('PASS');
  });
});

describe('toJsonReport', () => {
  it('drops base64 image payloads but keeps the screenshot metadata', () => {
    const json = toJsonReport(
      report({
        screenshots: [
          {
            label: 'page',
            width: 1280,
            height: 900,
            dataUrl: 'data:image/png;base64,AAAA',
            path: '/tmp/page.png',
          },
        ],
      }),
    );
    const shots = json.screenshots as Array<Record<string, unknown>>;
    expect(shots[0]).toEqual({ label: 'page', width: 1280, height: 900, path: '/tmp/page.png' });
    expect(JSON.stringify(json)).not.toContain('base64');
  });
});

describe('toRequestEntries', () => {
  const base = { id: '1', url: 'https://a.test/x', method: 'GET', startTime: 100 };

  it('marks a 4xx/5xx response as failed', () => {
    const [entry] = toRequestEntries([{ ...base, status: 503, endTime: 400 }], new Map());
    expect(entry.failed).toBe(true);
    expect(entry.durationMs).toBe(300);
  });

  it('leaves a 3xx and a 2xx alone', () => {
    const entries = toRequestEntries(
      [
        { ...base, status: 200 },
        { ...base, id: '2', status: 302 },
      ],
      new Map(),
    );
    expect(entries.map((e) => e.failed)).toEqual([false, false]);
  });

  it('marks a transport failure as failed and carries its errorText', () => {
    const failures = new Map([['1', { errorText: 'net::ERR_CONNECTION_REFUSED' }]]);
    const [entry] = toRequestEntries([base], failures);
    expect(entry).toMatchObject({ failed: true, errorText: 'net::ERR_CONNECTION_REFUSED' });
  });

  it('does not count a request the page itself cancelled', () => {
    const failures = new Map([['1', { errorText: 'net::ERR_ABORTED', canceled: true }]]);
    expect(toRequestEntries([base], failures)[0].failed).toBe(false);
  });

  it('still counts a blocked request even though CDP also marks it cancelled', () => {
    const failures = new Map([['1', { canceled: true, blockedReason: 'csp' }]]);
    const [entry] = toRequestEntries([base], failures);
    expect(entry).toMatchObject({ failed: true, errorText: 'blocked: csp' });
  });

  it('does not treat a still-in-flight request as a failure', () => {
    expect(toRequestEntries([base], new Map())[0].failed).toBe(false);
  });
});

describe('upgradeLocators', () => {
  const finding = (locator: string): A11yFinding => ({
    rule: 'unlabelled-control',
    impact: 'error',
    role: 'button',
    name: null,
    locator,
    detail: 'no name',
  });

  function stubClient(selector: string | null) {
    return {
      send: vi.fn(async (method: string) => {
        if (method === 'DOM.resolveNode') return { object: { objectId: 'obj-1' } };
        if (method === 'Runtime.callFunctionOn') return { result: { value: selector } };
        return {};
      }),
    } as unknown as CdpClient;
  }

  const nodes: AxNode[] = [{ nodeId: '7', backendDOMNodeId: 42 }];

  it('replaces the ax-node placeholder with a resolved CSS selector', async () => {
    const out = await upgradeLocators(stubClient('#submit'), 'sid', [finding('ax-node:7')], nodes);
    expect(out[0].locator).toBe('#submit');
  });

  it('keeps the placeholder when the DOM cannot resolve the node', async () => {
    const out = await upgradeLocators(stubClient(null), 'sid', [finding('ax-node:7')], nodes);
    expect(out[0].locator).toBe('ax-node:7');
  });

  it('leaves DOM-derived locators untouched and costs no round-trip', async () => {
    const client = stubClient('#other');
    const out = await upgradeLocators(client, 'sid', [finding('#already-known')], nodes);
    expect(out[0].locator).toBe('#already-known');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('resolves each backend node once, however many findings point at it', async () => {
    const client = stubClient('#submit');
    await upgradeLocators(client, 'sid', [finding('ax-node:7'), finding('ax-node:7')], nodes);
    const resolves = (client.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'DOM.resolveNode',
    );
    expect(resolves).toHaveLength(1);
  });
});
