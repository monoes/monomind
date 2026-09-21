/**
 * `monobrowse report <url>` — open a page, measure it, judge it against a
 * budget, and leave behind one self-contained HTML file plus a sibling JSON.
 *
 * collect.ts (drive the browser) -> analyze.ts (a11y + budgets -> verdict)
 * -> history/trend/diff (what changed since last time) -> render.ts (HTML).
 * This module is the seam that wires them together and writes the two files.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { CdpClient } from '../browser/cdp.js';
import { buildReport, summarizeVerdict } from './analyze.js';
import { loadBudget } from './budget.js';
import type { CollectOptions } from './collect.js';
import { collect } from './collect.js';
import { buildEvidence } from './evidence.js';
import { analyzeFlake, type FlakeReport, summarizeFlake } from './flake.js';
import {
  DEFAULT_HISTORY_MAX,
  type HistoryRun,
  historyDirFor,
  historyRoot,
  listRuns,
  saveRun,
} from './history.js';
import { renderHtml } from './render.js';
import { buildRunDiff } from './run-diff.js';
import { buildTrend } from './trend.js';
import type { Budget, CaptureData, Report } from './types.js';

export * from './a11y.js';
export * from './analyze.js';
export * from './budget.js';
export * from './collect.js';
export * from './collect-a11y.js';
export * from './evidence.js';
export * from './flake.js';
export * from './history.js';
export * from './pixel-diff.js';
export * from './png.js';
export * from './render.js';
export * from './run-diff.js';
export * from './structure.js';
export * from './trend.js';
export * from './types.js';

/** Prior runs a trend is charted over. Older runs stay on disk, off the chart. */
export const DEFAULT_TREND_WINDOW = 10;

export interface RunReportOptions extends CollectOptions {
  /** Output path: a `.html` file, or a directory to drop the default name in. */
  out?: string;
  /** Budget file path or inline JSON. Omitted means DEFAULT_BUDGET. */
  budget?: string | Budget;
  cwd?: string;
  /** Persist this run and compare against previous ones. Default true. */
  history?: boolean;
  /** Runs kept per URL. Default DEFAULT_HISTORY_MAX. */
  historyMax?: number;
  /** Root of the history store. Default `~/.monomind/browser-reports`. */
  historyDir?: string;
  /** Prior runs charted. Default DEFAULT_TREND_WINDOW. */
  trendWindow?: number;
}

export interface ReportResult {
  report: Report;
  htmlPath: string;
  jsonPath: string;
  summary: string;
  /** Present when the run was saved to the history store. */
  historyDir?: string;
  /** Present only for a `--repeat` run (RIG-14); see RepeatResult. */
  flake?: FlakeReport;
}

function slugFor(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-');
    return `${parsed.hostname}${path}`.replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  } catch {
    return (
      url
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'page'
    );
  }
}

function timestamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * Resolve `--out` into an absolute .html path. A path that is an existing
 * directory, or that ends in a separator, gets the generated filename
 * appended — `--out ./reports` should not silently produce a file called
 * `reports`.
 */
export async function resolveOutPath(
  out: string | undefined,
  url: string,
  capturedAt: string,
  cwd: string,
): Promise<string> {
  const defaultName = `monobrowse-report-${slugFor(url)}-${timestamp(capturedAt)}.html`;
  if (!out) return join(cwd, defaultName);

  const abs = isAbsolute(out) ? out : resolve(cwd, out);
  if (/[\\/]$/.test(out)) return join(abs, defaultName);
  const isDir = await stat(abs)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (isDir) return join(abs, defaultName);
  return abs.toLowerCase().endsWith('.html') || abs.toLowerCase().endsWith('.htm')
    ? abs
    : `${abs}.html`;
}

/**
 * The JSON sibling drops the base64 image payloads — they are megabytes of
 * noise for anything reading this programmatically, and the HTML already
 * carries them inline. `path` still points at the PNG on disk. The pixel
 * diff's highlight image and the evidence frames go the same way: every
 * measurement survives, only the pixels are dropped.
 */
export function toJsonReport(report: Report): Record<string, unknown> {
  const { screenshots, recording, diff, evidence, ...rest } = report;
  void recording;
  return {
    ...rest,
    screenshots: screenshots.map(({ label, width, height, path }) => ({
      label,
      width,
      height,
      path,
    })),
    ...(diff
      ? {
          diff: {
            ...diff,
            pixels: diff.pixels ? { ...diff.pixels, diffDataUrl: undefined } : undefined,
          },
        }
      : {}),
    ...(evidence
      ? {
          evidence: {
            ...evidence,
            frames: evidence.frames.map(({ offsetMs, bytes }) => ({ offsetMs, bytes })),
          },
        }
      : {}),
  };
}

