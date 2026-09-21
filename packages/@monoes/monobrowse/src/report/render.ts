/**
 * Renders a Report as ONE self-contained HTML file: CSS inline, screenshots
 * as `data:` URIs, no fonts, no CDN, no network access of any kind at view
 * time. That is not a stylistic preference — it is what lets monomind's
 * document pipeline ingest the file as an ordinary document, so test history
 * becomes searchable, and what lets the report be mailed or archived and
 * still render years later.
 *
 * Reading order matches how you triage: verdict, errors, failed requests,
 * vitals, accessibility, screenshots.
 */

import { budgetLabel } from './budget.js';
import type { FlakeReport } from './flake.js';
import { EVIDENCE_STYLES, renderEvidence, renderFlake } from './render-evidence.js';
import { renderDiff, renderTrend, TREND_STYLES } from './render-trend.js';
import type { A11yFinding, Report, RequestEntry, Screenshot } from './types.js';
import { escapeHtml } from './util.js';

export { escapeHtml };

function ms(value?: number): string {
  return value === undefined || !Number.isFinite(value) ? 'not measured' : `${Math.round(value)}ms`;
}

function vitalRating(metric: string, v?: number): 'good' | 'mixed' | 'poor' | 'none' {
  if (v === undefined || !Number.isFinite(v)) return 'none';
  const scale: Record<string, [number, number]> = {
    lcp: [2500, 4000],
    fcp: [1800, 3000],
    cls: [0.1, 0.25],
    inp: [200, 500],
    ttfb: [800, 1800],
  };
  const bounds = scale[metric];
  if (!bounds) return 'none';
  return v <= bounds[0] ? 'good' : v <= bounds[1] ? 'mixed' : 'poor';
}

const STYLES = `
:root{
  --bg:#fbfbfd; --panel:#fff; --ink:#15171c; --muted:#5d6470; --line:#e3e6ec;
  --pass:#0f7b4f; --pass-bg:#e7f6ee; --fail:#b3261e; --fail-bg:#fdeceb;
  --warn:#8a5a00; --warn-bg:#fff5e0; --code:#f3f4f7;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#101317; --panel:#171b21; --ink:#e7eaf0; --muted:#98a1b0; --line:#262c35;
    --pass:#57d69c; --pass-bg:#11291f; --fail:#ff9a92; --fail-bg:#2c1614;
    --warn:#f0c168; --warn-bg:#2b2113; --code:#1d222a;
  }
}
*{box-sizing:border-box}
body{margin:0;padding:32px 16px 72px;background:var(--bg);color:var(--ink);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
main{max-width:940px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
  margin:36px 0 12px;font-weight:600}
a{color:inherit}
.sub{color:var(--muted);font-size:13px;margin:0 0 24px;word-break:break-all}
.verdict{border-radius:12px;padding:18px 20px;margin-bottom:8px;border:1px solid transparent}
.verdict.pass{background:var(--pass-bg);border-color:var(--pass);color:var(--pass)}
.verdict.fail{background:var(--fail-bg);border-color:var(--fail);color:var(--fail)}
.verdict .tag{font-size:26px;font-weight:700;letter-spacing:.02em}
.verdict .line{color:var(--ink);margin-top:6px;font-size:14px}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0;padding:0;list-style:none}
.stats li{background:var(--panel);border:1px solid var(--line);border-radius:8px;
  padding:8px 12px;font-size:13px;color:var(--muted)}
.stats li b{display:block;font-size:18px;color:var(--ink)}
.stats li.bad b{color:var(--fail)}
table{width:100%;border-collapse:collapse;background:var(--panel);
  border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:13px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;white-space:nowrap}
tr:last-child td{border-bottom:none}
td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.wrap{word-break:break-all}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
code{background:var(--code);padding:1px 5px;border-radius:4px}
.pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;
  font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.pill.error{background:var(--fail-bg);color:var(--fail)}
.pill.warning{background:var(--warn-bg);color:var(--warn)}
.pill.good{background:var(--pass-bg);color:var(--pass)}
.pill.mixed{background:var(--warn-bg);color:var(--warn)}
.pill.poor{background:var(--fail-bg);color:var(--fail)}
.pill.none{background:var(--code);color:var(--muted)}
.empty{color:var(--muted);font-size:13px;background:var(--panel);border:1px solid var(--line);
  border-radius:10px;padding:12px}
.note{color:var(--muted);font-size:12px;margin-top:8px}
figure{margin:0 0 20px}
figcaption{color:var(--muted);font-size:12px;margin-bottom:6px}
img{max-width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:10px}
footer{margin-top:40px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);
  padding-top:12px}
@media (max-width:640px){body{padding:20px 12px 48px}th,td{padding:8px}}
`.trim();

