/**
 * The Wave 2 report sections: trend (RIG-13), run diff (RIG-10), evidence
 * timeline (RIG-11) and flake analysis (RIG-14).
 *
 * The report is a single self-contained file that gets mailed around and fed
 * to the document pipeline, so two properties matter beyond "the section is
 * there": everything interpolated is escaped, and the JSON sibling carries
 * the measurements without the megabytes of base64.
 */
import { describe, expect, it } from 'vitest';
import { buildReport } from '../report/analyze.js';
import { DEFAULT_BUDGET } from '../report/budget.js';
import { analyzeFlake } from '../report/flake.js';
import { toHistoryRun } from '../report/history.js';
import { toJsonReport } from '../report/index.js';
import { encodePng, pngToDataUrl } from '../report/png.js';
import { renderHtml } from '../report/render.js';
import { buildTrend } from '../report/trend.js';
import type { CaptureData, Evidence, Report, RunDiff } from '../report/types.js';

function capture(partial: Partial<CaptureData> = {}): CaptureData {
  return {
    url: 'https://shop.test/checkout',
    finalUrl: 'https://shop.test/checkout',
    title: 'Checkout',
    capturedAt: '2026-09-21T10:00:00.000Z',
    durationMs: 1500,
    console: [],
    pageErrors: [],
    requests: [],
    vitals: { lcp: 2400, cls: 0.02, inp: 60 },
    a11y: [],
    screenshots: [],
    notes: [],
    ...partial,
  };
}

const report = (partial: Partial<CaptureData> = {}): Report =>
  buildReport(capture(partial), DEFAULT_BUDGET);

function tinyPngDataUrl(shade: number) {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set([shade, shade, shade, 255], i * 4);
  return pngToDataUrl(encodePng({ width: 4, height: 4, data }));
}

describe('trend section', () => {
  it('says so plainly on a first run instead of drawing an empty chart', () => {
    const r = report();
    r.trend = buildTrend(r, []);
    const html = renderHtml(r);
    expect(html).toContain('First recorded run for this URL');
  });

  it('leads with the creep headline and draws a sparkline', () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      toHistoryRun(
        report({ capturedAt: `2026-09-1${i}T10:00:00.000Z`, vitals: { lcp: 2000 } }),
        `id${i}`,
      ),
    );
    const r = report({ vitals: { lcp: 2400 } });
    r.trend = buildTrend(r, history);
    const html = renderHtml(r);
    expect(html).toContain('Trend — this run against the previous 5');
    expect(html).toContain('LCP has crept up 400ms');
    expect(html).toContain('<svg class="spark"');
    expect(html).toContain('verdictstrip');
    // Lower-is-better is stated, or a positive delta reads as good news.
    expect(html).toContain('lower-is-better');
  });

  it('omits a metric no run ever measured', () => {
    const history = [toHistoryRun(report({ vitals: { lcp: 2000 } }), 'id0')];
    const r = report({ vitals: { lcp: 2400 } });
    r.trend = buildTrend(r, history);
    const html = renderHtml(r);
    // Scoped to the trend table: the Wave 1 vitals table lists every metric
    // whether or not it was measured, which is correct for that section.
    const section = html.slice(html.indexOf('<h2>Trend'), html.indexOf('<h2>Errors'));
    expect(section).toContain('<b>LCP</b>');
    expect(section).not.toContain('<b>TTFB</b>');
  });
});

describe('diff section', () => {
  const diff: RunDiff = {
    previousRunId: '20260920T100000Z-abcdabcd',
    previousCapturedAt: '2026-09-20T10:00:00.000Z',
    notes: [],
    structure: {
      gained: [{ path: '/main[1]/button[1]', role: 'button', name: 'Cancel', depth: 1 }],
      lost: [{ path: '/main[1]/link[1]', role: 'link', name: 'Back', depth: 1 }],
      renamed: [{ path: '/main[1]/button[2]', role: 'button', from: 'Pay now', to: 'Place order' }],
      moved: [],
      unchanged: 42,
      changed: 3,
    },
    pixels: {
      comparable: true,
      changedPixels: 1234,
      totalPixels: 100_000,
      changedPercent: 1.234,
      previousSize: { width: 400, height: 250 },
      currentSize: { width: 400, height: 300 },
      sizeChanged: true,
      diffDataUrl: tinyPngDataUrl(120),
      scale: 2,
    },
  };

  it('lists what was gained, lost and renamed', () => {
    const r = report();
    r.diff = diff;
    const html = renderHtml(r);
    expect(html).toContain('Changes since the previous run');
    expect(html).toContain('2026-09-20T10:00:00.000Z');
    expect(html).toContain('Cancel');
    expect(html).toContain('Back');
    expect(html).toContain('Place order');
    expect(html).toContain('42</b> unchanged');
  });

  it('reports the changed percentage, the size change and the highlight image', () => {
    const r = report();
    r.diff = diff;
    const html = renderHtml(r);
    expect(html).toContain('1.23%</b> of pixels changed');
    expect(html).toContain('400×250');
    expect(html).toContain('400×300');
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('1/2 scale');
  });

  it('says the tree is identical rather than showing an empty table', () => {
    const r = report();
    r.diff = {
      ...diff,
      structure: { gained: [], lost: [], renamed: [], moved: [], unchanged: 40, changed: 0 },
      pixels: undefined,
    };
    expect(renderHtml(r)).toContain('identical to the previous run');
  });

  it('escapes an accessible name that contains markup', () => {
    const r = report();
    r.diff = {
      ...diff,
      structure: {
        gained: [
          {
            path: '/main[1]/button[1]',
            role: 'button',
            name: '<img src=x onerror="alert(1)">',
            depth: 1,
          },
        ],
        lost: [],
        renamed: [],
        moved: [],
        unchanged: 0,
        changed: 1,
      },
    };
    const html = renderHtml(r);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });
});

