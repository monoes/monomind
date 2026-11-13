// packages/@monomind/cli/__tests__/orgrt/authority-mask-seatbelt.test.ts
/**
 * #768: the authority mask on macOS is a Seatbelt profile run by sandbox-exec.
 * The profile cases run anywhere; the end-to-end cases run the real
 * sandbox-exec and are skipped where it cannot apply a profile.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import {
  authorityMaskArgs,
  authorityMaskAvailability,
  ensureAuthorityDirs,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import {
  isSeatbeltMask,
  SANDBOX_EXEC,
  sbplString,
  seatbeltAvailability,
} from '../../src/orgrt/authority-mask-seatbelt.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { roleExecMask } from '../../src/orgrt/exec-deny.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));

function world() {
  const home = scratch('sb-home-');
  const root = scratch('sb-root-');
  const env = {} as NodeJS.ProcessEnv;
  ensureAuthorityDirs(home, env);
  writeFileSync(join(home, '.monomind/orgrt-operator/acme.json'), '{"credential":"OPERATOR"}');
  writeFileSync(join(home, '.monomind/dashboard-auth/secret'), 'HUMAN');
  mkdirSync(join(root, '.monomind/orgs/acme'), { recursive: true });
  writeFileSync(join(root, '.monomind/dashboard-token'), 'TOKEN');
  writeFileSync(join(root, '.monomind/orgs/acme/gates.json'), '{"gates":[]}');
  writeFileSync(join(root, '.monomind/orgs/acme/inbox.jsonl'), '');
  writeFileSync(join(root, '.monomind/orgs/acme.json'), '{"name":"acme"}');
  return { home, root, env };
}

const maskFor = (w: ReturnType<typeof world>) =>
  authorityMaskArgs({
    home: w.home,
    env: w.env,
    roots: [w.root],
    orgRoot: w.root,
    platform: 'darwin',
  });

describe('the Seatbelt profile (any host)', () => {
  it('is a sandbox-exec profile that starts from allow-default', () => {
    const mask = maskFor(world());
    expect(isSeatbeltMask(mask)).toBe(true);
    expect(mask[0]).toBe('-p');
    expect(mask[1]).toMatch(/^\(version 1\)\n\(allow default\)/);
  });

  it('hides the authority dirs and the dashboard token, and makes the orgs dir read-only', () => {
    const w = world();
    const profile = maskFor(w)[1];
    expect(profile).toContain(
      `(deny file-read* file-write* (subpath "${join(w.home, '.monomind/orgrt-operator')}"))`,
    );
    expect(profile).toContain(`(subpath "${join(w.home, '.monomind/dashboard-auth')}")`);
    expect(profile).toContain(`(literal "${join(w.root, '.monomind/dashboard-token')}")`);
    expect(profile).toContain(`(deny file-write* (subpath "${join(w.root, '.monomind/orgs')}"))`);
  });

  it('puts the denies that must not be uncovered after every allow', () => {
    const profile = maskFor(world())[1];
    expect(profile.lastIndexOf('(allow file-write*')).toBeLessThan(
      profile.indexOf('(deny file-read* file-write*'),
    );
  });

  it('escapes quotes and backslashes, and refuses a newline', () => {
    expect(sbplString('/a"b\\c')).toBe('"/a\\"b\\\\c"');
    expect(() => sbplString('/a\nb')).toThrow();
  });

  it('is run through sandbox-exec by maskedCommand, bubblewrap masks through bwrap', () => {
    const [cmd, argv] = maskedCommand(['-p', '(version 1)'], 'git', ['status']);
    expect(cmd).toBe(SANDBOX_EXEC);
    expect(argv).toEqual(['-p', '(version 1)', 'git', 'status']);
    expect(maskedCommand(['--dev-bind', '/', '/'], 'git', ['status'])[0]).toBe('bwrap');
    expect(maskedCommand(undefined, 'git', ['status'])).toEqual(['git', ['status']]);
  });

  it('says on Windows what to do instead', () => {
    const a = authorityMaskAvailability('win32');
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/WSL2/);
  });
});

describe('roleExecMask on a Seatbelt mask', () => {
  const bus = () => new OrgBus('o', 'r', scratch('sb-bus-'));
  const base = { roleId: 'coder', home: '/h', env: {} as NodeJS.ProcessEnv };

  it('adds read denies for mail digests and write denies for the mail root', () => {
    const w = world();
    const mail = join(w.root, 'mail');
    mkdirSync(mail);
    const mask = roleExecMask({
      ...base,
      bus: bus(),
      authorityMask: maskFor(w),
      bestEffortDenyRead: [mail],
      bestEffortReadOnly: [mail],
    });
    expect(mask?.[1]).toContain(`(deny file-read* (subpath "${mail}"))`);
    expect(mask?.[1]).toContain(`(deny file-write* (subpath "${mail}"))`);
  });

  it('refuses a role that needs bind mounts: denyExec, denyRead, homeWriteAllow', () => {
    const mask = maskFor(world());
    for (const extra of [{ denyExec: ['git'] }, { denyRead: ['/x'] }, { homeWriteAllow: [] }])
      expect(() => roleExecMask({ ...base, bus: bus(), authorityMask: mask, ...extra })).toThrow(
        /Seatbelt mask cannot do it/,
      );
  });

  it('audits native copies it cannot isolate, and keeps the mask', () => {
    const w = world();
    const b = bus();
    const seen: string[] = [];
    b.subscribe((e) => e.type === 'audit' && seen.push(String(e.reason)));
    const mask = maskFor(w);
    const out = roleExecMask({
      ...base,
      bus: b,
      authorityMask: mask,
      bestEffortBinds: [{ src: w.root, dest: w.home }],
    });
    expect(out).toEqual(mask);
    expect(seen).toContain('native-copies-unprotected');
  });
});

describe.runIf(process.platform === 'darwin' && seatbeltAvailability().available)(
  'the Seatbelt mask (real sandbox-exec)',
  () => {
    const inMask = (w: ReturnType<typeof world>, script: string) => {
      const [cmd, argv] = maskedCommand(maskFor(w), '/bin/bash', ['-c', script]);
      return spawnSync(cmd, argv, { encoding: 'utf8' });
    };

    it('is reported as available', () => {
      expect(authorityMaskAvailability().available).toBe(true);
    });

    it('hides the credentials, including a file created after the mask was built', () => {
      const w = world();
      const mask = maskFor(w);
      writeFileSync(join(w.home, '.monomind/orgrt-operator/late.json'), 'LATE');
      const [cmd, argv] = maskedCommand(mask, '/bin/bash', [
        '-c',
        `cat ${w.home}/.monomind/orgrt-operator/* ${w.home}/.monomind/dashboard-auth/* ${w.root}/.monomind/dashboard-token 2>/dev/null; true`,
      ]);
      const out = spawnSync(cmd, argv, { encoding: 'utf8' }).stdout;
      expect(out).not.toMatch(/OPERATOR|HUMAN|TOKEN|LATE/);
    });

    it('makes the decision files and the org definition unwritable, unremovable', () => {
      const w = world();
      const gates = join(w.root, '.monomind/orgs/acme/gates.json');
      const def = join(w.root, '.monomind/orgs/acme.json');
      inMask(w, `echo forged > ${gates}; rm -f ${gates}; echo forged > ${def}; rm -f ${def}`);
      expect(readFileSync(gates, 'utf8')).toBe('{"gates":[]}');
      expect(readFileSync(def, 'utf8')).toBe('{"name":"acme"}');
    });

    it('cannot plant a new org definition, but still writes its work directories', () => {
      const w = world();
      mkdirSync(join(w.root, '.monomind/orgs/acme/reports'));
      inMask(
        w,
        `echo x > ${w.root}/.monomind/orgs/evil.json; echo ok > ${w.root}/.monomind/orgs/acme/reports/r.md`,
      );
      expect(existsSync(join(w.root, '.monomind/orgs/evil.json'))).toBe(false);
      expect(readFileSync(join(w.root, '.monomind/orgs/acme/reports/r.md'), 'utf8')).toBe('ok\n');
    });

    it('cannot rename the org root’s .monomind away, and leaves other work alone', () => {
      const w = world();
      inMask(
        w,
        `mv ${w.root}/.monomind ${w.root}/.moved; mkdir -p ${w.root}/work && echo ok > ${w.root}/work/out.txt`,
      );
      expect(existsSync(join(w.root, '.monomind/orgs/acme/gates.json'))).toBe(true);
      expect(readFileSync(join(w.root, 'work/out.txt'), 'utf8')).toBe('ok\n');
    });

    it('writes nothing a role puts in a hidden dir', () => {
      const w = world();
      inMask(w, `echo planted > ${w.home}/.monomind/dashboard-auth/secret2`);
      expect(existsSync(join(w.home, '.monomind/dashboard-auth/secret2'))).toBe(false);
    });
  },
);
