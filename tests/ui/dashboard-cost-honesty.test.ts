/**
 * The dashboard must not present an unpriced session as a priced one.
 *
 * The server sets `costIncomplete` when at least one model had no pricing row,
 * and documents `totalCost` as a LOWER BOUND in that case — the unpriced
 * model's spend is missing from the sum entirely. Exactly one of the ~20 cost
 * renderings in dashboard.html honoured that; the rest printed the number as
 * though it were exact.
 *
 * The damaging case is when NOTHING could be priced: the sum stays 0 and the UI
 * reported "$0.00", which reads as "this session was free" rather than "we
 * could not price it". That is the same fabricated-zero class already fixed in
 * `status`, where one unguarded access made every panel report zeros.
 *
 * dashboard.html is a single ~10k-line file with one inline <script>, so there
 * is no module to import. These tests extract the shipped source and evaluate
 * it, which keeps the assertions against the real code rather than a copy.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DASHBOARD = join(process.cwd(), 'packages/@monomind/cli/src/ui/dashboard.html');

function loadHelpers(): {
  fmtCost: (v: unknown, incomplete?: boolean, digits?: number) => string;
  anyCostIncomplete: (sessions: unknown[]) => boolean;
} {
  const html = readFileSync(DASHBOARD, 'utf-8');
  const script = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  if (!script) throw new Error('dashboard.html has no inline <script> block');

  const fmt = /function fmtCost\([\s\S]*?\n\}/.exec(script)?.[0];
  const any = /function anyCostIncomplete\([\s\S]*?\n\}/.exec(script)?.[0];
  if (!fmt || !any) {
    throw new Error('fmtCost/anyCostIncomplete not found — did the cost helpers get renamed?');
  }
  return new Function(`${fmt}\n${any}\nreturn { fmtCost, anyCostIncomplete };`)() as ReturnType<
    typeof loadHelpers
  >;
}

describe('dashboard cost rendering is honest about what it could price', () => {
  const { fmtCost, anyCostIncomplete } = loadHelpers();

  it('prints an exact figure when every model was priced', () => {
    expect(fmtCost(1.234, false)).toBe('$1.23');
    expect(fmtCost(0, false)).toBe('$0.00'); // genuinely free, and known to be
  });

  it('marks a partial total as a floor rather than a figure', () => {
    expect(fmtCost(1.234, true)).toBe('≥$1.23');
  });

  it('refuses to render $0.00 when nothing could be priced', () => {
    // The regression: a session that may have cost real money reported "$0.00".
    const rendered = fmtCost(0, true);
    expect(rendered).not.toContain('0.00');
    expect(rendered).toBe('unpriced');
  });

  it('honours the requested precision', () => {
    expect(fmtCost(1.23456, false, 3)).toBe('$1.235');
    expect(fmtCost(1.23456, true, 3)).toBe('≥$1.235');
  });

  it('treats a missing or non-numeric cost as zero', () => {
    expect(fmtCost(undefined, false)).toBe('$0.00');
    expect(fmtCost(null, true)).toBe('unpriced');
  });

  it('propagates incompleteness across an aggregated set', () => {
    expect(anyCostIncomplete([{ costIncomplete: false }, { costIncomplete: true }])).toBe(true);
    expect(anyCostIncomplete([{ costIncomplete: false }])).toBe(false);
    expect(anyCostIncomplete([])).toBe(false);
    // Aggregates are built from arrays that may contain holes.
    expect(anyCostIncomplete([null, undefined])).toBe(false);
  });
});

describe('dashboard.html stays parseable', () => {
  it('its inline script has no syntax errors', () => {
    const html = readFileSync(DASHBOARD, 'utf-8');
    const script = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1] ?? '';
    expect(script.length).toBeGreaterThan(0);
    // The cost edits touched nested template literals, which are easy to break
    // and would otherwise only surface in a browser.
    expect(() => new Function(script)).not.toThrow();
  });
});
