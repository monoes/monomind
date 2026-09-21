/**
 * Persistent run history for `monobrowse report` (RIG-13).
 *
 * Every run is appended to a per-URL directory under the monomind data dir,
 * so the next run can say "LCP has crept up 400ms over nine runs" instead of
 * reporting a number with no context. Deliberately not a database: one JSON
 * file per run plus its screenshot is greppable, diffable, rsync-able, and
 * survives this tool being uninstalled.
 *
 *   ~/.monomind/browser-reports/
 *     shop.test-checkout-1f4c9a2b/
 *       url.txt                              <- the full URL, for humans
 *       20260921T100000Z-8f2a1c4d.json       <- HistoryRun
 *       20260921T100000Z-8f2a1c4d.png        <- main screenshot, for the diff
 *
 * Set `MONOBROWSE_HISTORY_DIR` to relocate the root (the tests do).
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pngFromDataUrl } from './png.js';
import type { ImageSize, Report, StructureNode, VerdictValue, VitalsData } from './types.js';

/** Runs kept per URL before the oldest are pruned. Override with --history-max. */
export const DEFAULT_HISTORY_MAX = 20;

/**
 * Screenshots above this are not archived for the diff. A 30MB full-page PNG
 * per run would turn a 20-run history into 600MB on someone's laptop, and the
 * pixel diff is the only consumer.
 */
const MAX_ARCHIVED_SCREENSHOT_BYTES = 8 * 1024 * 1024;

export interface HistoryRun {
  /** `<compact ISO timestamp>-<8 hex>`, also the basename of its files. */
  id: string;
  url: string;
  finalUrl: string;
  title: string;
  capturedAt: string;
  durationMs: number;
  verdict: VerdictValue;
  counts: Report['counts'];
  vitals: VitalsData;
  failures: Array<{ budget: string; expected: string; actual: string }>;
  /** `<rule>@<locator>` per finding, so a11y regressions are attributable. */
  a11ySignatures: string[];
  structure: StructureNode[];
  /** Basename of the sibling PNG, when one was archived. */
  screenshotFile?: string;
  screenshotSize?: ImageSize;
}

export function historyRoot(): string {
  const override = process.env.MONOBROWSE_HISTORY_DIR;
  if (override?.trim()) return override.trim();
  return join(homedir(), '.monomind', 'browser-reports');
}

/**
 * Directory name for a URL: readable prefix plus a hash of the full URL.
 *
 * The hash is what makes it correct — `?page=2` and `?page=3` must not share
 * a history — and the prefix is what makes `ls` useful.
 */
export function historyKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 8);
  let readable: string;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-');
    readable = `${parsed.hostname}${path}`;
  } catch {
    readable = url.replace(/[^a-z0-9]+/gi, '-');
  }
  readable = readable.replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);
  return `${readable || 'page'}-${hash}`;
}

export function historyDirFor(url: string, root = historyRoot()): string {
  return join(root, historyKey(url));
}

export function compactTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export function newRunId(capturedAt: string): string {
  return `${compactTimestamp(capturedAt)}-${randomBytes(4).toString('hex')}`;
}

/** The record we persist — a Report minus the megabytes of inline base64. */
export function toHistoryRun(report: Report, id: string): HistoryRun {
  return {
    id,
    url: report.url,
    finalUrl: report.finalUrl,
    title: report.title,
    capturedAt: report.capturedAt,
    durationMs: report.durationMs,
    verdict: report.verdict,
    counts: report.counts,
    vitals: report.vitals,
    failures: report.failures.map((f) => ({
      budget: String(f.budget),
      expected: f.expected,
      actual: f.actual,
    })),
    a11ySignatures: report.a11y.map((f) => `${f.rule}@${f.locator}`),
    structure: report.structure ?? [],
  };
}

const RUN_FILE = /^(\d{8}T\d{6}Z)-([0-9a-f]{8})\.json$/;

/**
 * Every run for a URL, oldest first.
 *
 * A file that will not parse is skipped rather than thrown: a half-written
 * record from a killed process must not permanently break the next report.
 */
export async function listRuns(dir: string): Promise<HistoryRun[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const runs: HistoryRun[] = [];
  for (const name of names.filter((n) => RUN_FILE.test(n)).sort()) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, name), 'utf8')) as HistoryRun;
      if (parsed && typeof parsed.capturedAt === 'string') runs.push(parsed);
    } catch {
      // Unreadable record — ignore it and carry on.
    }
  }
  return runs.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

/** Delete all but the newest `max` runs, taking each one's PNG with it. */
export async function pruneHistory(dir: string, max: number): Promise<string[]> {
  if (!Number.isFinite(max) || max <= 0) return [];
  const runs = await listRuns(dir);
  if (runs.length <= max) return [];
  const doomed = runs.slice(0, runs.length - max);
  const removed: string[] = [];
  for (const run of doomed) {
    for (const file of [`${run.id}.json`, run.screenshotFile]) {
      if (!file) continue;
      await rm(join(dir, file), { force: true }).catch(() => {});
      removed.push(file);
    }
  }
  return removed;
}

export interface SaveRunOptions {
  root?: string;
  max?: number;
  /** Fixed id, for deterministic tests. */
  id?: string;
}

export interface SaveRunResult {
  dir: string;
  file: string;
  run: HistoryRun;
  pruned: string[];
}

/**
 * Append this run to its URL's history and prune the tail. Callers treat a
 * rejection as non-fatal — a read-only home directory should cost you the
 * trend section, not the report.
 */
export async function saveRun(
  report: Report,
  options: SaveRunOptions = {},
): Promise<SaveRunResult> {
  const root = options.root ?? historyRoot();
  const dir = join(root, historyKey(report.url));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'url.txt'), `${report.url}\n`, 'utf8').catch(() => {});

  const id = options.id ?? newRunId(report.capturedAt);
  const run = toHistoryRun(report, id);

  const main = report.screenshots.find((s) => s.label === 'page') ?? report.screenshots[0];
  if (main?.dataUrl) {
    try {
      const bytes = pngFromDataUrl(main.dataUrl);
      if (bytes.length <= MAX_ARCHIVED_SCREENSHOT_BYTES) {
        const file = `${id}.png`;
        await writeFile(join(dir, file), bytes);
        run.screenshotFile = file;
        run.screenshotSize = { width: main.width, height: main.height };
      }
    } catch {
      // No archived screenshot means no pixel diff next run. Not fatal.
    }
  }

  const file = join(dir, `${id}.json`);
  await writeFile(file, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  const pruned = await pruneHistory(dir, options.max ?? DEFAULT_HISTORY_MAX);
  return { dir, file, run, pruned };
}

export async function loadRunScreenshot(dir: string, run: HistoryRun): Promise<Uint8Array | null> {
  if (!run.screenshotFile) return null;
  try {
    return new Uint8Array(await readFile(join(dir, run.screenshotFile)));
  } catch {
    return null;
  }
}
