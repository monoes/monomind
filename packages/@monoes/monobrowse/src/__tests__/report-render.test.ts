/**
 * The renderer's contract is that the HTML is SELF-CONTAINED: it must render
 * identically on a machine with no network, because monomind's document
 * pipeline ingests it as an ordinary document and because an archived report
 * has to still work years later. These tests enforce that mechanically.
 */
import { describe, expect, it } from 'vitest';
import { buildReport } from '../report/analyze.js';
import { DEFAULT_BUDGET, parseBudget } from '../report/budget.js';
import { escapeHtml, renderHtml } from '../report/render.js';
import type { CaptureData, Report } from '../report/types.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
    vitals: {},
    a11y: [],
    screenshots: [],
    notes: [],
    ...partial,
  };
}

function report(partial: Partial<CaptureData> = {}, budget = DEFAULT_BUDGET): Report {
  return buildReport(capture(partial), budget);
}

/** Anything that would make the browser go to the network to render the page. */
function externalReferences(html: string): string[] {
  const patterns = [
    /<script[^>]+\ssrc\s*=/gi,
    /<link\b/gi,
    /@import/gi,
    /url\(\s*['"]?https?:/gi,
    /\s(?:src|href|poster|action|data)\s*=\s*["']https?:/gi,
    /\s(?:src|href)\s*=\s*["']\/\//gi,
  ];
  return patterns.flatMap((p) => html.match(p) ?? []);
}

describe('renderHtml — self-containment', () => {
  it('references no external resource of any kind', () => {
    const html = renderHtml(
      report({
        screenshots: [{ label: 'page', width: 1280, height: 3000, dataUrl: PNG }],
        requests: [{ url: 'https://cdn.test/app.js', method: 'GET', status: 404, failed: true }],
        console: [{ type: 'error', text: 'boom', url: 'https://cdn.test/app.js', timestamp: 0 }],
      }),
    );
    expect(externalReferences(html)).toEqual([]);
  });

  it('inlines its CSS in a style element and inlines screenshots as data URIs', () => {
    const html = renderHtml(
      report({ screenshots: [{ label: 'page', width: 800, height: 600, dataUrl: PNG }] }),
    );
    expect(html).toContain('<style>');
    expect(html).toContain('src="data:image/png;base64,');
  });

  it('themes for both light and dark without JavaScript', () => {
    const html = renderHtml(report());
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).not.toMatch(/<script(?![^>]*type="application\/json")/i);
  });
});

describe('renderHtml — content', () => {
  it('leads with a PASS verdict for a clean page', () => {
    const html = renderHtml(report({ vitals: { lcp: 800, cls: 0.01, inp: 20 } }));
    const verdictAt = html.indexOf('PASS');
    expect(verdictAt).toBeGreaterThan(-1);
    expect(verdictAt).toBeLessThan(html.indexOf('Failed requests'));
    expect(html).toContain('All budgets met.');
  });

  it('orders the sections verdict, errors, failed requests, vitals, a11y, screenshots', () => {
    const html = renderHtml(report());
    const order = [
      'PASS',
      'Errors',
      'Failed requests',
      'Web vitals',
      'Accessibility',
      'Screenshots',
    ];
    const positions = order.map((s) => html.indexOf(s));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('shows each budget failure with its expected and actual values', () => {
    const html = renderHtml(
      report({ vitals: { lcp: 4100, cls: 0, inp: 0 } }, parseBudget({ lcp: 2500 })),
    );
    expect(html).toContain('FAIL');
    expect(html).toContain('LCP (Largest Contentful Paint)');
    expect(html).toContain('&lt;= 2500ms');
    expect(html).toContain('4100ms');
  });

  it('lists failed requests and omits the successful ones', () => {
    const html = renderHtml(
      report({
        requests: [
          { url: 'https://shop.test/api/cart', method: 'POST', status: 500, failed: true },
          { url: 'https://shop.test/ok', method: 'GET', status: 200, failed: false },
        ],
      }),
    );
    expect(html).toContain('https://shop.test/api/cart');
    expect(html).not.toContain('https://shop.test/ok');
  });

  it('says a metric was not measured rather than showing a fake zero', () => {
    const html = renderHtml(report({ vitals: { cls: 0.05 } }));
    expect(html).toContain('not measured');
  });

  it('renders a11y findings with role, name state and locator', () => {
    const html = renderHtml(
      report({
        a11y: [
          {
            rule: 'unlabelled-control',
            impact: 'error',
            role: 'button',
            name: null,
            locator: 'form > button:nth-of-type(2)',
            detail: 'button has no accessible name',
          },
        ],
      }),
    );
    expect(html).toContain('unlabelled-control');
    expect(html).toContain('form &gt; button:nth-of-type(2)');
    expect(html).toContain('(no accessible name)');
  });

  it('states plainly that contrast was not evaluated', () => {
    expect(renderHtml(report())).toMatch(/[Cc]olour contrast is not evaluated/);
  });

  it('surfaces degraded-run notes', () => {
    const html = renderHtml(report({ notes: ['Page never went network-idle within 20000ms'] }));
    expect(html).toContain('Run notes');
    expect(html).toContain('never went network-idle');
  });
});

describe('escapeHtml', () => {
  it('neutralizes markup from page-controlled strings', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
  });

  it('keeps an injected error message from breaking out of the document', () => {
    const html = renderHtml(
      report({ pageErrors: [{ text: '</table><script>alert(1)</script>', timestamp: 0 }] }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