function emptyBlock(text: string): string {
  return `<p class="empty">${escapeHtml(text)}</p>`;
}

function renderVerdict(report: Report): string {
  const pass = report.verdict === 'pass';
  const headline = pass
    ? 'All budgets met.'
    : `${report.failures.length} budget ${report.failures.length === 1 ? 'failure' : 'failures'}.`;
  const rows = report.failures
    .map(
      (f) => `<tr>
        <td>${escapeHtml(budgetLabel(f.budget))}</td>
        <td class="num mono">${escapeHtml(f.expected)}</td>
        <td class="num mono">${escapeHtml(f.actual)}</td>
        <td class="wrap">${escapeHtml(f.detail ?? '')}</td>
      </tr>`,
    )
    .join('');

  const table = report.failures.length
    ? `<table><thead><tr><th>Budget</th><th>Expected</th><th>Actual</th><th>Evidence</th></tr></thead>
       <tbody>${rows}</tbody></table>`
    : '';

  const unmeasured = report.unmeasured.length
    ? `<p class="note">Not measured on this run: ${escapeHtml(report.unmeasured.join(', '))} — the page never reported the metric, so its budget was neither met nor breached.</p>`
    : '';

  return `<section class="verdict ${pass ? 'pass' : 'fail'}">
    <div class="tag">${pass ? 'PASS' : 'FAIL'}</div>
    <div class="line">${escapeHtml(headline)}</div>
  </section>
  ${table}
  ${unmeasured}`;
}

function renderStats(report: Report): string {
  const c = report.counts;
  const item = (label: string, value: number, bad: boolean) =>
    `<li class="${bad ? 'bad' : ''}"><b>${value}</b>${escapeHtml(label)}</li>`;
  return `<ul class="stats">
    ${item('console errors', c.consoleErrors, c.consoleErrors > 0)}
    ${item('page errors', c.pageErrors, c.pageErrors > 0)}
    ${item('failed requests', c.failedRequests, c.failedRequests > 0)}
    ${item('requests', c.requests, false)}
    ${item('a11y errors', c.a11yErrors, c.a11yErrors > 0)}
    ${item('a11y warnings', c.a11yWarnings, false)}
  </ul>`;
}

function renderErrors(report: Report): string {
  const rows: string[] = [];
  for (const e of report.pageErrors) {
    const where = e.url ? `${e.url}${e.lineNumber !== undefined ? `:${e.lineNumber}` : ''}` : '';
    rows.push(`<tr>
      <td><span class="pill error">uncaught</span></td>
      <td class="wrap">${escapeHtml(e.text)}</td>
      <td class="wrap mono">${escapeHtml(where)}</td>
    </tr>`);
  }
  for (const m of report.console) {
    if (m.type !== 'error' && m.type !== 'warn' && m.type !== 'warning') continue;
    const pill = m.type === 'error' ? 'error' : 'warning';
    const where = m.url ? `${m.url}${m.lineNumber !== undefined ? `:${m.lineNumber}` : ''}` : '';
    rows.push(`<tr>
      <td><span class="pill ${pill}">console.${escapeHtml(m.type)}</span></td>
      <td class="wrap">${escapeHtml(m.text)}</td>
      <td class="wrap mono">${escapeHtml(where)}</td>
    </tr>`);
  }
  if (!rows.length) return emptyBlock('No console errors, warnings or uncaught exceptions.');
  return `<table><thead><tr><th>Kind</th><th>Message</th><th>Source</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`;
}

