/**
 * i-052 commit 3 — `.monomind/dashboard-token` is gitignored by default
 * since commits 1-2, but `.gitignore` does nothing once a path is already
 * tracked, which is the actual shape of the live incident this item fixes.
 * `detectDashboardTokenLeak`/`formatDashboardTokenLeakWarning` are the
 * `init`-time detector (a sibling of `detectMonoesTokenLeak`, which checks
 * a different credential — see that function's own file for why these are
 * deliberately separate rather than merged).
 *
 * Plan §5b amendment: `detectDashboardTokenLeak` takes an injectable
 * `opts.isTracked` seam so its branch logic is unit-testable with no real
 * git repo at all — proven below in the "seam" describe block. The
 * "real git" describe block below it is the integration confirmation that
 * the DEFAULT (no `opts.isTracked` override) wiring actually calls real
 * git correctly. Neither substitutes for the other.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DASHBOARD_TOKEN_BURNED_NOTICE,
  detectDashboardTokenLeak,
  formatDashboardTokenLeakWarning,
} from '../mcp/monoes-mcp-entry.mjs';

describe('detectDashboardTokenLeak — injectable seam, no real git (i-052 plan §5b)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monomind-dashboard-token-seam-'));
    mkdirSync(join(dir, '.monomind'), { recursive: true });
    writeFileSync(join(dir, '.monomind', 'dashboard-token'), 'fake-token-value-should-never-print');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the untracked branch: isTracked resolving false produces no reasons', async () => {
    const reasons = await detectDashboardTokenLeak(dir, { isTracked: async () => false });
    expect(reasons).toEqual([]);
    expect(formatDashboardTokenLeakWarning(reasons)).toBeNull();
  });

  it('the tracked branch: isTracked resolving true names the file, never the value', async () => {
    const reasons = await detectDashboardTokenLeak(dir, { isTracked: async () => true });
    expect(reasons.some((r) => r.includes('.monomind/dashboard-token'))).toBe(true);
    expect(reasons.join(' ')).not.toContain('fake-token-value-should-never-print');
  });

  it('does not call isTracked at all when the file does not exist — nothing to check', async () => {
    rmSync(join(dir, '.monomind', 'dashboard-token'));
    let called = false;
    const reasons = await detectDashboardTokenLeak(dir, {
      isTracked: async () => {
        called = true;
        return true;
      },
    });
    expect(called).toBe(false);
    expect(reasons).toEqual([]);
  });

  it('formatDashboardTokenLeakWarning: names the file, gives the untrack command, states the burned notice by identity, never a value', async () => {
    const reasons = await detectDashboardTokenLeak(dir, { isTracked: async () => true });
    const warning = formatDashboardTokenLeakWarning(reasons);
    expect(warning).toBeTruthy();
    // (a) names the file
    expect(warning).toContain('.monomind/dashboard-token');
    // (c) the exact remedy — an ignore-line addition does nothing for an
    // already-tracked file
    expect(warning).toContain('git rm --cached .monomind/dashboard-token');
    // (d) by identity against the export, not a substring guess (i-050's
    // AC-3 amendment pattern, applied here per plan §5b)
    expect(warning).toContain(DASHBOARD_TOKEN_BURNED_NOTICE);
    // (b) never the value
    expect(warning).not.toContain('fake-token-value-should-never-print');
  });
});

describe('detectDashboardTokenLeak — real git, default wiring (integration confirmation)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monomind-dashboard-token-realgit-'));
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    mkdirSync(join(dir, '.monomind'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('AC-7 (control): file exists but is untracked — no warning', async () => {
    writeFileSync(join(dir, '.monomind', 'dashboard-token'), 'untracked-fake-token');
    const reasons = await detectDashboardTokenLeak(dir);
    expect(reasons).toEqual([]);
    expect(formatDashboardTokenLeakWarning(reasons)).toBeNull();
  });

  it('AC-5: a git-tracked dashboard-token is detected and warned about, with the default (real git) wiring', async () => {
    const secret = /* value */ 'FAKE-DASHBOARD-TOKEN-should-never-print';
    writeFileSync(join(dir, '.monomind', 'dashboard-token'), secret);
    execFileSync('git', ['add', '.monomind/dashboard-token'], { cwd: dir });

    const reasons = await detectDashboardTokenLeak(dir);
    expect(reasons.some((r) => r.includes('.monomind/dashboard-token'))).toBe(true);

    const warning = formatDashboardTokenLeakWarning(reasons);
    expect(warning).toContain('.monomind/dashboard-token');
    expect(warning).toContain('git rm --cached .monomind/dashboard-token');
    expect(warning).toContain(DASHBOARD_TOKEN_BURNED_NOTICE);
    expect(warning).not.toContain(secret);
  });

  it('a file with no directory at all produces no reasons — nothing to check', async () => {
    const reasons = await detectDashboardTokenLeak(dir);
    expect(reasons).toEqual([]);
  });
});
