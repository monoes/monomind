/**
 * Budgets are the CI gate, so the parser's job is to be strict: a typo'd key
 * must fail loudly rather than quietly disabling a check.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGET, formatThreshold, loadBudget, parseBudget } from '../report/budget.js';

describe('DEFAULT_BUDGET', () => {
  it('gates on zero errors and the Core Web Vitals "good" boundaries', () => {
    expect(DEFAULT_BUDGET).toMatchObject({
      maxConsoleErrors: 0,
      maxPageErrors: 0,
      maxFailedRequests: 0,
      maxA11yErrors: 0,
      lcpMs: 2500,
      clsScore: 0.1,
      inpMs: 200,
    });
  });
});

describe('parseBudget', () => {
  it('merges over the defaults rather than replacing them', () => {
    const budget = parseBudget({ lcpMs: 4000 });
    expect(budget.lcpMs).toBe(4000);
    expect(budget.maxConsoleErrors).toBe(0);
  });

  it('accepts short and snake_case spellings', () => {
    const budget = parseBudget({ lcp: 3000, cls: 0.25, max_console_errors: 5, 'a11y-errors': 2 });
    expect(budget).toMatchObject({
      lcpMs: 3000,
      clsScore: 0.25,
      maxConsoleErrors: 5,
      maxA11yErrors: 2,
    });
  });

  it('treats null as "do not enforce"', () => {
    expect(parseBudget({ lcp: null }).lcpMs).toBeNull();
  });

  it('rejects an unknown key instead of silently ignoring it', () => {
    expect(() => parseBudget({ maxConsoleError: 0 })).toThrow(/Unknown budget key/);
  });

  it('rejects non-numeric and negative values', () => {
    expect(() => parseBudget({ lcp: 'fast' })).toThrow(/must be a number/);
    expect(() => parseBudget({ lcp: -1 })).toThrow(/negative/);
  });

  it('rejects a non-object budget', () => {
    expect(() => parseBudget([1, 2])).toThrow(/expected a JSON object/);
    expect(() => parseBudget(null)).toThrow(/expected a JSON object/);
  });
});

describe('loadBudget', () => {
  it('returns the defaults when nothing is passed', async () => {
    await expect(loadBudget()).resolves.toEqual(DEFAULT_BUDGET);
  });

  it('parses inline JSON', async () => {
    await expect(loadBudget('{"lcp": 1000}')).resolves.toMatchObject({ lcpMs: 1000 });
  });

  it('reads a budget file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'monobrowse-budget-'));
    const file = join(dir, 'budget.json');
    await writeFile(file, JSON.stringify({ maxFailedRequests: 3 }), 'utf8');
    await expect(loadBudget(file)).resolves.toMatchObject({ maxFailedRequests: 3 });
  });

  it('names the file it could not read', async () => {
    await expect(loadBudget('/nope/does-not-exist.json')).rejects.toThrow(/Budget file not found/);
  });

  it('reports malformed inline JSON as such', async () => {
    await expect(loadBudget('{oops}')).rejects.toThrow(/not valid JSON/);
  });
});

describe('formatThreshold', () => {
  it('units millisecond budgets and leaves counts and scores bare', () => {
    expect(formatThreshold('lcpMs', 2500)).toBe('<= 2500ms');
    expect(formatThreshold('clsScore', 0.1)).toBe('<= 0.1');
    expect(formatThreshold('maxConsoleErrors', 0)).toBe('<= 0');
  });
});
