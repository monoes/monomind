/**
 * Report sections for the trend (RIG-13) and the run-to-run diff (RIG-10).
 *
 * Kept separate from render.ts purely for size. Same rules apply: no external
 * resources, so the sparklines are hand-written inline SVG rather than a
 * charting library, and the diff image is a `data:` URI.
 *
 * The design goal for the trend is legibility at a glance — the point of the
 * feature is catching decay nobody noticed, which only works if the reader
 * sees it without going looking.
 */

import { formatTrendDelta, formatTrendValue } from './trend.js';
import type { RunDiff, StructureDiff, StructureNode, TrendReport, TrendSeries } from './types.js';
import { escapeHtml } from './util.js';

/** Rows shown per diff category before the tail is summarised. */
const MAX_DIFF_ROWS = 20;

export const TREND_STYLES = `
.headlines{background:var(--warn-bg);border:1px solid var(--warn);color:var(--warn);
  border-radius:10px;padding:12px 16px;margin:0 0 16px}
.headlines p{margin:0 0 6px;font-size:14px}
.headlines p:last-child{margin-bottom:0}
.spark{display:block}
.spark .line{fill:none;stroke:var(--muted);stroke-width:1.5}
.spark .dot{fill:var(--ink)}
.dir{font-weight:600}
.dir.regressed{color:var(--fail)}
.dir.improved{color:var(--pass)}
.dir.flat,.dir.new{color:var(--muted)}
.verdictstrip{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 16px;padding:0;list-style:none}
.verdictstrip li{width:13px;height:13px;border-radius:3px;background:var(--pass)}
.verdictstrip li.fail{background:var(--fail)}
.difftag{display:inline-block;margin:0 8px 8px 0;padding:4px 10px;border-radius:999px;
  font-size:12px;background:var(--panel);border:1px solid var(--line)}
.difftag b{font-variant-numeric:tabular-nums}
`.trim();

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

/**
 * A sparkline as inline SVG. Flat series are drawn down the middle rather
 * than at y=0, which is what a naive min/max scale does when every value is
 * identical and it reads as a cliff.
 */
function sparkline(series: TrendSeries): string {
  const values = series.points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length < 2) return '<span style="color:var(--muted)">—</span>';

  const width = 120;
  const height = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) =>
    span === 0 ? height / 2 : height - 2 - ((v - min) / span) * (height - 4);

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastX = x(values.length - 1).toFixed(1);
  const lastY = y(values[values.length - 1]).toFixed(1);
  const label = `${series.label} over ${values.length} runs, ${formatTrendValue(series.unit, min)} to ${formatTrendValue(series.unit, max)}`;
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">
    <polyline class="line" points="${points}"/>
    <circle class="dot" cx="${lastX}" cy="${lastY}" r="2.5"/>
  </svg>`;
}

const DIRECTION_WORD: Record<TrendSeries['direction'], string> = {
  regressed: 'worse',
  improved: 'better',
  flat: 'steady',
  new: 'first',
};

export function renderTrend(trend: TrendReport | undefined): string {
  if (!trend) return '';
  if (trend.runs === 0) {
    return `<h2>Trend</h2><p class="empty">First recorded run for this URL — from the next run on, this section compares against it.</p>`;
  }

  const headlines = trend.headlines.length
    ? `<div class="headlines">${trend.headlines.map((h) => `<p>${escapeHtml(h)}</p>`).join('')}</div>`
    : '';

  const strip = `<ul class="verdictstrip" aria-label="Verdict per run, oldest first">${trend.verdictHistory
    .map(
      (v) =>
        `<li class="${v.verdict}" title="${escapeHtml(`${v.capturedAt}: ${v.verdict}`)}"></li>`,
    )
    .join('')}</ul>`;

  // A series nobody has ever measured is noise, not an absent trend.
  const rows = trend.series
    .filter((s) => s.points.some((p) => p.value !== null))
    .map(
      (s) => `<tr>
        <td><b>${escapeHtml(s.label)}</b></td>
        <td class="num mono">${escapeHtml(formatTrendValue(s.unit, s.previous))}</td>
        <td class="num mono">${escapeHtml(formatTrendValue(s.unit, s.current))}</td>
        <td class="num mono"><span class="dir ${s.direction}">${escapeHtml(formatTrendDelta(s.unit, s.deltaFromPrevious))}</span></td>
        <td class="num mono">${escapeHtml(formatTrendDelta(s.unit, s.deltaFromOldest))}</td>
        <td><span class="dir ${s.direction}">${DIRECTION_WORD[s.direction]}</span></td>
        <td>${sparkline(s)}</td>
      </tr>`,
    )
    .join('');

  return `<h2>Trend — this run against the previous ${trend.runs}</h2>
${headlines}
${strip}
<table><thead><tr>
  <th>Metric</th><th>Last run</th><th>This run</th><th>vs last</th>
  <th>vs ${trend.runs} runs ago</th><th>Direction</th><th>History</th>
