/**
 * #155: dashboard's activeOrgs gap-fill never detected a completed run.
 *
 * First fix (event-string mismatch) was correct but insufficient: run_events
 * (SQLite) is populated by LIVE event forwarding while a dashboard is
 * connected, not backfilled from a run's actual bus.jsonl history. A
 * dashboard that starts after a run has already stopped never saw most (or
 * any) of that run's events, including its terminal one — so the corrected
 * query had nothing to match against. Follow-up fix: read runtime.json's own
 * top-level `status` field directly (the exact thing `monomind org status`
 * reads), which is authoritative regardless of dashboard uptime.
 *
 * The gap-fill logic lives inline in server.mjs's startup function, not as
 * an exported unit — tested here via a real temp .monomind/orgs/ tree and
 * source-pattern assertions, matching this file's existing convention.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../ui/server.mjs'), 'utf-8');

describe("dashboard gap-fill reads runtime.json's authoritative status (#155 follow-up)", () => {
  it('no longer scans run_events/bus.jsonl for a terminal signal that may never have been recorded', () => {
    expect(SERVER_SRC).not.toMatch(/SELECT type FROM run_events/);
    expect(SERVER_SRC).not.toMatch(/'bus\.jsonl'/);
  });

  it("checks runtime.json's status field directly, matching what `monomind org status` reads", () => {
    expect(SERVER_SRC).toMatch(/_gfRt\.status === 'running'/);
  });

  it('treats a "running" record with a dead pid as not-active too, mirroring org.ts\'s statusAction', () => {
    expect(SERVER_SRC).toMatch(/process\.kill\(_gfRt\.pid, 0\)/);
  });

  // The gap-fill's org-directory scan is duplicated below rather than
  // imported, since it's inline in a large startup function rather than an
  // exported unit — this exercises the real decision logic (runtime.json ->
  // pid liveness -> activeOrgRuns) against a real filesystem, not just a
  // source-pattern match.
  function readActiveOrgRuns(orgsDir: string): Map<string, string> {
    const activeOrgRuns = new Map<string, string>();
    const fs = require('node:fs');
    if (!fs.existsSync(orgsDir)) return activeOrgRuns;
    for (const org of fs.readdirSync(orgsDir)) {
      if (!org || org.startsWith('.') || !/^[a-z0-9][a-z0-9_-]*$/i.test(org)) continue;
      try {
        const runtimePath = join(orgsDir, org, 'runtime.json');
        if (!fs.existsSync(runtimePath)) continue;
        const rt = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
        const runId = typeof rt?.run === 'string' ? rt.run : null;
        if (!runId) continue;
        let active = rt.status === 'running';
        if (active && typeof rt.pid === 'number') {
          try {
            process.kill(rt.pid, 0);
          } catch {
            active = false;
          }
        }
        if (active) activeOrgRuns.set(org, runId);
      } catch {
        /* ignore */
      }
    }
    return activeOrgRuns;
  }

  function writeRuntime(orgsDir: string, org: string, data: Record<string, unknown>) {
    const dir = join(orgsDir, org);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'runtime.json'), JSON.stringify(data));
  }

  it("reports a stopped org (per #155's original repro: 585+ real events, zero in run_events) as not active", () => {
    const orgsDir = mkdtempSync(join(tmpdir(), 'gf155-'));
    writeRuntime(orgsDir, 'monoterminal-dev', {
      status: 'stopped',
      run: 'run-20260815055321-dfsg',
    });
    const active = readActiveOrgRuns(orgsDir);
    expect(active.has('monoterminal-dev')).toBe(false);
  });

  it('reports a genuinely running org (live pid) as active', () => {
    const orgsDir = mkdtempSync(join(tmpdir(), 'gf155-'));
    writeRuntime(orgsDir, 'liveorg', { status: 'running', run: 'run-1', pid: process.pid });
    const active = readActiveOrgRuns(orgsDir);
    expect(active.get('liveorg')).toBe('run-1');
  });

  it('does not report a "running" record as active when its pid is dead (daemon died without stopOrg cleanup)', () => {
    const orgsDir = mkdtempSync(join(tmpdir(), 'gf155-'));
    // pid 999999 is extremely unlikely to be alive on any test machine.
    writeRuntime(orgsDir, 'crashedorg', { status: 'running', run: 'run-2', pid: 999999 });
    const active = readActiveOrgRuns(orgsDir);
    expect(active.has('crashedorg')).toBe(false);
  });
});
