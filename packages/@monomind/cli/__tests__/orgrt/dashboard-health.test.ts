// Improvement 11: the forwarder used to accept any dashboard whose pid was
// alive — on the 2.16.0 release run that was a server.mjs from a deleted
// worktree — and heals started new servers without tearing old ones down.
import { describe, expect, it } from 'vitest';
import {
  assessDashboard,
  type DashboardProbe,
  dashboardScript,
  findProjectDashboard,
  type ProcInfo,
} from '../../src/orgrt/dashboard-health.js';

const PROJECT = '/work/proj';
const SERVER = '/work/proj/node_modules/monomind/dist/src/ui/server.mjs';

function probe(opts: {
  alive?: number[];
  procs?: Record<number, ProcInfo>;
  files?: string[];
  version?: string;
}): DashboardProbe {
  return {
    isPidAlive: (pid) => (opts.alive ?? []).includes(pid),
    procInfo: (pid) => opts.procs?.[pid] ?? null,
    exists: (p) => (opts.files ?? []).includes(p),
    version: opts.version ?? '2.16.1',
  };
}

describe('dashboardScript', () => {
  it('recognises a server.mjs dashboard and a `monomind ui` dashboard', () => {
    expect(dashboardScript(['/usr/bin/node', SERVER, '4242'])).toBe(SERVER);
    expect(dashboardScript(['node', '/n/.bin/monomind', 'ui', '--no-open'])).toBe('/n/.bin/monomind');
  });
  it('ignores everything else', () => {
    expect(dashboardScript(['/sbin/init'])).toBeNull();
    expect(dashboardScript(['node', '/n/.bin/monomind', 'org', 'run'])).toBeNull();
    expect(dashboardScript(['node', 'relative/ui/server.mjs'])).toBeNull();
  });
});

describe('assessDashboard', () => {
  const ours: ProcInfo = { argv: ['node', SERVER, '4242'], cwd: PROJECT };

  it('accepts a live dashboard whose server entry exists and whose version matches', () => {
    const v = assessDashboard(
      { pid: 10, server: SERVER, version: '2.16.1' },
      PROJECT,
      probe({ alive: [10], procs: { 10: ours }, files: [SERVER] }),
    );
    expect(v).toEqual({ live: true, script: SERVER });
  });

  it('rejects a dead pid, with nothing to stop', () => {
    const v = assessDashboard({ pid: 10 }, PROJECT, probe({}));
    expect(v).toMatchObject({ live: false });
    expect('stopPid' in v && v.stopPid).toBeFalsy();
  });

  it('rejects and stops our dashboard whose server.mjs no longer exists (deleted worktree)', () => {
    const gone = '/work/proj-wt-land/packages/@monomind/cli/dist/src/ui/server.mjs';
    const v = assessDashboard(
      { pid: 10 }, // control-start.cjs records no server path — read it from the process
      PROJECT,
      probe({ alive: [10], procs: { 10: { argv: ['node', gone, '4242'], cwd: PROJECT } } }),
    );
    expect(v).toEqual({ live: false, reason: `its server entry ${gone} no longer exists`, stopPid: 10 });
  });

  it('rejects and stops our dashboard started by another CLI version', () => {
    const v = assessDashboard(
      { pid: 10, server: SERVER, version: '2.15.7' },
      PROJECT,
      probe({ alive: [10], procs: { 10: ours }, files: [SERVER] }),
    );
    expect(v).toMatchObject({ live: false, stopPid: 10 });
  });

  it('never stops a stale dashboard it cannot prove is this project\'s own', () => {
    const elsewhere = { argv: ['node', SERVER, '4242'], cwd: '/work/other' };
    const v = assessDashboard(
      { pid: 10, server: SERVER, version: '2.15.7' },
      PROJECT,
      probe({ alive: [10], procs: { 10: elsewhere }, files: [SERVER] }),
    );
    expect(v).toMatchObject({ live: false });
    expect('stopPid' in v).toBe(false);
    // no cwd readable (no procfs) — likewise never stopped
    const noCwd = assessDashboard(
      { pid: 10, server: '/gone/ui/server.mjs' },
      PROJECT,
      probe({ alive: [10], procs: { 10: { argv: ['node', '/gone/ui/server.mjs'] } } }),
    );
    expect(noCwd).toMatchObject({ live: false });
    expect('stopPid' in noCwd).toBe(false);
  });

  it('rejects a recorded pid that now runs something other than the recorded server', () => {
    const v = assessDashboard(
      { pid: 10, server: SERVER },
      PROJECT,
      probe({ alive: [10], procs: { 10: { argv: ['/usr/bin/vim'], cwd: PROJECT } }, files: [SERVER] }),
    );
    expect(v).toMatchObject({ live: false });
    expect('stopPid' in v).toBe(false);
  });

  it('keeps accepting an unknown (0/absent) pid, as before', () => {
    expect(assessDashboard({ pid: 0, port: 4242 }, PROJECT, probe({}))).toEqual({ live: true });
  });
});

describe('findProjectDashboard', () => {
  it('reuses a live dashboard already serving this project instead of starting another', async () => {
    const stopped: number[] = [];
    const found = await findProjectDashboard(
      PROJECT,
      probe({ alive: [20], procs: { 20: { argv: ['node', SERVER, '4242'], cwd: PROJECT } }, files: [SERVER] }),
      async (port) => (port === 4244 ? { pid: 20, dir: PROJECT } : port === 4242 ? { pid: 5, dir: '/work/other' } : null),
      (pid) => stopped.push(pid),
    );
    expect(found).toEqual({ pid: 20, port: 4244, server: SERVER });
    expect(stopped).toEqual([]);
  });

  it('stops stale dashboards of this project found on the way and reports none live', async () => {
    const gone = '/deleted/ui/server.mjs';
    const stopped: number[] = [];
    const found = await findProjectDashboard(
      PROJECT,
      probe({ alive: [21], procs: { 21: { argv: ['node', gone, '4242'], cwd: PROJECT } } }),
      async (port) => (port === 4243 ? { pid: 21, dir: PROJECT } : null),
      (pid) => stopped.push(pid),
    );
    expect(found).toBeNull();
    expect(stopped).toEqual([21]);
  });
});
