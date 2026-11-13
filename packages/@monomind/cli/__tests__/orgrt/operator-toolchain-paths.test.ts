// packages/@monomind/cli/__tests__/orgrt/operator-toolchain-paths.test.ts
/**
 * #527: node, npm, claude and monomind installed under $HOME (mise, nvm,
 * volta, …) are what the operator's daemon and shells run, so no role may
 * write them. Checks the list (env overrides, symlinked shims, install
 * roots, what is never protected), that one list reaches every layer (file
 * tools, SDK sandbox, bubblewrap mask, planted-path watch), and — in a real
 * bubblewrap mask — that a role can neither overwrite a toolchain under a
 * temp HOME nor rename its parent aside. Every path is a temp dir: no real
 * toolchain is touched.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorityMaskArgs,
  bubblewrapAvailability,
  ensureAuthorityDirs,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { prepareGitGuard } from '../../src/orgrt/git-guard.js';
import {
  operatorMountPoints,
  operatorProtectedPaths,
} from '../../src/orgrt/operator-protected-paths.js';
import {
  installRoots,
  mountPointAncestors,
  resetToolchainMemo,
  TOOLCHAIN_ENV,
  toolchainPaths,
} from '../../src/orgrt/operator-toolchain-paths.js';
import { plantCandidates } from '../../src/orgrt/planted-paths.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';

const dirs: string[] = [];
const scratch = (p: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), p)));
  dirs.push(d);
  return d;
};
beforeEach(() => resetToolchainMemo());
afterEach(() => {
  vi.unstubAllEnvs();
  resetToolchainMemo();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const exe = (p: string, body = '#!/bin/sh\necho REAL\n') => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
  chmodSync(p, 0o755);
};
const link = (target: string, p: string) => {
  mkdirSync(dirname(p), { recursive: true });
  symlinkSync(target, p);
};
/** A probe that sees only what the test built. */
const probe = (home: string, env: NodeJS.ProcessEnv = {}, execPath = join(home, 'none')) =>
  toolchainPaths({ home, env, execPath, packageRoot: null });

