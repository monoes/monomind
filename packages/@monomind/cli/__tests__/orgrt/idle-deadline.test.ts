// packages/@monomind/cli/__tests__/orgrt/idle-deadline.test.ts
// #296: the idle watchdog publishes when it will stop a running org.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { projectIdleStop } from '../../src/orgrt/idle-deadline.js';

describe('projectIdleStop', () => {
  const base = { lastActivity: 1_000, nudgedAt: 0, nudges: 0, maxNudges: 3, idleMs: 60_000, bossReachable: true };
  it('allows a nudge window plus one more window before stopping', () => {
    expect(projectIdleStop(base)).toBe(1_000 + 120_000);
  });
  it('stops one window after an unanswered nudge', () => {
    expect(projectIdleStop({ ...base, nudgedAt: 50_000, nudges: 1 })).toBe(50_000 + 60_000);
  });
  it('stops at the end of this window when the nudge cap is reached or the boss is unreachable', () => {
    expect(projectIdleStop({ ...base, nudges: 3 })).toBe(61_000);
    expect(projectIdleStop({ ...base, bossReachable: false })).toBe(61_000);
  });
});

describe('OrgDaemon — idle deadline record', () => {
  const setup = (idleMinutes: number) => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-idle-deadline-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      run_config: { idle_minutes: idleMinutes },
      roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
    }));
    const hangingQuery = () => (async function* () { await new Promise(() => {}); })();
    const d = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false, stopWaitMs: 200 });
    const file = join(root, '.monomind/orgs/alpha/idle-watchdog.json');
    const read = () => JSON.parse(readFileSync(file, 'utf8'));
    return { d, file, read };
  };

  it('publishes a deadline at start, holds it while a question is pending, and clears it on stop', async () => {
    const { d, file, read } = setup(0.01); // 600ms window, 300ms checks
    const before = Date.now();
    const running = await d.startOrg('alpha');
    const rec = read();
    expect(rec).toMatchObject({ run: running.run, idle_minutes: 0.01, hold: null });
    const at = Date.parse(rec.idle_stop_at);
    expect(at).toBeGreaterThanOrEqual(before + 1_200);
    expect(at).toBeLessThanOrEqual(Date.now() + 1_200);

    await d.askHuman('alpha', 'boss', 'ship it?');
    const t0 = Date.now();
    while (read().hold !== 'pending-question' && Date.now() - t0 < 3_000) await new Promise(r => setTimeout(r, 50));
    expect(read()).toMatchObject({ idle_stop_at: null, hold: 'pending-question' });

    await d.stopOrg('alpha');
    expect(existsSync(file)).toBe(false);
  }, 10_000);

  it('reports the watchdog as disabled for idle_minutes: 0', async () => {
    const { d, read } = setup(0);
    const running = await d.startOrg('alpha');
    expect(read()).toMatchObject({ run: running.run, idle_minutes: 0, idle_stop_at: null, hold: 'disabled' });
    await d.stopOrg('alpha');
  }, 10_000);
});
