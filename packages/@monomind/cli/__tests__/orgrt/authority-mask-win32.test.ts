/**
 * #852: the authority mask on native Windows is a restricted token with marker
 * SIDs, started by a PowerShell launcher. These cases run on any host; the
 * real-Windows ones are in authority-mask-win32-real.test.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import {
  authorityMaskArgs,
  authorityMaskAvailability,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import { WIN_LAUNCHER } from '../../src/orgrt/authority-mask-win32-launcher.js';
import {
  COMMON_MARKER,
  isWinMask,
  roleMarker,
  winMaskArgs,
  winMaskAvailability,
} from '../../src/orgrt/authority-mask-win32.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { hostPreflight, setHostProbes } from '../../src/orgrt/documents/preflight.js';
import { roleExecMask } from '../../src/orgrt/exec-deny.js';
import { sandboxAvailability } from '../../src/orgrt/role-sandbox-restrictions.js';
import { sectionsRaw } from './support/sections-defs.js';

const scratch = (p: string) => mkdtempSync(join(tmpdir(), p));
const spec = (mask: string[]) => JSON.parse(Buffer.from(mask[1], 'base64').toString('utf8'));

function world() {
  const home = scratch('w32-home-');
  const root = scratch('w32-root-');
  const op = join(home, '.monomind', 'orgrt-operator');
  const dash = join(home, '.monomind', 'dashboard-auth');
  mkdirSync(op, { recursive: true });
  mkdirSync(dash, { recursive: true });
  mkdirSync(join(root, '.monomind'), { recursive: true });
  writeFileSync(join(root, '.monomind', 'dashboard-token'), 'TOKEN');
  return { home, root, op, dash, env: {} as NodeJS.ProcessEnv };
}
const maskFor = (w: ReturnType<typeof world>) =>
  authorityMaskArgs({ home: w.home, env: w.env, roots: [w.root], orgRoot: w.root, platform: 'win32' });

describe('the native Windows mask (any host)', () => {
  it('is a launcher mask with a marker deny on the authority dirs and the token files', () => {
    const w = world();
    const mask = maskFor(w);
    expect(isWinMask(mask)).toBe(true);
    const s = spec(mask);
    expect(s.markers).toEqual([COMMON_MARKER]);
    const denied = s.deny.filter((r: any) => !r.allow && r.rights === 'FullControl');
    expect(denied.map((r: any) => r.path)).toEqual(
      expect.arrayContaining([w.op, w.dash, join(w.root, '.monomind', 'dashboard-token')]),
    );
    expect(denied.every((r: any) => r.sid === COMMON_MARKER)).toBe(true);
  });

  it('writes the launcher beside a write deny, and checks its content on every build', () => {
    const w = world();
    const mask = maskFor(w);
    expect(readFileSync(mask[2], 'utf8')).toBe(WIN_LAUNCHER);
    expect(spec(mask).deny.some((r: any) => r.path === join(w.home, '.monomind', 'win-launch') && /Write/.test(r.rights))).toBe(true);
    writeFileSync(mask[2], 'tampered');
    expect(readFileSync(maskFor(w)[2], 'utf8')).toBe(WIN_LAUNCHER);
  });

  it('skips authority paths that do not exist', () => {
    const home = scratch('w32-empty-');
    const mask = winMaskArgs({ home, hidden: [join(home, 'nope')], files: [join(home, 'nope.txt')] });
    expect(spec(mask).deny.filter((r: any) => r.rights === 'FullControl')).toEqual([]);
  });

  it('is run through PowerShell with the spec, the program and its arguments', () => {
    const mask = maskFor(world());
    const [cmd, argv] = maskedCommand(mask, 'git', ['status', '-s']);
    expect(cmd).toMatch(/powershell\.exe$/i);
    expect(argv.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']);
    expect(argv.slice(5)).toEqual([mask[2], mask[1], 'git', 'status', '-s']);
  });

  it('gives each role its own marker, never the common one', () => {
    expect(roleMarker('a')).not.toBe(roleMarker('b'));
    expect(roleMarker('a')).toBe(roleMarker('a'));
    expect(roleMarker('a')).not.toBe(COMMON_MARKER);
    expect(roleMarker('a')).toMatch(/^S-1-5-21-\d+-\d+-\d+-\d+$/);
  });

  it('is not available off Windows, and says what to do', () => {
    if (process.platform === 'win32') return;
    const a = winMaskAvailability('linux');
    expect(a.available).toBe(false);
    expect(authorityMaskAvailability('win32').reason).toMatch(/WSL2/);
  });

  it('stands in for the SDK sandbox probe on win32', () => {
    if (process.platform === 'win32') return;
    expect(sandboxAvailability({}, 'win32')).toEqual(winMaskAvailability('win32'));
  });
});

describe('roleExecMask on the Windows mask', () => {
  const bus = () => new OrgBus('o', 'r', scratch('w32-bus-'));
  const base = { roleId: 'coder', home: '/h', env: {} as NodeJS.ProcessEnv, platform: 'win32' as const };

  it('denies other roles mail digests to this role only, and makes the mail root read-only', () => {
    const w = world();
    const mail = join(w.root, 'mail');
    const own = join(mail, 'coder');
    mkdirSync(own, { recursive: true });
    const out = roleExecMask({
      ...base,
      bus: bus(),
      authorityMask: maskFor(w),
      bestEffortReadOnly: [mail],
      bestEffortBinds: [{ src: own, dest: own }],
    })!;
    const s = spec(out);
    const sid = roleMarker('coder');
    expect(s.markers).toEqual([COMMON_MARKER, sid]);
    const mine = s.deny.filter((r: any) => r.sid === sid);
    expect(mine.some((r: any) => r.path.endsWith('mail') && !r.allow && /Write/.test(r.rights))).toBe(true);
    expect(mine.some((r: any) => r.allow && r.path.endsWith('coder') && r.rights === 'Modify')).toBe(true);
  });

  it('hides a directory from this role with a full deny', () => {
    const w = world();
    const other = join(w.root, 'mail', 'reviewer');
    mkdirSync(other, { recursive: true });
    const out = roleExecMask({ ...base, bus: bus(), authorityMask: maskFor(w), bestEffortDenyRead: [other] })!;
    expect(spec(out).deny.some((r: any) => r.sid === roleMarker('coder') && r.rights === 'FullControl' && r.path.endsWith('reviewer'))).toBe(true);
  });

  it('refuses a role that needs bind mounts: denyExec, homeWriteAllow', () => {
    const mask = maskFor(world());
    for (const extra of [{ denyExec: ['git'] }, { homeWriteAllow: [] }])
      expect(() => roleExecMask({ ...base, bus: bus(), authorityMask: mask, ...extra })).toThrow(
        /native Windows mask cannot do it/,
      );
  });

  it('audits native copies it cannot isolate, and keeps the mask', () => {
    const w = world();
    const b = bus();
    const seen: string[] = [];
    b.subscribe((e) => e.type === 'audit' && seen.push(String(e.reason)));
    const out = roleExecMask({
      ...base,
      bus: b,
      authorityMask: maskFor(w),
      bestEffortBinds: [{ src: w.root, dest: w.home }],
    })!;
    expect(isWinMask(out)).toBe(true);
    expect(seen).toContain('native-copies-unprotected');
  });

  it('without a mask only audits', () => {
    const w = world();
    const mail = join(w.root, 'mail');
    mkdirSync(mail, { recursive: true });
    const b = bus();
    const seen: string[] = [];
    b.subscribe((e) => e.type === 'audit' && seen.push(String(e.reason)));
    expect(roleExecMask({ ...base, bus: b, authorityMask: undefined, bestEffortDenyRead: [mail] })).toBeUndefined();
    expect(seen).toContain('mail-mask-unavailable');
  });
});

describe('host preflight on win32', () => {
  const prod = () => {
    const d = sectionsRaw() as any;
    delete d.run_config.experimental;
    return d;
  };
  const OK = { available: true };

  it('starts a sections org with the default host_isolation when the mask works, with the limits as a warning', () => {
    const r = hostPreflight(prod(), { mask: OK, sandbox: OK }, 'win32');
    expect(r.ok).toBe(true);
    expect(r.warnings.join('\n')).toMatch(/restricted-token mask .*private native runner copy .*same-user process/);
  });

  it('refuses, naming the restricted token, when the launcher cannot run', () => {
    setHostProbes(undefined);
    const r = hostPreflight(prod(), { mask: { available: false, reason: 'blocked' }, sandbox: OK }, 'win32');
    expect(r.ok).toBe(false);
    expect(r.refusals.join('\n')).toMatch(/\(restricted token\).*blocked.*PowerShell/);
    expect(r.refusals.join('\n')).toMatch(/host_isolation/);
  });
});
