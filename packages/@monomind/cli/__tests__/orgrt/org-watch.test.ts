// packages/@monomind/cli/__tests__/orgrt/org-watch.test.ts
// `org watch <org> <role>` — a thin, role-filtered front door onto the same
// bus.jsonl every runtime already writes 'chat' events to (session.ts's
// shared message loop), so this needs no runtime-specific plumbing to test.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchAction } from '../../src/commands/org-observe.js';
import { ORG_DIR, type BusEvent } from '../../src/orgrt/types.js';

const RUN = 'run-20250130120000-abc';

function setupOrgRun(cwd: string, orgName: string, events: BusEvent[]): void {
  mkdirSync(join(cwd, ORG_DIR, orgName, RUN), { recursive: true });
  writeFileSync(
    join(cwd, ORG_DIR, orgName, RUN, 'bus.jsonl'),
    events.map(e => JSON.stringify(e)).join('\n') + '\n',
  );
}

function captureLog(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { output.push(a.join(' ')); });
  return { output, restore: () => spy.mockRestore() };
}

describe('org watch', () => {
  it('requires a role argument', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-watch-'));
    const res = await watchAction({ args: ['test'], flags: { follow: false }, cwd, interactive: false } as any, 'test');
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/usage: monomind org watch/);
  });

  it('reports no runs when the org has never been started', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-watch-'));
    const res = await watchAction({ args: ['test', 'researcher'], flags: { follow: false }, cwd, interactive: false } as any, 'test');
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/no runs found/);
  });

  it('prints only chat events from the requested role, ignoring other event types and other roles', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-watch-'));
    const events: BusEvent[] = [
      { id: '1', ts: 1000, org: 'test', run: RUN, type: 'status', from: 'researcher', msg: 'session starting' },
      { id: '2', ts: 2000, org: 'test', run: RUN, type: 'chat', from: 'researcher', msg: 'Looking into the pricing data now.' },
      { id: '3', ts: 3000, org: 'test', run: RUN, type: 'tool', from: 'researcher', tool: 'Bash', decision: 'allow', data: {} },
      { id: '4', ts: 4000, org: 'test', run: RUN, type: 'chat', from: 'coder', msg: 'Implementing the fix.' },
      { id: '5', ts: 5000, org: 'test', run: RUN, type: 'chat', from: 'researcher', msg: 'Found three relevant comparables.' },
    ];
    setupOrgRun(cwd, 'test', events);

    const { output, restore } = captureLog();
    const res = await watchAction({ args: ['test', 'researcher'], flags: { follow: false }, cwd, interactive: false } as any, 'test');
    restore();

    expect(res.success).toBe(true);
    const text = output.join('\n');
    expect(text).toContain('Looking into the pricing data now.');
    expect(text).toContain('Found three relevant comparables.');
    expect(text).not.toContain('Implementing the fix.'); // coder's chat, not researcher's
    expect(text).not.toContain('session starting'); // status event, not chat
  });

  it('respects an explicit --run id instead of always using the latest', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-watch-'));
    const olderRun = 'run-20250101000000-old';
    mkdirSync(join(cwd, ORG_DIR, 'test', olderRun), { recursive: true });
    writeFileSync(
      join(cwd, ORG_DIR, 'test', olderRun, 'bus.jsonl'),
      JSON.stringify({ id: '1', ts: 1, org: 'test', run: olderRun, type: 'chat', from: 'researcher', msg: 'from the older run' } as BusEvent) + '\n',
    );
    setupOrgRun(cwd, 'test', [
      { id: '2', ts: 2, org: 'test', run: RUN, type: 'chat', from: 'researcher', msg: 'from the latest run' },
    ]);

    const { output, restore } = captureLog();
    const res = await watchAction({ args: ['test', 'researcher'], flags: { follow: false, run: olderRun }, cwd, interactive: false } as any, 'test');
    restore();

    expect(res.success).toBe(true);
    const text = output.join('\n');
    expect(text).toContain('from the older run');
    expect(text).not.toContain('from the latest run');
  });

  it('hides status events by default and shows them with --verbose', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-watch-'));
    setupOrgRun(cwd, 'test', [
      { id: '1', ts: 1, org: 'test', run: RUN, type: 'status', from: 'researcher', reason: 'agent-restart', msg: 'agent "researcher" crashed — restarting in 1000ms' },
      { id: '2', ts: 2, org: 'test', run: RUN, type: 'chat', from: 'researcher', msg: 'back at it' },
    ]);

    const quiet = captureLog();
    const quietRes = await watchAction({ args: ['test', 'researcher'], flags: { follow: false }, cwd, interactive: false } as any, 'test');
    quiet.restore();
    expect(quietRes.success).toBe(true);
    expect(quiet.output.join('\n')).not.toContain('crashed — restarting');

    const verbose = captureLog();
    const verboseRes = await watchAction({ args: ['test', 'researcher'], flags: { follow: false, verbose: true }, cwd, interactive: false } as any, 'test');
    verbose.restore();
    expect(verboseRes.success).toBe(true);
    const verboseText = verbose.output.join('\n');
    expect(verboseText).toContain('crashed — restarting');
    expect(verboseText).toContain('back at it');
  });

  it('hides usage events by default and prints a running token/cost total with --stats', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-watch-'));
    setupOrgRun(cwd, 'test', [
      { id: '1', ts: 1, org: 'test', run: RUN, type: 'usage', from: 'researcher', data: { tokens: 100, cost_usd: 0.01 } },
      { id: '2', ts: 2, org: 'test', run: RUN, type: 'usage', from: 'researcher', data: { tokens: 50, cost_usd: 0.005 } },
      { id: '3', ts: 3, org: 'test', run: RUN, type: 'usage', from: 'coder', data: { tokens: 999, cost_usd: 9 } },
    ]);

    const quiet = captureLog();
    await watchAction({ args: ['test', 'researcher'], flags: { follow: false }, cwd, interactive: false } as any, 'test');
    quiet.restore();
    expect(quiet.output.join('\n')).not.toContain('[stats]');

    const stats = captureLog();
    const res = await watchAction({ args: ['test', 'researcher'], flags: { follow: false, stats: true }, cwd, interactive: false } as any, 'test');
    stats.restore();
    expect(res.success).toBe(true);
    const text = stats.output.join('\n');
    expect(text).toContain('total 100');
    expect(text).toContain('total 150'); // running total after the second usage event
    expect(text).not.toContain('999'); // coder's usage, not researcher's
  });
});