describe('the toolchain list', () => {
  it('the running node: its install root, collapsed into the version manager holding it', () => {
    const home = scratch('tc-h-');
    const node = join(home, '.local/share/mise/installs/node/22.12.0/bin/node');
    exe(node);
    const paths = probe(home, {}, node);
    expect(paths).toContain(join(home, '.local/share/mise'));
    expect(paths.filter((p) => p.includes('installs'))).toEqual([]);
    const other = scratch('tc-o-');
    exe(join(other, 'node-v22/bin/node'));
    expect(probe(home, {}, join(other, 'node-v22/bin/node'))).toContain(join(other, 'node-v22'));
  });

  it('version managers that exist are covered; absent ones only when an env var or PATH names them', () => {
    const home = scratch('tc-vm-');
    for (const d of ['.nvm', '.volta', '.config/mise', '.local/share/fnm', '.asdf', '.pyenv', '.rbenv', 'go/bin'])
      mkdirSync(join(home, d), { recursive: true });
    const paths = probe(home);
    for (const d of ['.nvm', '.volta', '.config/mise', '.local/share/fnm', '.asdf', '.pyenv', '.rbenv', 'go/bin'])
      expect(paths).toContain(join(home, d));
    for (const d of ['.fnm', '.local/share/mise', '.cargo/bin']) expect(paths).not.toContain(join(home, d));
    // Not there yet, but PATH already runs from it: covered, so the planted
    // watch catches it appearing.
    const withPath = probe(home, { PATH: join(home, '.cargo/bin') });
    expect(withPath).toContain(join(home, '.cargo/bin'));
  });

  it('honours MISE_DATA_DIR, NVM_DIR, VOLTA_HOME, PNPM_HOME, BUN_INSTALL, CARGO_HOME and GOBIN', () => {
    const home = scratch('tc-env-');
    const alt = scratch('tc-alt-');
    const env = {
      MISE_DATA_DIR: join(alt, 'mise'),
      NVM_DIR: join(alt, 'nvm'),
      VOLTA_HOME: join(alt, 'volta'),
      PNPM_HOME: join(alt, 'pnpm'),
      BUN_INSTALL: join(alt, 'bun'),
      CARGO_HOME: join(alt, 'cargo'),
      GOBIN: join(alt, 'gobin'),
    };
    // Outside $HOME only what exists is covered.
    for (const d of ['mise', 'nvm', 'volta', 'pnpm', 'bun/bin', 'bun/install/global', 'cargo/bin', 'gobin']) mkdirSync(join(alt, d), { recursive: true });
    mkdirSync(join(home, '.nvm'));
    const paths = probe(home, env);
    for (const p of ['mise', 'nvm', 'volta', 'pnpm', 'bun/bin', 'bun/install/global', 'cargo/bin', 'gobin'])
      expect(paths).toContain(join(alt, p));
    // The override replaces the default location.
    expect(paths).not.toContain(join(home, '.nvm'));
  });

  it('pnpm’s home as a whole; bun’s global installs but not its package cache', () => {
    const home = scratch('tc-pn-');
    const pnpm = join(home, '.local/share/pnpm');
    mkdirSync(join(pnpm, 'store/v10'), { recursive: true });
    mkdirSync(join(home, '.bun/install/cache'), { recursive: true });
    const paths = probe(home);
    expect(paths).toContain(pnpm);
    expect(paths).toEqual(
      expect.arrayContaining([join(home, '.bun/bin'), join(home, '.bun/install/global')]),
    );
    for (const p of [join(home, '.bun'), join(home, '.bun/install/cache')]) expect(paths).not.toContain(p);
  });

  it('npm and npx on PATH: a symlinked shim covers its directory and the real npm prefix', () => {
    const home = scratch('tc-sh-');
    const prefix = scratch('tc-prefix-');
    exe(join(prefix, 'lib/node_modules/npm/bin/npm-cli.js'));
    exe(join(prefix, 'lib/node_modules/npm/bin/npx-cli.js'));
    link('../lib/node_modules/npm/bin/npm-cli.js', join(prefix, 'bin/npm'));
    const shims = join(home, 'shims');
    link(join(prefix, 'lib/node_modules/npm/bin/npx-cli.js'), join(shims, 'npx'));
    const paths = probe(home, { PATH: [shims, join(prefix, 'bin')].join(':') });
    expect(paths).toContain(prefix);
    expect(paths).toContain(shims);
  });

  it('claude on PATH: the native installer’s data dir; an npm prefix of ~/.local only its bin and lib/node_modules', () => {
    const home = scratch('tc-cl-');
    exe(join(home, '.local/share/claude/versions/2.1.226'));
    link(join(home, '.local/share/claude/versions/2.1.226'), join(home, '.local/bin/claude'));
    exe(join(home, '.local/lib/node_modules/npm/bin/npm-cli.js'));
    link(join(home, '.local/lib/node_modules/npm/bin/npm-cli.js'), join(home, 'npmbin/npm'));
    const paths = probe(home, { PATH: [join(home, '.local/bin'), join(home, 'npmbin')].join(':') });
    expect(paths).toContain(join(home, '.local/share/claude'));
    expect(paths).toContain(join(home, '.local/bin'));
    expect(paths).toContain(join(home, '.local/lib/node_modules'));
    for (const p of [home, join(home, '.local'), join(home, '.local/share')]) expect(paths).not.toContain(p);
  });

  it('the monomind package root: the npm prefix of a global install, the npx cache dir, or the root itself', () => {
    const home = scratch('tc-pkg-');
    const prefix = join(home, '.nvm/versions/node/v22');
    const global = join(prefix, 'lib/node_modules/monomind/node_modules/@monoes/monomindcli');
    mkdirSync(global, { recursive: true });
    expect(toolchainPaths({ home, env: {}, execPath: join(home, 'x'), packageRoot: global })).toContain(
      join(home, '.nvm'),
    );
    const npx = join(home, '.cache/npx/abc/node_modules/monomind');
    mkdirSync(npx, { recursive: true });
    expect(toolchainPaths({ home, env: {}, execPath: join(home, 'x'), packageRoot: npx })).toContain(
      join(home, '.cache/npx/abc/node_modules'),
    );
    const checkout = join(home, 'src/monomind/packages/cli');
    mkdirSync(checkout, { recursive: true });
    expect(toolchainPaths({ home, env: {}, execPath: join(home, 'x'), packageRoot: checkout })).toContain(
      checkout,
    );
  });

  it('never $HOME or a directory holding it, and nothing a role could not write anyway', () => {
    const home = scratch('tc-never-');
    exe(join(home, 'bin/node'));
    const paths = probe(home, {}, join(home, 'bin/node'));
    expect(paths).toContain(join(home, 'bin'));
    expect(paths.some((p) => home.startsWith(p))).toBe(false);
    expect(installRoots(join(home, 'bin/node'), home)).toEqual([join(home, 'bin'), join(home, 'lib/node_modules')]);
    if (process.getuid?.() !== 0 && existsSync('/usr/bin/env'))
      expect(probe(home, { PATH: '/usr/bin' }, '/usr/bin/env').filter((p) => !p.startsWith(home))).toEqual([]);
  });

  it('a toolchain dir holding the role’s work tree is left writable', () => {
    const home = scratch('tc-wt-');
    const nvm = join(home, '.nvm');
    const cwd = join(nvm, 'work');
    mkdirSync(cwd, { recursive: true });
    expect(operatorProtectedPaths({ home, env: {}, cwd })).not.toContain(nvm);
    expect(operatorProtectedPaths({ home, env: {}, cwd: scratch('tc-wt2-') })).toContain(nvm);
  });

  it('mount points: every renamable directory on the way, none inside a protected path, none past $HOME', () => {
    const home = scratch('tc-mp-');
    const mise = join(home, '.local/share/mise');
    mkdirSync(join(mise, 'installs/node'), { recursive: true });
    const anchors = mountPointAncestors([mise, join(mise, 'installs/node')], { home, roots: [] });
    expect(anchors).toEqual([join(home, '.local/share'), join(home, '.local')]);
    expect(operatorMountPoints({ home, env: {} })).toEqual(
      expect.arrayContaining([join(home, '.local/share'), join(home, '.local')]),
    );
  });
});

