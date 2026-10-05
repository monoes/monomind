/**
 * #544: the test setup moves HOME and every variable that points into the
 * home (XDG base dirs, toolchain overrides, PATH entries), and the real-home
 * guard notices entries created, removed or replaced in a home's top level.
 * Everything here works on temp dirs; nothing touches the real home.
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ORG_ROLE_ENV_KEYS,
  pathWithoutHome,
  UNSET_KEYS,
  useTestHome,
  XDG_DIRS,
} from './isolated-home.global.js';
import { checkHome, diffHome, snapshotHome } from './real-home-guard.js';

const base = mkdtempSync(join(tmpdir(), 'mm-env-isolation-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const under = (p: string | undefined, dir: string) => !!p && (p === dir || p.startsWith(dir + sep));

describe('the running test process is isolated (#544)', () => {
  const home = process.env.HOME!;
  const realHome = process.env.MONOMIND_TEST_REAL_HOME;

  it('runs in a throwaway home with a temporary directory of its own', () => {
    expect(realHome).toBeTruthy();
    expect(home).not.toBe(realHome);
    // The home itself was made under the configured TMPDIR, which may
    // intentionally live under the real HOME (#591). Temp dirs a test makes go
    // into a run temp root next to it, removed with the run.
    expect(basename(home)).toMatch(/^mm-test-(run-)?home-.+/);
    expect(basename(tmpdir())).toMatch(/^(t|f)-.+/);
    expect(under(tmpdir(), home)).toBe(false);
  });

  it('points each XDG base dir under the temp home', () => {
    for (const [key, rel] of Object.entries(XDG_DIRS)) {
      expect(process.env[key], key).toBe(join(home, rel));
    }
  });

  it('unsets the toolchain overrides', () => {
    for (const key of UNSET_KEYS) expect(process.env[key], key).toBeUndefined();
  });

  it('drops the markers an org role session sets (#560)', () => {
    expect(ORG_ROLE_ENV_KEYS).toEqual(
      expect.arrayContaining(['MONOMIND_ORG_ROLE', 'MONOMIND_AGENT_EXEC']),
    );
    for (const key of ORG_ROLE_ENV_KEYS) expect(process.env[key], key).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'keeps no PATH entry under the real home but node',
    () => {
      const nodeBin = dirname(process.execPath);
      const inHome = (process.env.PATH ?? '')
        .split(delimiter)
        .filter((p) => under(p, realHome!) && p !== nodeBin);
      expect(inHome).toEqual([]);
    },
  );
});

describe('useTestHome', () => {
  it('moves XDG dirs into the home, creates them, and drops the overrides', () => {
    const keys = [
      ...Object.keys(XDG_DIRS),
      ...UNSET_KEYS,
      ...ORG_ROLE_ENV_KEYS,
      'HOME',
      'MONOMIND_GLOBAL_BRAIN_DIR',
    ];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const home = join(base, 'use-home');
    try {
      for (const k of UNSET_KEYS) process.env[k] = '/real/home/elsewhere';
      for (const k of ORG_ROLE_ENV_KEYS) process.env[k] = 'builder';
      process.env.XDG_DATA_HOME = '/real/elsewhere/.local/share';
      useTestHome(home);
      expect(process.env.HOME).toBe(home);
      for (const [key, rel] of Object.entries(XDG_DIRS)) {
        expect(process.env[key], key).toBe(join(home, rel));
      }
      for (const k of UNSET_KEYS) expect(process.env[k], k).toBeUndefined();
      for (const k of ORG_ROLE_ENV_KEYS) expect(process.env[k], k).toBeUndefined();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it('strips PATH entries under the home and keeps the rest', () => {
    const fakeHome = join(sep, 'home', 'someone');
    const path = [
      join(fakeHome, '.cargo', 'bin'),
      join(sep, 'usr', 'bin'),
      join(fakeHome, '.local', 'share', 'mise', 'shims'),
      join(sep, 'home', 'someone-else', 'bin'),
    ].join(delimiter);
    const out = pathWithoutHome(path, fakeHome).split(delimiter);
    // The running node's bin dir leads, so a spawned node/npm matches the run.
    expect(out[0]).toBe(dirname(process.execPath));
    expect(out.slice(1)).toEqual(
      [join(sep, 'usr', 'bin'), join(sep, 'home', 'someone-else', 'bin')].filter(
        (p) => p !== out[0],
      ),
    );
    expect(out.some((p) => under(p, fakeHome))).toBe(false);
  });
});

describe('real-home guard', () => {
  function fakeHome(name: string): string {
    const home = join(base, name);
    for (const d of [
      '.local/share/keyrings',
      '.local/state',
      '.config/gh',
      '.cache',
      '.monomind',
    ]) {
      mkdirSync(join(home, d), { recursive: true });
    }
    writeFileSync(join(home, '.bashrc'), '');
    return home;
  }

  it('reports nothing when only file contents change', () => {
    const home = fakeHome('quiet');
    const before = snapshotHome(home);
    writeFileSync(join(home, '.local', 'share', 'keyrings', 'login.keyring'), 'x');
    expect(diffHome(before, snapshotHome(home)).changes).toEqual([]);
  });

  it('reports created, removed and replaced entries', () => {
    const home = fakeHome('noisy');
    const before = snapshotHome(home);
    mkdirSync(join(home, '.config', 'mise'));
    rmSync(join(home, '.bashrc'));
    renameSync(join(home, '.local', 'share', 'keyrings'), join(base, 'noisy-aside'));
    mkdirSync(join(home, '.local', 'share', 'keyrings'));
    const { changes } = diffHome(before, snapshotHome(home));
    expect(changes).toEqual(
      expect.arrayContaining([
        { kind: 'created', path: join(home, '.config', 'mise') },
        { kind: 'removed', path: join(home, '.bashrc') },
        { kind: 'replaced', path: join(home, '.local', 'share', 'keyrings') },
      ]),
    );
    expect(changes).toHaveLength(3);
  });

  it('fails only in strict mode', () => {
    const home = fakeHome('strict');
    const before = snapshotHome(home);
    mkdirSync(join(home, '.cache', 'new'));
    const saved = process.env.MONOMIND_TEST_HOME_GUARD;
    const write = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      delete process.env.MONOMIND_TEST_HOME_GUARD;
      expect(() => checkHome(home, before)).not.toThrow();
      process.env.MONOMIND_TEST_HOME_GUARD = 'strict';
      expect(() => checkHome(home, before)).toThrow(/changed the real home/);
    } finally {
      process.stderr.write = write;
      if (saved === undefined) delete process.env.MONOMIND_TEST_HOME_GUARD;
      else process.env.MONOMIND_TEST_HOME_GUARD = saved;
    }
  });
});