describe('evidence section', () => {
  const evidence: Evidence = {
    reason: 'budget-failure',
    focusOffsetMs: 1200,
    frames: [
      { offsetMs: 1100, dataUrl: 'data:image/jpeg;base64,AAAA', bytes: 4 },
      { offsetMs: 1200, dataUrl: 'data:image/jpeg;base64,BBBB', bytes: 4 },
    ],
    timeline: [
      { offsetMs: 1100, kind: 'frame', label: 'frame', severity: 'info', frameIndex: 0 },
      {
        offsetMs: 1200,
        kind: 'console',
        label: 'console.error',
        detail: 'Cannot read properties of undefined',
        severity: 'error',
      },
      { offsetMs: 1200, kind: 'marker', label: 'first failure', severity: 'error' },
    ],
    droppedFrames: 18,
    totalBytes: 8,
    notes: ['18 recorded frame(s) not attached — the report keeps the 2 nearest the failure.'],
  };

  it('renders a filmstrip and a time-ordered timeline', () => {
    const r = report();
    r.evidence = evidence;
    const html = renderHtml(r);
    expect(html).toContain('<h2>Evidence</h2>');
    expect(html).toContain('filmstrip');
    expect(html).toContain('data:image/jpeg;base64,BBBB');
    expect(html).toContain('Cannot read properties of undefined');
    expect(html).toContain('first failure');
    expect(html).toContain('+1.20s');
  });

  it('marks the frame nearest the failure', () => {
    const r = report();
    r.evidence = evidence;
    const html = renderHtml(r);
    expect(html).toContain('at failure');
    expect(html).toContain('<figure class="focus">');
  });

  it('says why it recorded and surfaces its own bounds', () => {
    const r = report();
    r.evidence = evidence;
    const html = renderHtml(r);
    expect(html).toContain('breached its budget');
    expect(html).toContain('not attached');
  });

  it('is absent entirely when nothing was recorded', () => {
    expect(renderHtml(report())).not.toContain('<h2>Evidence</h2>');
  });
});

describe('flake section', () => {
  const err = (text: string) => ({ type: 'error', text, timestamp: 0 });

  it('shows a FLAKY banner and the per-check rates', () => {
    const flake = analyzeFlake([report(), report({ console: [err('boom')] }), report()]);
    const html = renderHtml(report(), { flake });
    expect(html).toContain('Repeatability — 3 runs');
    expect(html).toContain('>FLAKY<');
    expect(html).toContain('2 of 3 passed');
    expect(html).toContain('Confidence: high.');
  });

  it('states what a clean window does not prove', () => {
    const flake = analyzeFlake([report(), report()]);
    const html = renderHtml(report(), { flake });
    expect(html).toContain('>PASS<');
    expect(html).toContain('95% confidence');
  });

  it('lists an intermittent error with the runs it appeared in', () => {
    const flake = analyzeFlake([report(), report({ console: [err('flaky fetch')] }), report()]);
    const html = renderHtml(report(), { flake });
    expect(html).toContain('flaky fetch');
    expect(html).toContain('1 of 3');
  });

  it('is absent for an ordinary single run', () => {
    expect(renderHtml(report())).not.toContain('Repeatability');
  });
});

describe('toJsonReport', () => {
  it('keeps the pixel measurements but drops the highlight image', () => {
    const r = report();
    r.diff = {
      previousRunId: 'x',
      previousCapturedAt: '2026-09-20T10:00:00.000Z',
      notes: [],
      pixels: {
        comparable: true,
        changedPixels: 10,
        totalPixels: 100,
        changedPercent: 10,
        previousSize: { width: 4, height: 4 },
        currentSize: { width: 4, height: 4 },
        sizeChanged: false,
        diffDataUrl: tinyPngDataUrl(10),
      },
    };
    const json = toJsonReport(r) as { diff: { pixels: Record<string, unknown> } };
    expect(json.diff.pixels.changedPercent).toBe(10);
    expect(json.diff.pixels.diffDataUrl).toBeUndefined();
  });

  it('keeps frame offsets but drops the frame images', () => {
    const r = report();
    r.evidence = {
      reason: 'requested',
      focusOffsetMs: null,
      frames: [{ offsetMs: 500, dataUrl: 'data:image/jpeg;base64,AAAA', bytes: 4 }],
      timeline: [],
      droppedFrames: 0,
      totalBytes: 4,
      notes: [],
    };
    const json = toJsonReport(r) as { evidence: { frames: Array<Record<string, unknown>> } };
    expect(json.evidence.frames).toEqual([{ offsetMs: 500, bytes: 4 }]);
  });

  it('never serializes the raw recording buffer', () => {
    const r = report();
    r.recording = {
      startedAtMs: 1,
      frames: [{ offsetMs: 0, data: 'x', bytes: 1 }],
      droppedFrames: 0,
      requested: true,
    };
    expect(JSON.stringify(toJsonReport(r))).not.toContain('"recording"');
  });

  it('carries the trend through unchanged', () => {
    const r = report();
    r.trend = buildTrend(r, []);
    const json = toJsonReport(r) as { trend: { runs: number } };
    expect(json.trend.runs).toBe(0);
  });
});
