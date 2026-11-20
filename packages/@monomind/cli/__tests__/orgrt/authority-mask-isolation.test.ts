// packages/@monomind/cli/__tests__/orgrt/authority-mask-isolation.test.ts
/**
 * The authority mask gives a role its own pid namespace, /proc and session, and
 * hides the user's runtime dir and the daemon sockets (authority-mask.ts's
 * isolationArgs), as the SDK sandbox does for Claude roles. The argument cases run
 * everywhere; the end-to-end cases run the real bwrap.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bubblewrapRuns } from '../../src/__tests__/bwrap-probe.js';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import {
  authorityMaskArgs,
  ensureAuthorityDirs,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { roleExecMask } from '../../src/orgrt/exec-deny.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));

/** A fake $HOME with an operator credential, a project, a runtime dir and a socket file. */
function world() {
  const home = scratch('ami-home-');
  const root = scratch('ami-root-');
  const run = scratch('ami-run-');
  const sockets = scratch('ami-sock-');
  writeFileSync(join(run, 'bus'), 'BUS');
  writeFileSync(join(sockets, 'docker.sock'), 'DOCKER');
  mkdirSync(join(sockets, 'dbus'));
  writeFileSync(join(sockets, 'dbus', 'system_bus_socket'), 'DBUS');
  const env = { XDG_RUNTIME_DIR: run, TMPDIR: scratch('ami-tmp-') } as NodeJS.ProcessEnv;
  ensureAuthorityDirs(home, env);
  writeFileSync(join(home, '.monomind/orgrt-operator/acme.json'), '{"credential":"OPERATOR"}');
  mkdirSync(join(root, '.monomind/orgs/acme'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs/acme.json'), '{"name":"acme"}');
  const daemonSockets = [join(sockets, 'docker.sock'), join(sockets, 'dbus'), join(sockets, 'none')];
  return { home, root, run, sockets, env, daemonSockets };
}

const maskFor = (w: ReturnType<typeof world>, extra: { env?: NodeJS.ProcessEnv } = {}) =>
  authorityMaskArgs({
    home: w.home,
    env: extra.env ?? w.env,
    roots: [w.root],
    orgRoot: w.root,
    cwd: w.root,
    daemonSockets: w.daemonSockets,
    platform: 'linux',
  });

const count = (args: string[], flag: string) => args.filter((a) => a === flag).length;
const hasPair = (args: string[], flag: string, value: string) =>
  args.some((a, i) => a === flag && args[i + 1] === value);

describe('authority mask isolation arguments', () => {
  it('gives the role its own pid namespace, /proc and session, once each', () => {
    const args = maskFor(world());
    expect(count(args, '--unshare-pid')).toBe(1);
    expect(hasPair(args, '--proc', '/proc')).toBe(true);
    expect(count(args, '--proc')).toBe(1);
    expect(count(args, '--new-session')).toBe(1);
  });

  it('puts a tmpfs over the runtime dir and binds back a work root under it', () => {
    const w = world();
    const tmpUnder = join(w.run, 'tmp');
    mkdirSync(tmpUnder);
    const args = maskFor(w, { env: { ...w.env, TMPDIR: tmpUnder } });
    const tmpfsAt = args.findIndex((a, i) => a === '--tmpfs' && args[i + 1] === w.run);
    expect(tmpfsAt).toBeGreaterThan(-1);
    const bindAt = args.findIndex(
      (a, i) => a === '--bind' && args[i + 1] === tmpUnder && args[i + 2] === tmpUnder,
    );
    expect(bindAt).toBeGreaterThan(tmpfsAt);
  });

  it('leaves a runtime dir alone when it is itself a work root', () => {
    const w = world();
    const args = maskFor(w, { env: { ...w.env, TMPDIR: w.run } });
    expect(hasPair(args, '--tmpfs', w.run)).toBe(false);
  });

  it('reads a socket file as /dev/null, empties a socket dir and skips a missing one', () => {
    const w = world();
    const args = maskFor(w);
    const sock = join(w.sockets, 'docker.sock');
    expect(args.some((a, i) => a === '--ro-bind' && args[i + 1] === '/dev/null' && args[i + 2] === sock)).toBe(true);
    expect(hasPair(args, '--tmpfs', join(w.sockets, 'dbus'))).toBe(true);
    expect(args).not.toContain(join(w.sockets, 'none'));
  });

  it('roleExecMask adds the pid namespace once, whether or not the mask has one', () => {
    const w = world();
    const base = { roleId: 'dev', home: w.home, env: w.env, platform: 'linux' as const };
    const avail = { available: true };
    const overMask = roleExecMask({
      ...base,
      bus: new OrgBus('o', 'r', scratch('ami-bus-')),
      authorityMask: maskFor(w),
      denyExec: ['node'],
      availability: avail,
    }) as string[];
    expect(count(overMask, '--unshare-pid')).toBe(1);
    expect(count(overMask, '--proc')).toBe(1);
    const mailOnly = roleExecMask({
      ...base,
      bus: new OrgBus('o', 'r', scratch('ami-bus-')),
      authorityMask: maskFor(w),
      bestEffortDenyRead: [w.sockets],
      availability: avail,
    }) as string[];
    expect(count(mailOnly, '--unshare-pid')).toBe(1);
    const plain = roleExecMask({
      ...base,
      bus: new OrgBus('o', 'r', scratch('ami-bus-')),
      authorityMask: ['--dev-bind', '/', '/'],
      denyExec: ['node'],
      availability: avail,
    }) as string[];
    expect(count(plain, '--unshare-pid')).toBe(1);
    expect(hasPair(plain, '--proc', '/proc')).toBe(true);
  });
});

// reason: these cases run the real bubblewrap, which only Linux hosts with it installed have (#798)
describe.skipIf(!bubblewrapRuns('authority mask isolation'))('authority mask isolation (real bwrap)', () => {
  const inMask = (w: ReturnType<typeof world>, script: string, env?: NodeJS.ProcessEnv) => {
    const [cmd, argv] = maskedCommand(maskFor(w, { env }), 'bash', ['-c', script]);
    return spawnSync(cmd, argv, { encoding: 'utf8', timeout: 20_000 });
  };

  it('shows the role no process outside it, so no other root is reachable through /proc', () => {
    const w = world();
    const sibling = spawn('sleep', ['60'], { stdio: 'ignore' });
    try {
      const pid = sibling.pid as number;
      const cred = join(w.home, '.monomind/orgrt-operator/acme.json');
      const r = inMask(
        w,
        `cat /proc/${pid}/root${cred} 2>/dev/null; cat /proc/${pid}/environ 2>/dev/null; ls /proc | grep -x ${pid}; true`,
      );
      expect(r.status).toBe(0);
      expect(r.stdout).not.toMatch(/OPERATOR/);
      expect(r.stdout.split('\n')).not.toContain(String(pid));
    } finally {
      sibling.kill('SIGKILL');
    }
  });

  it('starts the role in a session of its own', () => {
    const r = inMask(world(), 'read -r pid _ _ _ _ sid _ < /proc/self/stat; echo "$pid $sid"');
    const [pid, sid] = r.stdout.trim().split(' ');
    // `read` is a builtin, so /proc/self is bash itself: the session leader
    expect(sid).toBe(pid);
  });

  it('empties the runtime dir and keeps what the role writes there from the host', () => {
    const w = world();
    const r = inMask(w, `cat ${w.run}/bus 2>/dev/null; echo planted > ${w.run}/planted; true`);
    expect(r.stdout).not.toMatch(/BUS/);
    expect(existsSync(join(w.run, 'planted'))).toBe(false);
  });

  it('keeps a TMPDIR under the runtime dir working', () => {
    const w = world();
    const tmpUnder = join(w.run, 'tmp');
    mkdirSync(tmpUnder);
    inMask(w, `echo ok > ${tmpUnder}/out`, { ...w.env, TMPDIR: tmpUnder });
    expect(readFileSync(join(tmpUnder, 'out'), 'utf8')).toBe('ok\n');
  });

  it('hides the daemon sockets', () => {
    const w = world();
    const r = inMask(
      w,
      `cat ${w.sockets}/docker.sock ${w.sockets}/dbus/system_bus_socket 2>/dev/null; true`,
    );
    expect(r.stdout).not.toMatch(/DOCKER|DBUS/);
  });
});
