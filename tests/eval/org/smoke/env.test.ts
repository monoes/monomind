import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module
import { leaks, prepareTrialHome, realStateFingerprint } from './env.mjs';

const fakeHome = () => {
  const h = mkdtempSync(join(tmpdir(), 'real-home-'));
  for (const d of [
    'deps',
    'org-skills',
    'models',
    'orgs',
    'orgrt-broker',
    'orgrt-operator',
    'logs',
  ])
    mkdirSync(join(h, '.monomind', d), { recursive: true });
  writeFileSync(join(h, '.monomind/orgrt-broker/prod.json'), '{"org":"production-org"}');
  return h;
};

describe('the trial home', () => {
  it('points MONOMIND_HOME, the broker and the operator directory inside the trial root', () => {
    const root = mkdtempSync(join(tmpdir(), 'trial-'));
    const env = prepareTrialHome(root, fakeHome());
    for (const v of Object.values(env) as string[])
      expect(v.startsWith(join(root, '.state'))).toBe(true);
    expect(Object.keys(env).sort()).toEqual([
      'MONOMIND_HOME',
      'MONOMIND_ORGRT_BROKER_DIR',
      'MONOMIND_ORGRT_OPERATOR_DIR',
      'MONOMIND_PROJECTS_DIR',
    ]);
  });

  it('links only the read-only installs from the real state, and nothing it writes', () => {
    const real = fakeHome();
    const env = prepareTrialHome(mkdtempSync(join(tmpdir(), 'trial-')), real);
    for (const n of ['deps', 'org-skills', 'models']) {
      expect(lstatSync(join(env.MONOMIND_HOME, n)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(env.MONOMIND_HOME, n))).toBe(join(real, '.monomind', n));
    }
    expect(existsSync(join(env.MONOMIND_HOME, 'logs'))).toBe(false);
    expect(existsSync(join(env.MONOMIND_HOME, 'orgs'))).toBe(false);
  });

  it('is idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'trial-'));
    const real = fakeHome();
    expect(prepareTrialHome(root, real)).toEqual(prepareTrialHome(root, real));
  });
});

describe('the real-state checks', () => {
  it('fingerprints the watched directories by name', () => {
    const real = fakeHome();
    expect(realStateFingerprint(real)).toEqual({
      orgs: [],
      'orgrt-broker': ['prod.json'],
      'orgrt-operator': [],
    });
  });

  it('finds no leak when nothing names the trial, and finds a file or a file name that does', () => {
    const real = fakeHome();
    expect(leaks('smoke-x-phase2-1', real)).toEqual([]);
    writeFileSync(join(real, '.monomind/logs/a.log'), 'started smoke-x-phase2-1');
    writeFileSync(join(real, '.monomind/orgrt-broker/smoke-x-phase2-1.json'), '{}');
    expect(leaks('smoke-x-phase2-1', real).sort()).toEqual([
      join(real, '.monomind/logs/a.log'),
      join(real, '.monomind/orgrt-broker/smoke-x-phase2-1.json'),
    ]);
  });

  it('ignores what already named the trial before it started (an earlier dry run with the same name)', () => {
    const real = fakeHome();
    const old = join(real, '.monomind/orgrt-broker/smoke-x-phase2-1.json');
    writeFileSync(old, '{}');
    utimesSync(old, 1_000, 1_000); // long before
    const fresh = join(real, '.monomind/logs/new.log');
    writeFileSync(fresh, 'smoke-x-phase2-1 started');
    const since = Date.now() - 60_000;
    expect(leaks('smoke-x-phase2-1', real, since)).toEqual([fresh]);
    expect(leaks('smoke-x-phase2-1', real)).toHaveLength(2); // with no start time, everything counts
  });

  it('counts a directory whose contents changed after the start, not only its own timestamp', () => {
    const real = fakeHome();
    const dir = join(real, '.monomind/projects/smoke-x-phase2-1-abc');
    mkdirSync(join(dir, 'lancedb'), { recursive: true });
    writeFileSync(join(dir, 'origin.json'), '{}');
    utimesSync(join(dir, 'origin.json'), 1_000, 1_000);
    utimesSync(join(dir, 'lancedb'), 1_000, 1_000);
    utimesSync(dir, 1_000, 1_000);
    expect(leaks('smoke-x-phase2-1', real, Date.now() - 60_000)).toEqual([]);
    writeFileSync(join(dir, 'lancedb/memory.db'), 'x'); // a store written into it during the trial
    expect(leaks('smoke-x-phase2-1', real, Date.now() - 60_000)).toEqual([dir]);
  });
});
