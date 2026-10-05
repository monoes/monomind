// packages/@monomind/cli/__tests__/orgrt/exec-deny.test.ts
/**
 * policy.sandbox.denyExec: programs a role must not be able to run. Enforced by
 * a bubblewrap layer around the role's whole process tree (every matching
 * binary is replaced by /dev/null, the pid namespace hides the daemon's own
 * processes), with a Bash command check in the PolicyEngine on top of it. The
 * adversarial cases run through the real bwrap, the way a role's Bash tool
 * runs a command (inside the mask, and inside a nested sandbox like the SDK's).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authorityMaskAvailability, maskedCommand } from '../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import {
  denyExecMask,
  execDenyViolation,
  resolveDenyExec,
  roleExecMask,
} from '../../src/orgrt/exec-deny.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { RolePolicySchema } from '../../src/orgrt/types-policy.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const exe = (path: string, body = '#!/bin/sh\necho RAN\n') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

describe('resolveDenyExec', () => {
  it('finds every match on PATH and in version-manager trees, by real path, and nothing else', () => {
    const home = scratch('xd-home-');
    const sys = scratch('xd-sys-');
    exe(join(sys, 'node'));
    exe(join(sys, 'python3.12'));
    symlinkSync('python3.12', join(sys, 'python3'));
    symlinkSync('node', join(sys, 'nodejs'));
    exe(join(sys, 'ls'));
    const mise = join(home, '.local/share/mise');
    exe(join(mise, 'installs/node/26.1.0/bin/node'));
    exe(join(mise, 'installs/node/latest/lib/node_modules/npm/bin/node')); // inside node_modules: not walked
    exe(join(mise, 'installs/mise/bin/mise'));
    mkdirSync(join(mise, 'shims'), { recursive: true });
    symlinkSync(join(mise, 'installs/mise/bin/mise'), join(mise, 'shims/node'));
    const got = resolveDenyExec(['node', 'nodejs', 'python*'], {
      home,
      env: { PATH: sys },
      systemDirs: [],
    });
    expect(got.filter((p) => p.startsWith(sys) || p.startsWith(home)).sort()).toEqual(
      [
        join(sys, 'node'),
        join(sys, 'python3.12'),
        join(mise, 'installs/node/26.1.0/bin/node'),
      ].sort(),
    );
  });

  it('takes an absolute path as itself, resolving symlinks, and the running node', () => {
    const d = scratch('xd-abs-');
    exe(join(d, 'tool'));
    symlinkSync(join(d, 'tool'), join(d, 'alias'));
    const got = resolveDenyExec([join(d, 'alias'), 'node'], {
      home: d,
      env: { PATH: '' },
      systemDirs: [],
    });
    expect(got).toContain(join(d, 'tool'));
    expect(got).toContain(realpathSync(process.execPath));
  });
});

describe('execDenyViolation (the Bash command check; the mask is what enforces)', () => {
  const deny = ['node', 'nodejs', 'python*', 'perl', 'npm', 'npx', 'deno', 'bun'];
  it.each([
    'node -e 1',
    'node corpus/m1/a.mjs',
    '/usr/bin/node x.mjs',
    '/home/u/.local/share/mise/installs/node/26.8.1/bin/node x.mjs',
    'cd corpus && node x.mjs',
    'FOO=1 node x.mjs',
    'env node x.mjs',
    'env -i PATH=/usr/bin node x.mjs',
    'sh -c "node x.mjs"',
    "bash -lc 'python3 -c 1'",
    'echo x | xargs node',
    'find . -name a.mjs -exec node {} \\;',
    'time nice -n 5 timeout 5 node x',
    'python3.12 -c 1',
    'perl -e 1',
    'npm run x',
    'npx tsx x.ts',
    'echo $(node -p 1)',
    'ls; `perl -e 1`',
    'exec node x',
    '"$BIN" x.mjs',
    '$(command -v node) x',
    'sh -c "$CMD"',
    'eval "node x"',
  ])('refuses %s', (cmd) => {
    expect(execDenyViolation(cmd, deny)).toMatch(/denyExec|cannot verify/);
  });

  it.each([
    'ls corpus/m1',
    'cat corpus/m1/a.mjs',
    'grep -rn "node" corpus/m1',
    'echo node python3',
    'cat node.txt | wc -l',
    'sed -n 1,5p corpus/m1/questions.json',
    'git status',
    'mkdir -p out/m1 && echo done > out/m1/x.json',
    'sh -c "ls"',
    'find corpus -name "*.mjs" | head',
  ])('allows %s', (cmd) => {
    expect(execDenyViolation(cmd, deny)).toBeUndefined();
  });

  it('is off when nothing is denied', () => {
    expect(execDenyViolation('node x', undefined)).toBeUndefined();
    expect(execDenyViolation('node x', [])).toBeUndefined();
  });
});

describe('PolicyEngine and the schema', () => {
  const engine = (denyExec?: string[]) => {
    const cwd = scratch('xd-cwd-');
    const bus = new OrgBus('o', 'r', scratch('xd-bus-'));
    return new PolicyEngine('w', { git: 'read', sandbox: { denyExec } } as never, bus, cwd);
  };
  it('denies a Bash command that names a denied program, and only with denyExec set', async () => {
    const e = engine(['node']);
    e.setOsSandboxed(true);
    const r = await e.decide('Bash', { command: 'node -e 1' });
    expect(r.behavior).toBe('deny');
    expect((await e.decide('Bash', { command: 'ls' })).behavior).toBe('allow');
    const off = engine(undefined);
    off.setOsSandboxed(true);
    expect((await off.decide('Bash', { command: 'node -e 1' })).behavior).toBe('allow');
  });
  it('is a known sandbox key (the schema is strict)', () => {
    const p = RolePolicySchema.parse({ sandbox: { denyExec: ['node'] } });
    expect(p.sandbox?.denyExec).toEqual(['node']);
    expect(() => RolePolicySchema.parse({ sandbox: { denyExecc: ['node'] } })).toThrow();
  });
});

describe('roleExecMask', () => {
  const bus = () => new OrgBus('o', 'r', scratch('xd-bus-'));
  const base = { roleId: 'w', home: scratch('xd-h-'), env: { PATH: '' } as NodeJS.ProcessEnv };
  it('is a no-op without denyExec: the existing mask comes back untouched', () => {
    const m = ['--dev-bind', '/', '/'];
    expect(roleExecMask({ ...base, bus: bus(), authorityMask: m })).toBe(m);
    expect(roleExecMask({ ...base, bus: bus(), authorityMask: undefined })).toBeUndefined();
    expect(roleExecMask({ ...base, bus: bus(), authorityMask: m, denyExec: [] })).toBe(m);
  });
  it('extends the authority mask, keeping it first, or builds one', () => {
    const m = ['--dev-bind', '/', '/', '--tmpfs', '/x'];
    const out = roleExecMask({
      ...base,
      bus: bus(),
      authorityMask: m,
      denyExec: ['node'],
      availability: { available: true },
    }) as string[];
    expect(out.slice(0, m.length)).toEqual(m);
    expect(out).toContain('--unshare-pid');
    const alone = roleExecMask({
      ...base,
      bus: bus(),
      authorityMask: undefined,
      denyExec: ['node'],
      availability: { available: true },
    }) as string[];
    expect(alone.slice(0, 3)).toEqual(['--dev-bind', '/', '/']);
  });
  it('fails closed when bubblewrap cannot run: the role does not start', () => {
    expect(() =>
      roleExecMask({
        ...base,
        bus: bus(),
        authorityMask: undefined,
        denyExec: ['node'],
        availability: { available: false, reason: 'bwrap not found' },
      }),
    ).toThrow(/denyExec.*bwrap not found/);
  });
});

const which = (b: string) => {
  const r = spawnSync('sh', ['-c', `command -v ${b}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
};

describe.runIf(authorityMaskAvailability().available)(
  'a masked role cannot run the code (real bwrap)',
  () => {
    const DENY = [
      'node',
      'nodejs',
      'deno',
      'bun',
      'npm',
      'npx',
      'pnpm',
      'yarn',
      'python*',
      'perl',
      'ruby',
      'php',
      'lua*',
    ];
    const work = scratch('xd-work-');
    const prog = join(work, 'prog.mjs');
    writeFileSync(prog, 'console.log("PROGRAM-RAN");\n');
    const mask = denyExecMask(DENY, { home: process.env.HOME as string, env: process.env });
    const run = (cmd: string, wrap = false) => {
      const script = wrap
        ? `bwrap --ro-bind / / --dev /dev --proc /proc --unshare-pid --bind '${work}' '${work}' -- sh -c '${cmd.replace(/'/g, `'\\''`)}'`
        : cmd;
      const [bin, args] = maskedCommand(mask, 'sh', ['-c', script]);
      return spawnSync(bin, args, { cwd: work, encoding: 'utf8', timeout: 30_000 });
    };
    const nodes = [
      ...new Set(
        [process.execPath, which('node'), '/usr/bin/node', '/usr/local/bin/node']
          .filter((p): p is string => !!p)
          .filter((p) => spawnSync('test', ['-x', p]).status === 0),
      ),
    ];
    const real = realpathSync(process.execPath);

    it('control: ordinary commands still run in the mask', () => {
      const r = run('ls . && cat prog.mjs && echo ok');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('ok');
      // and the program does run without the mask, so the failures below are the mask's doing
      expect(spawnSync(process.execPath, [prog], { encoding: 'utf8' }).stdout).toContain(
        'PROGRAM-RAN',
      );
    });

    const attempts: Array<[string, string]> = [
      ['node -e', `node -e 'console.log("PROGRAM-RAN")'`],
      ['node <file>', 'node prog.mjs'],
      ['env node', 'env node prog.mjs'],
      ['sh -c node', `sh -c 'node prog.mjs'`],
      ['xargs node', 'echo prog.mjs | xargs node'],
      ['find -exec node', `find . -name prog.mjs -exec node {} \\;`],
      ['command -v node resolved', `"$(command -v node)" prog.mjs`],
      ['nodejs', 'nodejs prog.mjs'],
      ['npm', 'npm --version'],
      ['npx', 'npx --version'],
      ['pnpm', 'pnpm --version'],
      ['bun', 'bun prog.mjs'],
      ['deno', 'deno run prog.mjs'],
    ];
    it.each(attempts)('%s fails to execute', (_n, cmd) => {
      const r = run(cmd);
      // find -exec reports 0 whatever the command did; the output is what must be absent
      if (!cmd.startsWith('find')) expect(r.status).not.toBe(0);
      expect(r.stdout).not.toContain('PROGRAM-RAN');
      expect(r.stdout).not.toMatch(/^\d+\.\d+\.\d+/m);
    });

    it.each(nodes)('the absolute path %s fails to execute', (p) => {
      for (const cmd of [`'${p}' prog.mjs`, `'${p}' -e 'console.log("PROGRAM-RAN")'`]) {
        const r = run(cmd);
        expect(r.status).not.toBe(0);
        expect(r.stdout).not.toContain('PROGRAM-RAN');
      }
    });

    it('the node binary copied into the workspace is empty, so cannot run', () => {
      const r = run(
        `cp '${real}' ./ncopy; chmod +x ./ncopy; ./ncopy prog.mjs; echo "rc=$?"; cat '${real}' > ./n2; chmod +x ./n2; ./n2 prog.mjs; echo "rc=$?"`,
      );
      expect(r.stdout).not.toContain('PROGRAM-RAN');
      // an empty "executable" is just an empty script: the copies hold no program
      for (const f of ['ncopy', 'n2'])
        expect(spawnSync('sh', ['-c', `test -s '${join(work, f)}'`]).status).not.toBe(0);
    });

    it('a symlink to the node binary does not run', () => {
      const r = run(`ln -sf '${real}' ./nl; ./nl prog.mjs`);
      expect(r.status).not.toBe(0);
      expect(r.stdout).not.toContain('PROGRAM-RAN');
    });

    it('the dynamic loader cannot be used to run the (masked) binary', () => {
      const ld = ['/lib64/ld-linux-x86-64.so.2', '/lib/ld-linux-aarch64.so.1'].find(
        (p) => spawnSync('test', ['-x', p]).status === 0,
      );
      if (!ld) return;
      const r = run(`'${ld}' '${real}' prog.mjs`);
      expect(r.status).not.toBe(0);
      expect(r.stdout).not.toContain('PROGRAM-RAN');
    });

    it("the daemon's own node is not reachable through /proc (own pid namespace)", () => {
      const r = run(
        `cp /proc/${process.pid}/exe ./proc-node 2>/dev/null; test -e /proc/${process.pid} && echo VISIBLE; ls /proc | grep -c '^[0-9]'`,
      );
      expect(r.stdout).not.toContain('VISIBLE');
      expect(Number(r.stdout.trim().split('\n').at(-1))).toBeLessThan(10);
      expect(spawnSync('sh', ['-c', `test -s '${join(work, 'proc-node')}'`]).status).not.toBe(0);
    });

    it('a nested sandbox (as the SDK builds one for Bash) inherits the mask', () => {
      for (const cmd of ['node prog.mjs', `'${real}' prog.mjs`, 'perl -e 1']) {
        const r = run(cmd, true);
        expect(r.stdout).not.toContain('PROGRAM-RAN');
        expect(r.status).not.toBe(0);
      }
    });

    for (const [name, cmd] of [
      ['python3', 'python3 -c \'print("PROGRAM-RAN")\''],
      ['perl', 'perl -e \'print "PROGRAM-RAN\\n"\''],
      ['ruby', 'ruby -e \'puts "PROGRAM-RAN"\''],
      ['php', 'php -r \'echo "PROGRAM-RAN";\''],
    ] as const) {
      it.runIf(!!which(name))(`${name} (installed here) fails to execute`, () => {
        const unmasked = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
        expect(unmasked.stdout).toContain('PROGRAM-RAN'); // the control: it does run without the mask
        const r = run(cmd);
        expect(r.status).not.toBe(0);
        expect(r.stdout).not.toContain('PROGRAM-RAN');
      });
    }
  },
);

describe('denyRead (files and directories the role cannot read)', () => {
  const bus = () => new OrgBus('o', 'r', scratch('xd-bus-'));
  it('is part of the same layer, applies alone, and fails closed likewise', () => {
    const d = scratch('xd-dr-');
    writeFileSync(join(d, 'truth.json'), 'SECRET');
    const out = roleExecMask({
      bus: bus(),
      roleId: 'w',
      authorityMask: undefined,
      denyRead: [join(d, 'truth.json'), join(d, 'missing')],
      home: d,
      env: { PATH: '' },
      availability: { available: true },
    }) as string[];
    expect(out).toEqual(expect.arrayContaining(['--ro-bind', '/dev/null', join(d, 'truth.json')]));
    expect(out.join(' ')).not.toContain('missing');
    expect(() =>
      roleExecMask({
        bus: bus(),
        roleId: 'w',
        authorityMask: undefined,
        denyRead: [d],
        home: d,
        env: {},
        availability: { available: false, reason: 'no bwrap' },
      }),
    ).toThrow(/denyRead.*no bwrap/);
  });
  it.runIf(authorityMaskAvailability().available)(
    'a masked role reads an empty file and an empty directory (real bwrap)',
    () => {
      const d = scratch('xd-dr2-');
      mkdirSync(join(d, 'hidden'));
      writeFileSync(join(d, 'hidden/a.json'), 'SECRET-DIR');
      writeFileSync(join(d, 'truth.json'), 'SECRET-FILE');
      writeFileSync(join(d, 'open.txt'), 'VISIBLE');
      const mask = roleExecMask({
        bus: bus(),
        roleId: 'w',
        authorityMask: undefined,
        denyRead: [join(d, 'truth.json'), join(d, 'hidden')],
        home: d,
        env: { PATH: '' },
      }) as string[];
      const [bin, args] = maskedCommand(mask, 'sh', [
        '-c',
        `cat '${d}/truth.json' '${d}/hidden/a.json' 2>&1; ls '${d}/hidden'; cat '${d}/open.txt'; grep -r SECRET '${d}' 2>&1 | head -3`,
      ]);
      const r = spawnSync(bin, args, { encoding: 'utf8' });
      expect(r.stdout).not.toContain('SECRET');
      expect(r.stdout).toContain('VISIBLE');
    },
  );
});
