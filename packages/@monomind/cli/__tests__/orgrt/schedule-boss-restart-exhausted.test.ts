/**
 * #206 companion fix: once scheduleBossRestart() gives up after
 * MAX_BOSS_RESTARTS, it used to only emit a 'boss-restart-exhausted' audit
 * event and return — the org stayed in daemon.orgs forever with a dead boss
 * mailbox, since nothing else was left to call stopOrg for it (the idle
 * watchdog only fires if idle_minutes > 0). `org run`'s wait loop
 * (`while (!daemon.getOrg(name))`) would then never exit. It must actually
 * stop the org.
 */
import { describe, it, expect, vi } from 'vitest';
import { scheduleBossRestart } from '../../src/orgrt/scheduler-integration.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';

function stubDaemon(name: string, restartCount: number) {
  const events: unknown[] = [];
  const stopOrg = vi.fn(async () => {});
  const daemon = {
    stopping: new Map<string, unknown>(),
    restarting: new Set<string>(),
    bossRestartCounts: new Map<string, number>([[name, restartCount]]),
    orgs: new Map([[name, { bus: { emit: (e: unknown) => events.push(e) } }]]),
    opts: {},
    stopOrg,
  } as unknown as OrgDaemon;
  return { daemon, events, stopOrg };
}

describe('scheduleBossRestart — exhausted-retries path', () => {
  it('calls daemon.stopOrg once the restart cap is reached, so the org actually terminates', () => {
    const { daemon, events, stopOrg } = stubDaemon('alpha', OrgDaemon.MAX_BOSS_RESTARTS);
    scheduleBossRestart(daemon, 'alpha');
    expect(stopOrg).toHaveBeenCalledWith('alpha');
    expect(events.some((e) => (e as { reason?: string }).reason === 'boss-restart-exhausted')).toBe(true);
  });

  it('does NOT call stopOrg while restarts remain (schedules a restart instead)', () => {
    const { daemon, stopOrg } = stubDaemon('alpha', 0);
    scheduleBossRestart(daemon, 'alpha');
    expect(stopOrg).not.toHaveBeenCalled();
  });

  it('a stopOrg rejection is caught, not thrown synchronously out of scheduleBossRestart', () => {
    const name = 'alpha';
    const events: unknown[] = [];
    const daemon = {
      stopping: new Map<string, unknown>(),
      restarting: new Set<string>(),
      bossRestartCounts: new Map<string, number>([[name, OrgDaemon.MAX_BOSS_RESTARTS]]),
      orgs: new Map([[name, { bus: { emit: (e: unknown) => events.push(e) } }]]),
      opts: {},
      stopOrg: vi.fn(async () => { throw new Error('stop boom'); }),
    } as unknown as OrgDaemon;
    expect(() => scheduleBossRestart(daemon, name)).not.toThrow();
  });
});
