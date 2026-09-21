/**
 * Report sections for the recorded evidence timeline (RIG-11) and the flake
 * analysis (RIG-14).
 *
 * The evidence section is written to be read the way someone triages a bug:
 * a filmstrip of what the page looked like either side of the failure, then
 * one time-ordered list mixing frames, console output and network failures,
 * so "the error fired, then the screen went blank" is visible rather than
 * inferred.
 */

import type { FlakeCheck, FlakeReport } from './flake.js';
import type { Evidence, TimelineEntry } from './types.js';
import { escapeHtml } from './util.js';

export const EVIDENCE_STYLES = `
.filmstrip{display:flex;gap:10px;overflow-x:auto;padding:4px 0 10px;margin:0 0 8px}
.filmstrip figure{flex:0 0 auto;width:180px;margin:0}
.filmstrip img{width:180px;height:auto;border-radius:6px}
.filmstrip figcaption{font-variant-numeric:tabular-nums}
.filmstrip figure.focus img{border-color:var(--fail);border-width:2px}
.timeline{list-style:none;margin:0;padding:0;border-left:2px solid var(--line);
  margin-left:8px}
.timeline li{position:relative;padding:6px 0 6px 18px;font-size:13px}
.timeline li::before{content:"";position:absolute;left:-5px;top:12px;width:8px;height:8px;
  border-radius:50%;background:var(--muted)}
.timeline li.error::before{background:var(--fail)}
.timeline li.warning::before{background:var(--warn)}
.timeline li.marker{font-weight:600;color:var(--fail)}
.timeline .at{display:inline-block;min-width:66px;color:var(--muted);
  font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.verdict.flaky{background:var(--warn-bg);border-color:var(--warn);color:var(--warn)}
.rate{display:inline-block;min-width:72px}
.bar{display:inline-block;width:80px;height:8px;border-radius:4px;background:var(--pass);
  overflow:hidden;vertical-align:middle}
.bar i{display:block;height:100%;background:var(--fail)}
`.trim();

