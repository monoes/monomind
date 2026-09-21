/**
 * Budget parsing for `monobrowse report`.
 *
 * A budget is what turns "the agent looked at the page" into "the agent
 * tested the page": the thresholds the run is gated on. Defaults are the
 * strict ones you actually want in CI — zero errors, zero failed requests,
 * Core Web Vitals at Google's "good" boundary.
 */

import { readFile } from 'node:fs/promises';
import type { Budget } from './types.js';

export const DEFAULT_BUDGET: Budget = {
  maxConsoleErrors: 0,
  maxPageErrors: 0,
  maxFailedRequests: 0,
  maxA11yErrors: 0,
  lcpMs: 2500,
  clsScore: 0.1,
  inpMs: 200,
  fcpMs: null,
  ttfbMs: null,
};

/** Every spelling we accept, normalized (lowercased, `_`/`-` stripped). */
const KEY_ALIASES: Record<string, keyof Budget> = {
  maxconsoleerrors: 'maxConsoleErrors',
  consoleerrors: 'maxConsoleErrors',
  maxpageerrors: 'maxPageErrors',
  pageerrors: 'maxPageErrors',
  maxfailedrequests: 'maxFailedRequests',
  failedrequests: 'maxFailedRequests',
  maxa11yerrors: 'maxA11yErrors',
  a11yerrors: 'maxA11yErrors',
  maxaccessibilityerrors: 'maxA11yErrors',
  lcp: 'lcpMs',
  lcpms: 'lcpMs',
  cls: 'clsScore',
  clsscore: 'clsScore',
  inp: 'inpMs',
  inpms: 'inpMs',
  fcp: 'fcpMs',
  fcpms: 'fcpMs',
  ttfb: 'ttfbMs',
  ttfbms: 'ttfbMs',
};

const BUDGET_UNITS: Record<keyof Budget, 'ms' | 'score' | 'count'> = {
  maxConsoleErrors: 'count',
  maxPageErrors: 'count',
  maxFailedRequests: 'count',
  maxA11yErrors: 'count',
  lcpMs: 'ms',
  clsScore: 'score',
  inpMs: 'ms',
  fcpMs: 'ms',
  ttfbMs: 'ms',
};

const BUDGET_LABELS: Record<keyof Budget, string> = {
  maxConsoleErrors: 'Console errors',
  maxPageErrors: 'Uncaught page errors',
  maxFailedRequests: 'Failed requests',
  maxA11yErrors: 'Accessibility errors',
  lcpMs: 'LCP (Largest Contentful Paint)',
  clsScore: 'CLS (Cumulative Layout Shift)',
  inpMs: 'INP (Interaction to Next Paint)',
  fcpMs: 'FCP (First Contentful Paint)',
  ttfbMs: 'TTFB (Time to First Byte)',
};

export function budgetLabel(key: keyof Budget): string {
  return BUDGET_LABELS[key];
}

/** `2500` -> `<= 2500ms`, `0` -> `<= 0`, `0.1` -> `<= 0.1`. */
export function formatThreshold(key: keyof Budget, value: number): string {
  const unit = BUDGET_UNITS[key];
  if (unit === 'ms') return `<= ${value}ms`;
  return `<= ${value}`;
}

function normalizeKey(raw: string): string {
  return raw.toLowerCase().replace(/[_\-\s]/g, '');
}

/**
 * Turn a parsed JSON object into a Budget, merged over the defaults.
 *
 * Unknown keys throw rather than being ignored: a typo'd `max_console_error`
 * silently loosening a CI gate is exactly the failure mode budgets exist to
 * prevent.
 */
export function parseBudget(input: unknown, source = 'budget'): Budget {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`Invalid ${source}: expected a JSON object of budget keys`);
  }

  const budget: Budget = { ...DEFAULT_BUDGET };
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = KEY_ALIASES[normalizeKey(rawKey)];
    if (!key) {
      throw new Error(
        `Unknown budget key "${rawKey}" in ${source}. Known keys: ${Object.keys(DEFAULT_BUDGET).join(', ')}`,
      );
    }
    if (rawValue === null) {
      budget[key] = null;
      continue;
    }
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw new Error(
        `Budget "${rawKey}" must be a number or null, got ${JSON.stringify(rawValue)}`,
      );
    }
    if (rawValue < 0) {
      throw new Error(`Budget "${rawKey}" must not be negative, got ${rawValue}`);
    }
    budget[key] = rawValue;
  }
  return budget;
}

/**
 * Resolve `--budget`. The value is either inline JSON (starts with `{`) or a
 * path to a JSON file. Omitted means DEFAULT_BUDGET.
 */
export async function loadBudget(spec?: string): Promise<Budget> {
  if (spec === undefined || spec === '') return { ...DEFAULT_BUDGET };

  const trimmed = spec.trim();
  if (trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`--budget is not valid JSON: ${(err as Error).message}`);
    }
    return parseBudget(parsed, 'inline --budget');
  }

  let text: string;
  try {
    text = await readFile(trimmed, 'utf8');
  } catch {
    throw new Error(`Budget file not found or unreadable: ${trimmed}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Budget file ${trimmed} is not valid JSON: ${(err as Error).message}`);
  }
  return parseBudget(parsed, trimmed);
}