export async function writeReportFiles(
  report: Report,
  htmlPath: string,
  extras: { flake?: FlakeReport } = {},
): Promise<{ htmlPath: string; jsonPath: string }> {
  const jsonPath = `${htmlPath.replace(/\.html?$/i, '')}.json`;
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, renderHtml(report, extras), 'utf8');
  const json = extras.flake
    ? { ...toJsonReport(report), flake: extras.flake }
    : toJsonReport(report);
  await writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  return { htmlPath, jsonPath };
}

/**
 * Attach the trend and the diff, then persist the run.
 *
 * Order matters: history is read BEFORE the run is saved, so a run never
 * trends or diffs against itself. A failure anywhere in here becomes a note
 * on the report rather than an error — an unwritable home directory should
 * cost you the trend section, not the report.
 */
async function applyHistory(
  report: Report,
  options: RunReportOptions,
): Promise<string | undefined> {
  if (options.history === false) return undefined;
  const root = options.historyDir ?? historyRoot();
  const dir = historyDirFor(report.url, root);
  try {
    const previous = await listRuns(dir);
    const window = options.trendWindow ?? DEFAULT_TREND_WINDOW;
    report.trend = buildTrend(report, previous.slice(-window));
    report.diff = await buildRunDiff(dir, previous.at(-1), report);
    await saveRun(report, { root, max: options.historyMax ?? DEFAULT_HISTORY_MAX });
    return dir;
  } catch (err) {
    report.notes.push(
      `Run history unavailable (${(err as Error).message}) — no trend or diff for this run.`,
    );
    return undefined;
  }
}

/** Turn the recorder's raw frames into the evidence block, when warranted. */
function applyEvidence(report: Report, data: CaptureData): void {
  const recording = data.recording;
  if (!recording) return;
  if (report.verdict !== 'fail' && !recording.requested) return;
  report.evidence = buildEvidence({
    reason: report.verdict === 'fail' ? 'budget-failure' : 'requested',
    startedAtMs: recording.startedAtMs,
    frames: recording.frames,
    bufferDropped: recording.droppedFrames,
    console: report.console,
    pageErrors: report.pageErrors,
    requests: report.requests,
    failures: report.failures,
  });
}

async function resolveBudget(options: RunReportOptions): Promise<Budget> {
  return options.budget && typeof options.budget === 'object'
    ? options.budget
    : await loadBudget(options.budget as string | undefined);
}

/** One run: collect, judge, compare against history, write the two files. */
export async function runReport(
  client: CdpClient,
  sessionId: string,
  options: RunReportOptions,
): Promise<ReportResult> {
  const budget = await resolveBudget(options);
  const data: CaptureData = await collect(client, sessionId, options);
  const report = buildReport(data, budget);

  applyEvidence(report, data);
  const historyDir = await applyHistory(report, options);
  // Working material, not report content — and megabytes of it.
  report.recording = undefined;

  const htmlPath = await resolveOutPath(
    options.out,
    options.url,
    data.capturedAt,
    options.cwd ?? process.cwd(),
  );
  const paths = await writeReportFiles(report, htmlPath);
  return { report, ...paths, summary: summarizeVerdict(report), historyDir };
}

export interface RepeatResult extends ReportResult {
  flake: FlakeReport;
  /** Every run, in order. `report` is the last of them. */
  reports: Report[];
}

/**
 * `--repeat N`: run the same URL N times and judge the set (RIG-14).
 *
 * Only the last run is written out in full — N runs' worth of inlined
 * screenshots is not something anyone wants on disk — but the flake analysis
 * covers all of them, and it is the flake verdict that decides the exit code.
 * A check that passed three times and failed twice must not exit 0.
 */
export async function runReportRepeated(
  client: CdpClient,
  sessionId: string,
  options: RunReportOptions & { repeat: number },
): Promise<RepeatResult> {
  const times = Math.max(1, Math.floor(options.repeat));
  const budget = await resolveBudget(options);
  const reports: Report[] = [];

  for (let i = 0; i < times; i++) {
    const data = await collect(client, sessionId, options);
    const report = buildReport(data, budget);
    applyEvidence(report, data);
    report.recording = undefined;
    reports.push(report);
  }

  const flake = analyzeFlake(reports);
  const report = reports[reports.length - 1];
  // Only the run we keep is persisted: writing N history entries for one
  // command would let a single `--repeat 20` evict the whole trend window.
  const historyDir = await applyHistory(report, options);

  const htmlPath = await resolveOutPath(
    options.out,
    options.url,
    report.capturedAt,
    options.cwd ?? process.cwd(),
  );
  const paths = await writeReportFiles(report, htmlPath, { flake });
  return { report, reports, flake, ...paths, summary: summarizeFlake(flake), historyDir };
}

/** `--history <url>`: the stored runs for a URL, oldest first. */
export async function readHistory(
  url: string,
  options: { historyDir?: string } = {},
): Promise<{ dir: string; runs: HistoryRun[] }> {
  const dir = historyDirFor(url, options.historyDir ?? historyRoot());
  return { dir, runs: await listRuns(dir) };
}
