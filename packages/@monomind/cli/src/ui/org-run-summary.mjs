// Reads of Org Runtime v2 run buses for the dashboard's run list and run
// detail (routes-org-runs.mjs): a summary per bus.jsonl, how each run ended,
// and a bounded window of raw events.
import fs from 'node:fs';
import path from 'node:path';
import { companionEvents, translate } from '../orgrt/forwarder.js';
import { fileLines, recordedStatus } from './org-runtime.mjs';
import { _readTailLines } from './server-fileutils.mjs';

const parseJson = (l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
};

// A run's bus.jsonl reaches tens of MB and the list summarizes up to 50 per
// request: summarize each file version once (a finished run never changes).
const v2SummaryCache = new Map();
const V2_SUMMARY_MAX = 256;

/** What the run list shows of one bus.jsonl, independent of how the run
 *  ended (that comes from history.jsonl / runtime.json, see v2RunStatus). */
export function v2Summary(busFile) {
  const st = fs.statSync(busFile);
  const hit = v2SummaryCache.get(busFile);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.summary;
  let count = 0;
  let startedAt = 0;
  let done = null;
  let start = null;
  let firstComms = null;
  let cycles = 0;
  for (const line of fileLines(busFile)) {
    const e = line ? parseJson(line) : null;
    if (!e) continue;
    count += 1;
    if (count === 1) startedAt = e.ts || 0;
    for (const t of [...companionEvents(e), translate(e)]) {
      if (!done && (t.type === 'session:complete' || t.type === 'org:complete')) done = t;
      else if (!start && t.type === 'org:start') start = t;
      else if (!firstComms && t.type === 'org:comms' && t.msg) firstComms = t;
      if (t.type === 'org:checkpoint') cycles += 1;
    }
  }
  const summary = count
    ? {
        startedAt,
        endedAt: done?.ts || 0,
        done: !!done,
        eventCount: count,
        cycleCount: cycles,
        goal: start?.goal || firstComms?.msg?.slice(0, 80) || '',
        mtimeMs: st.mtimeMs,
      }
    : null;
  v2SummaryCache.delete(busFile);
  v2SummaryCache.set(busFile, { size: st.size, mtimeMs: st.mtimeMs, summary });
  if (v2SummaryCache.size > V2_SUMMARY_MAX)
    v2SummaryCache.delete(v2SummaryCache.keys().next().value);
  return summary;
}

/** A v2 run's status. A bus without a completion event is 'running' only when
 *  the runtime still says so: history.jsonl records how every run ended
 *  (closedBy), and runtime.json names the current run and whether its pid is
 *  alive. A crashed or killed run is 'stale', not 'running' forever. */
export function v2RunStatus(orgDir, runId, summary) {
  if (summary.done) return { status: 'complete', closedBy: null };
  let ended;
  try {
    ended = _readTailLines(path.join(orgDir, 'history.jsonl'), 1024 * 1024)
      .map(parseJson)
      .findLast((h) => h?.run === runId);
  } catch {
    // no history yet: the run has not ended
  }
  if (ended) {
    return {
      status: ended.closedBy === 'org-complete' ? 'complete' : 'stale',
      closedBy: ended.closedBy ?? null,
    };
  }
  let runtime = null;
  try {
    runtime = JSON.parse(fs.readFileSync(path.join(orgDir, 'runtime.json'), 'utf8'));
  } catch {
    // no runtime record: fall back to how recently the bus changed
    return {
      status: Date.now() - summary.mtimeMs > 30 * 60 * 1000 ? 'stale' : 'running',
      closedBy: null,
    };
  }
  if (runtime.run !== runId) return { status: 'stale', closedBy: runtime.closedBy ?? null };
  const rec = recordedStatus(runtime);
  return {
    status: rec === 'running' ? 'running' : rec === 'complete' ? 'complete' : 'stale',
    closedBy: runtime.closedBy ?? null,
  };
}

// Run detail is capped: the newest EVENTS_DEFAULT_LIMIT raw events unless the
// caller pages with ?limit=&offset=.
export const EVENTS_DEFAULT_LIMIT = 20000;
export const EVENTS_MAX_LIMIT = 100000;

/** The raw events of one bus.jsonl in a window, plus the file's total. */
export function v2Window(busFile, qs) {
  const limit = Math.min(
    Math.max(Number.parseInt(qs.get('limit') ?? '', 10) || EVENTS_DEFAULT_LIMIT, 1),
    EVENTS_MAX_LIMIT,
  );
  const wanted =
    qs.get('offset') === null ? null : Math.max(Number.parseInt(qs.get('offset'), 10) || 0, 0);
  const kept = [];
  let total = 0;
  for (const line of fileLines(busFile)) {
    if (!line) continue;
    const idx = total++;
    if (wanted === null) {
      kept.push(line);
      if (kept.length > limit) kept.shift();
    } else if (idx >= wanted && idx < wanted + limit) kept.push(line);
  }
  const offset = wanted ?? Math.max(0, total - kept.length);
  return { raw: kept.map(parseJson).filter(Boolean), total, offset };
}