function at(offsetMs: number): string {
  const sign = offsetMs < 0 ? '−' : '+';
  const abs = Math.abs(offsetMs);
  return abs >= 1000 ? `${sign}${(abs / 1000).toFixed(2)}s` : `${sign}${Math.round(abs)}ms`;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

function renderFilmstrip(evidence: Evidence): string {
  if (!evidence.frames.length) return '';
  // Mark the frame closest to the failure so the eye lands on it first.
  let focusIndex = -1;
  if (evidence.focusOffsetMs !== null) {
    let best = Infinity;
    evidence.frames.forEach((f, i) => {
      const d = Math.abs(f.offsetMs - (evidence.focusOffsetMs as number));
      if (d < best) {
        best = d;
        focusIndex = i;
      }
    });
  }
  const figures = evidence.frames
    .map(
      (f, i) => `<figure class="${i === focusIndex ? 'focus' : ''}">
      <figcaption>${escapeHtml(at(f.offsetMs))}${i === focusIndex ? ' · at failure' : ''}</figcaption>
      <img alt="${escapeHtml(`Frame at ${at(f.offsetMs)}`)}" src="${escapeHtml(f.dataUrl)}">
    </figure>`,
    )
    .join('');
  return `<div class="filmstrip">${figures}</div>`;
}

function renderTimelineRows(timeline: TimelineEntry[]): string {
  if (!timeline.length) return '<p class="empty">Nothing was recorded for this run.</p>';
  const rows = timeline
    .map((e) => {
      const detail = e.detail ? ` — ${escapeHtml(e.detail)}` : '';
      const frame =
        e.kind === 'frame' && e.frameIndex !== undefined
          ? ` <span style="color:var(--muted)">#${e.frameIndex + 1}</span>`
          : '';
      return `<li class="${e.severity}${e.kind === 'marker' ? ' marker' : ''}">
        <span class="at">${escapeHtml(at(e.offsetMs))}</span>${escapeHtml(e.label)}${frame}${detail}
      </li>`;
    })
    .join('');
  return `<ul class="timeline">${rows}</ul>`;
}

export function renderEvidence(evidence: Evidence | undefined): string {
  if (!evidence) return '';
  const why =
    evidence.reason === 'budget-failure'
      ? 'Recorded because this run breached its budget.'
      : 'Recorded because --record was passed.';
  const focus =
    evidence.focusOffsetMs !== null
      ? ` The timeline is centred on the first failure, at ${at(evidence.focusOffsetMs)} into the run.`
      : '';
  const notes = evidence.notes.length
    ? `<p class="note">${evidence.notes.map((n) => escapeHtml(n)).join(' ')}</p>`
    : '';

  return `<h2>Evidence</h2>
<p class="note">${escapeHtml(why)}${escapeHtml(focus)} Offsets are measured from the start of the run.</p>
${renderFilmstrip(evidence)}
${renderTimelineRows(evidence.timeline)}
${notes}`;
}

// ---------------------------------------------------------------------------
// Flake
// ---------------------------------------------------------------------------

function rateBar(check: FlakeCheck): string {
  const pct = Math.round(check.flakeRate * 100);
  return `<span class="bar" role="img" aria-label="${escapeHtml(`failed ${pct}% of runs`)}"><i style="width:${pct}%"></i></span>`;
}

function renderChecks(flake: FlakeReport): string {
  const rows = flake.checks
    // Unstable checks first: they are the reason this section exists.
    .sort((a, b) => Number(a.stable) - Number(b.stable) || b.flakeRate - a.flakeRate)
    .map(
      (c) => `<tr>
      <td>${escapeHtml(c.label)}</td>
      <td class="num mono"><span class="rate">${c.passed} of ${c.runs} passed</span></td>
      <td>${rateBar(c)}</td>
      <td>${c.stable ? (c.failed ? '<span class="pill error">always fails</span>' : '<span class="pill good">stable</span>') : '<span class="pill warning">flaky</span>'}</td>
      <td class="wrap mono">${escapeHtml(c.actuals.join(', '))}</td>
    </tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Check</th><th>Outcome</th><th>Failure rate</th><th></th><th>Measured each run</th></tr></thead>
  <tbody>${rows}</tbody></table>`;
}

function renderSignals(flake: FlakeReport): string {
  if (!flake.signals.length) {
    return '<p class="empty">No error or failed request came and went between runs.</p>';
  }
  const rows = flake.signals
    .slice(0, 30)
    .map(
      (s) => `<tr>
      <td>${escapeHtml(s.kind)}</td>
      <td class="wrap">${escapeHtml(s.signature)}</td>
      <td class="num mono">${s.runs} of ${s.total}</td>
    </tr>`,
    )
    .join('');
  return `<table><thead><tr><th>Kind</th><th>Signal</th><th>Appeared in</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="note">Ids, hashes and long numbers are normalised before grouping, so one intermittent error is one row rather than N.</p>`;
}

function renderMetricSpread(flake: FlakeReport): string {
  if (!flake.metrics.length) return '';
  const rows = flake.metrics
    .map((m) => {
      const fmt = (v: number) =>
        m.unit === 'score'
          ? v.toFixed(3)
          : v >= 1000
            ? `${(v / 1000).toFixed(2)}s`
            : `${Math.round(v)}ms`;
      return `<tr>
        <td><b>${escapeHtml(m.label)}</b></td>
        <td class="num mono">${escapeHtml(fmt(m.min))} – ${escapeHtml(fmt(m.max))}</td>
        <td class="num mono">${escapeHtml(fmt(m.median))}</td>
        <td class="num mono">${escapeHtml(fmt(m.spread))}</td>
        <td>${m.unstable ? '<span class="pill warning">varies widely</span>' : '<span class="pill good">consistent</span>'}</td>
        <td class="num mono">${m.measured} of ${m.total}</td>
      </tr>`;
    })
    .join('');
  return `<h3 style="font-size:13px;color:var(--muted);margin:24px 0 8px">Metric spread</h3>
  <table><thead><tr><th>Metric</th><th>Range</th><th>Median</th><th>Spread</th><th></th><th>Measured</th></tr></thead>
  <tbody>${rows}</tbody></table>`;
}

export function renderFlake(flake: FlakeReport | undefined): string {
  if (!flake) return '';
  return `<h2>Repeatability — ${flake.runs} runs</h2>
<section class="verdict ${flake.verdict === 'pass' ? 'pass' : flake.verdict === 'fail' ? 'fail' : 'flaky'}">
  <div class="tag">${flake.verdict.toUpperCase()}</div>
  <div class="line">${escapeHtml(flake.headline)}</div>
</section>
<p class="note"><b>Confidence: ${escapeHtml(flake.confidence)}.</b> ${escapeHtml(flake.confidenceNote)}</p>
${renderChecks(flake)}
<h3 style="font-size:13px;color:var(--muted);margin:24px 0 8px">Intermittent errors and requests</h3>
${renderSignals(flake)}
${renderMetricSpread(flake)}`;
}