function renderRequests(requests: RequestEntry[]): string {
  const failed = requests.filter((r) => r.failed);
  if (!failed.length) return emptyBlock('Every request returned a successful response.');
  const rows = failed
    .map(
      (r) => `<tr>
      <td class="mono">${escapeHtml(r.status ?? '—')}</td>
      <td class="mono">${escapeHtml(r.method)}</td>
      <td class="wrap mono">${escapeHtml(r.url)}</td>
      <td class="wrap">${escapeHtml(r.errorText ?? '')}</td>
    </tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Status</th><th>Method</th><th>URL</th><th>Error</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function renderVitals(report: Report): string {
  const v = report.vitals;
  const defs: Array<[string, string, string]> = [
    ['lcp', 'LCP', 'Largest Contentful Paint'],
    ['fcp', 'FCP', 'First Contentful Paint'],
    ['cls', 'CLS', 'Cumulative Layout Shift'],
    ['inp', 'INP', 'Interaction to Next Paint'],
    ['ttfb', 'TTFB', 'Time to First Byte'],
  ];
  const rows = defs
    .map(([key, short, long]) => {
      const raw = v[key as keyof typeof v] as number | undefined;
      const rating = vitalRating(key, raw);
      const shown = key === 'cls' ? (raw === undefined ? 'not measured' : raw.toFixed(3)) : ms(raw);
      return `<tr>
        <td><b>${short}</b> <span style="color:var(--muted)">${escapeHtml(long)}</span></td>
        <td class="num mono">${escapeHtml(shown)}</td>
        <td><span class="pill ${rating}">${rating === 'none' ? 'n/a' : rating}</span></td>
      </tr>`;
    })
    .join('');
  const load = `<tr><td>Load event</td><td class="num mono">${escapeHtml(ms(v.loadTime))}</td><td></td></tr>
    <tr><td>DOM interactive</td><td class="num mono">${escapeHtml(ms(v.domInteractive))}</td><td></td></tr>
    <tr><td>Resources</td><td class="num mono">${escapeHtml(v.resources ?? '—')}</td><td></td></tr>`;
  return `<table><thead><tr><th>Metric</th><th>Value</th><th>Rating</th></tr></thead>
    <tbody>${rows}${load}</tbody></table>`;
}

function renderA11y(findings: A11yFinding[]): string {
  const disclaimer =
    '<p class="note">Colour contrast is not evaluated: it cannot be derived from the accessibility tree, and guessing it would be worse than omitting it.</p>';
  if (!findings.length) {
    return `${emptyBlock('No accessibility findings from the AX tree.')}${disclaimer}`;
  }
  const order = { error: 0, warning: 1 } as const;
  const rows = [...findings]
    .sort((a, b) => order[a.impact] - order[b.impact])
    .map(
      (f) => `<tr>
      <td><span class="pill ${f.impact}">${escapeHtml(f.impact)}</span></td>
      <td class="mono">${escapeHtml(f.rule)}</td>
      <td>${escapeHtml(f.role)}</td>
      <td>${f.name ? escapeHtml(f.name) : '<span style="color:var(--muted)">(no accessible name)</span>'}</td>
      <td class="wrap mono">${escapeHtml(f.locator)}</td>
      <td class="wrap">${escapeHtml(f.detail)}</td>
    </tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Impact</th><th>Rule</th><th>Role</th><th>Name</th><th>Locator</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody></table>${disclaimer}`;
}

function renderScreenshots(shots: Screenshot[]): string {
  if (!shots.length) return emptyBlock('No screenshot was captured.');
  return shots
    .map(
      (s) => `<figure>
      <figcaption>${escapeHtml(s.label)} — ${s.width}×${s.height}</figcaption>
      <img alt="${escapeHtml(`${s.label} screenshot`)}" src="${escapeHtml(s.dataUrl)}">
    </figure>`,
    )
    .join('');
}

export interface RenderOptions {
  /** Present when the report came from `--repeat` (RIG-14). */
  flake?: FlakeReport;
}

export function renderHtml(report: Report, options: RenderOptions = {}): string {
  const title = report.title || report.finalUrl || report.url;
  const notes = report.notes.length
    ? `<h2>Run notes</h2><ul class="empty">${report.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(`Page report — ${title}`)}</title>
<style>${STYLES}
${TREND_STYLES}
${EVIDENCE_STYLES}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="sub">${escapeHtml(report.finalUrl || report.url)} · captured ${escapeHtml(report.capturedAt)} · ${Math.round(report.durationMs)}ms</p>

${renderVerdict(report)}
${renderFlake(options.flake)}
${renderStats(report)}

${renderTrend(report.trend)}
${renderDiff(report.diff)}

<h2>Errors</h2>
${renderErrors(report)}

${renderEvidence(report.evidence)}

<h2>Failed requests</h2>
${renderRequests(report.requests)}

<h2>Web vitals</h2>
${renderVitals(report)}

<h2>Accessibility</h2>
${renderA11y(report.a11y)}

<h2>Screenshots</h2>
${renderScreenshots(report.screenshots)}

${notes}
<footer>Generated by monobrowse report — self-contained, no external resources.</footer>
</main>
</body>
</html>
`;
}