</tr></thead><tbody>${rows}</tbody></table>
<p class="note">Window starts ${escapeHtml(trend.windowFrom ?? 'unknown')}. Every metric here is lower-is-better, so a positive delta is a regression.</p>`;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function nodeRows(nodes: StructureNode[], kind: string): string {
  const shown = nodes.slice(0, MAX_DIFF_ROWS);
  const rows = shown
    .map(
      (n) => `<tr>
      <td>${escapeHtml(kind)}</td>
      <td>${escapeHtml(n.role)}</td>
      <td>${n.name ? escapeHtml(n.name) : '<span style="color:var(--muted)">(no accessible name)</span>'}</td>
      <td class="wrap mono">${escapeHtml(n.path)}</td>
    </tr>`,
    )
    .join('');
  const rest = nodes.length - shown.length;
  return rest > 0
    ? `${rows}<tr><td colspan="4" style="color:var(--muted)">…and ${rest} more ${escapeHtml(kind)}</td></tr>`
    : rows;
}

function renderStructure(diff: StructureDiff): string {
  const tags = [
    `<span class="difftag"><b>${diff.gained.length}</b> gained</span>`,
    `<span class="difftag"><b>${diff.lost.length}</b> lost</span>`,
    `<span class="difftag"><b>${diff.renamed.length}</b> renamed</span>`,
    `<span class="difftag"><b>${diff.moved.length}</b> moved</span>`,
    `<span class="difftag"><b>${diff.unchanged}</b> unchanged</span>`,
  ].join('');

  if (diff.changed === 0 && diff.moved.length === 0) {
    return `${tags}<p class="empty">The accessibility tree is identical to the previous run.</p>`;
  }

  const renamedRows = diff.renamed
    .slice(0, MAX_DIFF_ROWS)
    .map(
      (r) => `<tr>
      <td>renamed</td>
      <td>${escapeHtml(r.role)}</td>
      <td>${escapeHtml(r.from ?? '(none)')} → <b>${escapeHtml(r.to ?? '(none)')}</b></td>
      <td class="wrap mono">${escapeHtml(r.path)}</td>
    </tr>`,
    )
    .join('');

  const body = `${nodeRows(diff.gained, 'gained')}${nodeRows(diff.lost, 'lost')}${renamedRows}`;
  return `${tags}
<table><thead><tr><th>Change</th><th>Role</th><th>Accessible name</th><th>Path</th></tr></thead>
<tbody>${body}</tbody></table>
<p class="note">Compared on the accessibility tree, not the DOM: a restyled class name is invisible here, while a control losing its label is not. Elements that only moved are counted but not listed.</p>`;
}

function renderPixels(diff: NonNullable<RunDiff['pixels']>): string {
  if (!diff.comparable)
    return `<p class="empty">${escapeHtml(diff.note ?? 'Pixel diff unavailable.')}</p>`;

  const pct =
    diff.changedPercent === 0
      ? '0'
      : diff.changedPercent < 0.01
        ? '<0.01'
        : diff.changedPercent.toFixed(2);
  const size = diff.sizeChanged
    ? `<span class="difftag">size <b>${diff.previousSize?.width}×${diff.previousSize?.height}</b> → <b>${diff.currentSize?.width}×${diff.currentSize?.height}</b></span>`
    : '';
  const tags = `<span class="difftag"><b>${pct}%</b> of pixels changed</span>
    <span class="difftag"><b>${diff.changedPixels.toLocaleString('en-US')}</b> of ${diff.totalPixels.toLocaleString('en-US')} pixels</span>${size}`;

  if (!diff.diffDataUrl) {
    return `${tags}<p class="empty">The screenshots are pixel-identical.</p>`;
  }
  const scaled = diff.scale
    ? ` Shown at 1/${diff.scale} scale; a change smaller than one output pixel is still marked.`
    : '';
  return `${tags}
<figure>
  <figcaption>Changed pixels in magenta, over this run's screenshot.${escapeHtml(scaled)}</figcaption>
  <img alt="Pixel differences against the previous run" src="${escapeHtml(diff.diffDataUrl)}">
</figure>
<p class="note">Per-channel tolerance is applied before counting, so anti-aliasing and font-hinting jitter do not register as change.</p>`;
}

export function renderDiff(diff: RunDiff | undefined): string {
  if (!diff) return '';
  const notes = diff.notes.length
    ? `<p class="note">${diff.notes.map((n) => escapeHtml(n)).join(' ')}</p>`
    : '';
  const structure = diff.structure
    ? `<h3 style="font-size:13px;color:var(--muted);margin:20px 0 8px">Structure</h3>${renderStructure(diff.structure)}`
    : '';
  const pixels = diff.pixels
    ? `<h3 style="font-size:13px;color:var(--muted);margin:24px 0 8px">Pixels</h3>${renderPixels(diff.pixels)}`
    : '';
  if (!structure && !pixels) {
    return `<h2>Changes since the previous run</h2>${notes || '<p class="empty">Nothing could be compared against the previous run.</p>'}`;
  }
  return `<h2>Changes since the previous run</h2>
<p class="note">Compared against the run of ${escapeHtml(diff.previousCapturedAt)}.</p>
${structure}
${pixels}
${notes}`;
}