describe('one list, every layer', () => {
  it('file tools, the SDK sandbox, the mask and the planted-path watch all get it', async () => {
    const home = scratch('tc-l-');
    const root = scratch('tc-lr-');
    const node = join(home, '.nvm/versions/node/v22/bin/node');
    exe(node);
    mkdirSync(join(home, '.local/share/pnpm/store'), { recursive: true });
    const env = { HOME: home } as NodeJS.ProcessEnv;
    const nvm = join(home, '.nvm');

    // File tools (policy.ts reads homedir() and process.env). Pin every
    // toolchain variable: a CI runner sets its own (NVM_DIR, XDG_*, PATH to
    // /opt/hostedtoolcache…), which would move nvm's root away from this
    // temp HOME.
    vi.stubEnv('HOME', home);
    for (const k of TOOLCHAIN_ENV) vi.stubEnv(k, '');
    vi.stubEnv('NVM_DIR', nvm);
    vi.stubEnv('PATH', dirname(node));
    const engine = new PolicyEngine('dev', {} as never, new OrgBus('o', 'r', scratch('tc-bus-')), root, [root, home], root);
    const denied = await engine.decide('Write', { file_path: node, content: 'x' });
    expect(denied.behavior).toBe('deny');
    expect((denied as { message: string }).message).toMatch(/operator's own sessions run or trust/);
    expect((await engine.decide('Write', { file_path: join(home, 'notes.txt'), content: 'x' })).behavior).toBe('allow');

    // SDK sandbox: denyWrite, mount points in allowWrite, the Edit rules.
    const guard = prepareGitGuard({ level: 'commit', stateDir: scratch('tc-g-'), protectedGitDirs: [] });
    const r = buildClaudeRestrictions(guard as NonNullable<typeof guard>, undefined, { cwd: root, orgRoot: root, home, tmp: scratch('tc-t-'), env }, true);
    const fs = (r.sandbox as { filesystem: { allowWrite: string[]; denyWrite: string[] } }).filesystem;
    expect(fs.denyWrite).toContain(nvm);
    expect(fs.denyWrite).toContain(join(home, '.local/share/pnpm'));
    expect(fs.allowWrite).toContain(join(home, '.local/share'));
    expect(r.disallowedTools).toContain(`Edit(/${nvm}/**)`);

    // The mask: ancestors bound onto themselves before the read-only binds.
    const args = authorityMaskArgs({ home, env, roots: [root], orgRoot: root, cwd: root });
    const ro = args.findIndex((a, i) => a === '--ro-bind' && args[i + 1] === nvm);
    const anchor = args.findIndex((a, i) => a === '--bind' && args[i + 1] === join(home, '.local/share'));
    expect(ro).toBeGreaterThan(0);
    expect(anchor).toBeGreaterThan(0);

    // The planted watch: an entry that does not exist yet is a candidate.
    const cargoBin = join(home, '.cargo/bin');
    expect(plantCandidates({ home, env: { ...env, PATH: cargoBin }, orgRoot: root, cwd: root })).toContain(
      cargoBin,
    );
  });
});

describe.runIf(bubblewrapAvailability().available)('inside the real bubblewrap mask (#527)', () => {
  it('a role runs the toolchain but cannot overwrite it, plant beside it, or rename its parents aside', () => {
    const home = scratch('tc-bw-');
    const root = scratch('tc-bwr-');
    const env = { HOME: home } as NodeJS.ProcessEnv;
    const share = join(home, '.local/share');
    const node = join(share, 'mise/installs/node/22.12.0/bin/node');
    exe(node);
    const nvm = join(home, '.nvm');
    exe(join(nvm, 'versions/node/v22/bin/npm'));
    ensureAuthorityDirs(home, env);
    const [cmd, argv] = maskedCommand(authorityMaskArgs({ home, env, roots: [root], orgRoot: root, cwd: root }), 'bash', [
      '-c',
      [
        `echo "RUN=$(${node})"`,
        `echo "NODE=$(${JSON.stringify(process.execPath)} -e 'process.stdout.write("ok")')"`,
        `echo EVIL > ${node} 2>/dev/null; echo "W1=$?"`,
        `echo EVIL > ${nvm}/versions/node/v22/bin/npx 2>/dev/null; echo "W2=$?"`,
        `mv ${share}/mise ${share}/mise.x 2>/dev/null; echo "R1=$?"`,
        `mv ${share} ${share}.x 2>/dev/null; echo "R2=$?"`,
        `mv ${home}/.local ${home}/.local.x 2>/dev/null; echo "R3=$?"`,
        `mv ${nvm} ${nvm}.x 2>/dev/null; echo "R4=$?"`,
        `mkdir -p "$TMPDIR/npm-global" && echo ok > "$TMPDIR/npm-global/x"; echo "TMPW=$?"`,
        `echo ok > ${root}/work.txt; echo "CWDW=$?"`,
      ].join('; '),
    ]);
    const out = spawnSync(cmd, argv, { encoding: 'utf8', env: { ...process.env, TMPDIR: scratch('tc-bwt-') } });
    const text = `${out.stdout}${out.stderr}`;
    expect(text, text).toMatch(/RUN=REAL/);
    expect(text).toMatch(/NODE=ok/);
    for (const k of ['W1', 'W2', 'R1', 'R2', 'R3', 'R4']) expect(text).not.toMatch(new RegExp(`${k}=0\\b`));
    expect(text).toMatch(/TMPW=0/);
    expect(text).toMatch(/CWDW=0/);
    expect(readFileSync(node, 'utf8')).toContain('echo REAL');
    expect(existsSync(join(nvm, 'versions/node/v22/bin/npx'))).toBe(false);
    for (const p of [join(share, 'mise'), share, join(home, '.local'), nvm]) expect(existsSync(p)).toBe(true);
    expect(readFileSync(join(root, 'work.txt'), 'utf8')).toBe('ok\n');
  });
});
