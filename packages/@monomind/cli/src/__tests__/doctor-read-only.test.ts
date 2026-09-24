import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveDoctorMode } from '../commands/doctor-mode.js';

// Issue #335: mono-agent runs `doctor --json` as a health check, whose rule is
// that checks change nothing. These run the built CLI in a scratch project
// with a scratch HOME and compare every file before and after.

const CLI_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cli.js');

/** path → mtime:size:sha1 for every file and directory under each root. */
function snapshot(...roots: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (p: string) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      out.set(p, `dir:${st.mtimeMs}`);
      for (const e of readdirSync(p)) walk(join(p, e));
    } else {
      const hash = createHash('sha1').update(readFileSync(p)).digest('hex');
      out.set(p, `${st.mtimeMs}:${st.size}:${hash}`);
    }
  };
  for (const r of roots) walk(r);
  return out;
}

function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((p) => before.get(p) !== after.get(p)).sort();
}

describe.skipIf(process.platform === 'win32')('doctor --read-only / --offline (built CLI)', () => {
  let root: string;
  let proj: string;
  let home: string;
  let tmp: string;
  let npmLog: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'doctor-read-only-'));
    proj = join(root, 'proj');
    home = join(root, 'home');
    tmp = join(root, 'tmp');
    const bin = join(root, 'bin');
    npmLog = join(root, 'npm-calls.log');
    for (const d of [proj, home, tmp, bin]) mkdirSync(d, { recursive: true });

    // A fake npm that writes where the real one does: into its cache dir (a
    // debug log per command but --version, cache entries on `view`). Only
    // this npm is on PATH.
    writeFileSync(
      join(bin, 'npm'),
      [
        '#!/bin/sh',
        `echo "$* cache=\${npm_config_cache:-$HOME/.npm}" >> "${npmLog}"`,
        'c="${npm_config_cache:-$HOME/.npm}"',
        '[ "$1" = --version ] || { mkdir -p "$c/_logs" && date > "$c/_logs/$$.log"; }',
        'case "$1" in',
        '  view) mkdir -p "$c/_cacache" && date > "$c/_cacache/x" && echo 99.0.0 ;;',
        `  root) echo "${root}/global" ;;`,
        '  *) echo 10.0.0 ;;',
        'esac',
      ].join('\n'),
    );
    chmodSync(join(bin, 'npm'), 0o755);

    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: proj,
        env: { ...process.env, HOME: home },
        stdio: 'ignore',
      });
    git('init', '-q', '.');
    writeFileSync(join(proj, 'package.json'), '{"name":"scratch"}\n');
    mkdirSync(join(proj, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(proj, '.claude', 'agents', 'coder.md'),
      '---\nname: Coder\nslug: coder\ndescription: Writes code\n---\n# Coder\n',
    );
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    // A WAL-mode graph db closed cleanly (no -wal/-shm left): a plain
    // read-only open would create them again.
    mkdirSync(join(proj, '.monomind'));
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const db = new DatabaseSync(join(proj, '.monomind', 'monograph.db'));
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE index_meta(key TEXT PRIMARY KEY, value TEXT); INSERT INTO index_meta VALUES('last_commit_hash','0000000')",
    );
    db.close();
    // An older project copy of the hooks' resolver, which opens the graph db
    // without `immutable`.
    const resolver = join('.claude', 'helpers', 'utils', 'monograph-resolve.cjs');
    mkdirSync(join(proj, dirname(resolver)), { recursive: true });
    writeFileSync(
      join(proj, resolver),
      readFileSync(join(dirname(CLI_BIN), '..', resolver), 'utf8').replace(
        'readIndexedCommit(dbPath, opts.readOnly)',
        'readIndexedCommit(dbPath)',
      ),
    );

    env = {
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: tmp,
      NO_COLOR: '1',
    };
  });

  let env: NodeJS.ProcessEnv;
  const doctor = (...args: string[]) =>
    spawnSync(process.execPath, [CLI_BIN, 'doctor', ...args], {
      cwd: proj,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    });
  const npmCalls = () => (existsSync(npmLog) ? readFileSync(npmLog, 'utf8') : '');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('doctor --json changes no file in the project or HOME', () => {
    const before = snapshot(proj, home);
    const run = doctor('--json');
    const payload = JSON.parse(run.stdout);
    expect(changes(before, snapshot(proj, home))).toEqual([]);
    expect(payload).toMatchObject({ read_only: true, offline: false });
    // The version check still asks the registry, through a throwaway cache
    // that is removed afterwards.
    const version = payload.results.find((r: { component: string }) => r.component === 'version');
    expect(version.status).not.toBe('skipped');
    expect(npmCalls()).toContain(`view monomind version cache=${tmp}/`);
    expect(npmCalls()).toContain(`root -g cache=${tmp}/`);
    expect(readdirSync(tmp)).toEqual([]);
    expect(existsSync(join(proj, '.monomind', 'registry.json'))).toBe(false);
  }, 180_000);

  it('doctor --read-only (human output) changes nothing either', () => {
    const before = snapshot(proj, home);
    const run = doctor('--read-only');
    expect(run.stdout).toContain('read-only');
    expect(changes(before, snapshot(proj, home))).toEqual([]);
  }, 180_000);

  it('doctor --json --offline makes no network call and says which checks it skipped', () => {
    writeFileSync(npmLog, '');
    const before = snapshot(proj, home);
    const payload = JSON.parse(doctor('--json', '--offline').stdout);
    expect(changes(before, snapshot(proj, home))).toEqual([]);
    expect(npmCalls()).not.toMatch(/^view /m);
    expect(payload).toMatchObject({ read_only: true, offline: true });
    const version = payload.results.find((r: { component: string }) => r.component === 'version');
    expect(version).toMatchObject({ status: 'skipped', skipped_reason: 'offline' });
    expect(payload.summary.skipped).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it('doctor --json --fix still writes', () => {
    const payload = JSON.parse(doctor('--json', '--fix', '--offline').stdout);
    expect(payload.read_only).toBe(false);
    expect(existsSync(join(proj, '.gitignore'))).toBe(true);
    expect(existsSync(join(proj, '.monomind', 'registry.json'))).toBe(true);
  }, 180_000);

  it('--read-only --fix is refused', () => {
    const run = doctor('--json', '--read-only', '--fix');
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout).error).toMatch(/--read-only/);
  }, 180_000);
});

describe('resolveDoctorMode', () => {
  it('--json implies read-only unless --fix or --install asks for writes', () => {
    expect(resolveDoctorMode({ json: true })).toEqual({ readOnly: true, offline: false });
    expect(resolveDoctorMode({ json: true, fix: true })).toEqual({
      readOnly: false,
      offline: false,
    });
    expect(resolveDoctorMode({ json: true, install: true }).readOnly).toBe(false);
    expect(resolveDoctorMode({}).readOnly).toBe(false);
  });

  it('an explicit --read-only / --no-read-only wins over --json', () => {
    expect(resolveDoctorMode({ readOnly: true }).readOnly).toBe(true);
    expect(resolveDoctorMode({ json: true, readOnly: false }).readOnly).toBe(false);
  });

  it('refuses flags that contradict the mode', () => {
    expect(resolveDoctorMode({ readOnly: true, fix: true }).error).toMatch(/--read-only/);
    expect(resolveDoctorMode({ offline: true, install: true }).error).toMatch(/--offline/);
    expect(resolveDoctorMode({ offline: true, fix: true }).error).toBeUndefined();
  });
});
