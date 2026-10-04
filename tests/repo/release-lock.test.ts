/**
 * Release lock: one release org run per clone at a time.
 *
 * ## The failure this pins
 *
 * On 2026-09-26 several sessions ran `org run release` for the same repo back
 * to back (2.16.7 … 2.16.12). The only guard was release-captain's PREFLIGHT
 * check that "no other org run release process is running", a process listing
 * at that one moment, so two sessions starting close together both passed it.
 *
 * scripts/release-lock.mjs takes an atomic `mkdir` lock keyed by the clone's
 * git common dir (shared by every worktree of the clone), records who holds
 * it, and treats it as stale only on positive evidence (the holder's pid is
 * dead, its run ended, its bus log went quiet, the machine rebooted, or it is
 * older than the age limit).
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(REPO_ROOT, 'scripts', 'release-lock.mjs');

const temps: string[] = [];
const children: { kill: () => void }[] = [];
afterEach(() => {
  while (children.length) children.pop()?.kill();
  while (temps.length) rmSync(temps.pop() as string, { recursive: true, force: true });
});

/** A clone with one extra worktree, plus a private lock root. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'release-lock-'));
  temps.push(dir);
  const repo = join(dir, 'repo');
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: repo, stdio: 'pipe', encoding: 'utf8' },
    );
  mkdirSync(repo);
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  const worktree = join(dir, 'wt');
  git('worktree', 'add', '-q', worktree);
  const lockRoot = join(dir, 'locks');
  const run = (cwd: string, ...args: string[]) => {
    const r = spawnSync('node', [LOCK, ...args, '--lock-root', lockRoot], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, MONOMIND_ORG_RUN: '' },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const lockDirs = () =>
    existsSync(lockRoot) ? readdirSync(lockRoot).filter((n) => n.endsWith('.lock')) : [];
  const info = () =>
    JSON.parse(readFileSync(join(lockRoot, lockDirs()[0], 'info.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  return { dir, repo, worktree, lockRoot, run, lockDirs, info };
}

/** A live process whose pid can stand in for an org daemon. */
function liveProcess() {
  const child = spawn('sleep', ['60'], { stdio: 'ignore' });
  children.push({ kill: () => child.kill('SIGKILL') });
  return child;
}

async function dead(child: ReturnType<typeof spawn>) {
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGKILL');
  await exited;
}

describe('release-lock', () => {
  it('acquires a free lock and records run, pid, host, start time and git common dir', () => {
    const t = setup();
    const p = liveProcess();
    const r = t.run(t.repo, 'acquire', '--run', 'run-A', '--pid', String(p.pid));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/acquired/);
    const info = t.info();
    expect(info).toMatchObject({ run: 'run-A', pid: p.pid });
    expect(typeof info.host).toBe('string');
    expect(Number.isNaN(Date.parse(String(info.startedAt)))).toBe(false);
    expect(String(info.gitCommonDir)).toMatch(/repo\/\.git$/);
    expect(t.run(t.repo, 'status').status).toBe(3);
  });

  it('refuses a second run from ANOTHER worktree of the same clone and says who holds it', () => {
    const t = setup();
    const p = liveProcess();
    expect(t.run(t.repo, 'acquire', '--run', 'run-A', '--pid', String(p.pid)).status).toBe(0);
    const r = t.run(t.worktree, 'acquire', '--run', 'run-B', '--pid', String(process.pid));
    expect(r.status).toBe(3);
    expect(r.out).toMatch(
      new RegExp(`release already in progress by run run-A \\(pid ${p.pid} on .+, since \\S+\\)`),
    );
    expect(t.info().run).toBe('run-A');
  });

  it('lets exactly one of many simultaneous acquirers win', async () => {
    const t = setup();
    const p = liveProcess();
    const codes = await Promise.all(
      Array.from(
        { length: 8 },
        (_, i) =>
          new Promise<number | null>((resolve) => {
            const c = spawn(
              'node',
              [
                LOCK,
                'acquire',
                '--run',
                `run-${i}`,
                '--pid',
                String(p.pid),
                '--lock-root',
                t.lockRoot,
              ],
              { cwd: t.repo, stdio: 'ignore' },
            );
            c.on('exit', resolve);
          }),
      ),
    );
    expect(codes.filter((c) => c === 0)).toHaveLength(1);
    expect(codes.filter((c) => c === 3)).toHaveLength(7);
  });

  it('is re-entrant for the run that holds it (a restarted captain)', () => {
    const t = setup();
    const p = liveProcess();
    expect(t.run(t.repo, 'acquire', '--run', 'run-A', '--pid', String(p.pid)).status).toBe(0);
    const r = t.run(t.worktree, 'acquire', '--run', 'run-A', '--pid', String(p.pid));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/already held by this run/);
  });

  it('takes over a lock whose holder pid died', async () => {
    const t = setup();
    const p = liveProcess();
    expect(t.run(t.repo, 'acquire', '--run', 'run-A', '--pid', String(p.pid)).status).toBe(0);
    await dead(p);
    expect(t.run(t.repo, 'status').status).toBe(0);
    const q = liveProcess();
    const r = t.run(t.worktree, 'acquire', '--run', 'run-B', '--pid', String(q.pid));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/took over stale lock of run run-A \(pid \d+ is not running\)/);
    expect(t.info().run).toBe('run-B');
  });

  it('takes over a lock older than the age limit', () => {
    const t = setup();
    const p = liveProcess();
    expect(t.run(t.repo, 'acquire', '--run', 'run-A', '--pid', String(p.pid)).status).toBe(0);
    const file = join(t.lockRoot, t.lockDirs()[0], 'info.json');
    const info = t.info();
    info.startedAt = new Date(Date.now() - 13 * 3600_000).toISOString();
    writeFileSync(file, JSON.stringify(info));
    const r = t.run(t.repo, 'acquire', '--run', 'run-B', '--pid', String(p.pid));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/took over stale lock of run run-A \(older than 12h\)/);
  });

  describe('with the org runtime file (--runtime)', () => {
    function orgState(t: ReturnType<typeof setup>, run: string, status: string, pid: number) {
      const orgDir = join(t.dir, 'orgs', 'release');
      mkdirSync(join(orgDir, run), { recursive: true });
      writeFileSync(join(orgDir, run, 'bus.jsonl'), '{}\n');
      const runtime = join(orgDir, 'runtime.json');
      writeFileSync(runtime, JSON.stringify({ status, run, pid }));
      return { orgDir, runtime, bus: join(orgDir, run, 'bus.jsonl') };
    }

    it('takes run id and daemon pid from runtime.json, and the run bus log as heartbeat', () => {
      const t = setup();
      const p = liveProcess();
      const s = orgState(t, 'run-A', 'running', p.pid as number);
      expect(t.run(t.repo, 'acquire', '--runtime', s.runtime).status).toBe(0);
      expect(t.info()).toMatchObject({
        run: 'run-A',
        pid: p.pid,
        runtimeFile: s.runtime,
        heartbeat: s.bus,
      });
    });

    it('is stale once that run ended (stopped / crashed / NO-GO without release)', () => {
      const t = setup();
      const p = liveProcess();
      const s = orgState(t, 'run-A', 'running', p.pid as number);
      expect(t.run(t.repo, 'acquire', '--runtime', s.runtime).status).toBe(0);
      writeFileSync(s.runtime, JSON.stringify({ status: 'crashed', run: 'run-A', pid: p.pid }));
      const r = t.run(t.worktree, 'acquire', '--run', 'run-B', '--pid', String(p.pid));
      expect(r.status).toBe(0);
      expect(r.out).toMatch(/run-A \(its run ended: crashed\)/);
    });

    it('is NOT stale just because another run of the org overwrote runtime.json', () => {
      const t = setup();
      const p = liveProcess();
      const s = orgState(t, 'run-A', 'running', p.pid as number);
      expect(t.run(t.repo, 'acquire', '--runtime', s.runtime).status).toBe(0);
      orgState(t, 'run-B', 'running', p.pid as number);
      const r = t.run(t.repo, 'acquire', '--runtime', s.runtime);
      expect(r.status).toBe(3);
      expect(r.out).toMatch(/in progress by run run-A/);
    });

    it('is stale once its own bus log records org-stopped, even after another run overwrote runtime.json', () => {
      // run-20261004195437-tzfx: stopped by hand, then a second run started and
      // replaced runtime.json (so the file no longer said how run A ended). The
      // holder's pid is invisible from its sandbox, so no other evidence existed
      // until the 30 min heartbeat limit.
      const t = setup();
      const p = liveProcess();
      const s = orgState(t, 'run-A', 'running', p.pid as number);
      expect(t.run(t.repo, 'acquire', '--runtime', s.runtime).status).toBe(0);
      writeFileSync(
        s.bus,
        `{"type":"status","msg":"org started"}\n{"type":"status","reason":"org-stopped","msg":"org stopped"}\n`,
      );
      orgState(t, 'run-B', 'running', p.pid as number);
      const r = t.run(t.repo, 'acquire', '--runtime', s.runtime);
      expect(r.status).toBe(0);
      expect(r.out).toMatch(/run-A \(its run ended: org-stopped\)/);
    });

    it('is stale when the run bus log has been quiet longer than the heartbeat limit', () => {
      const t = setup();
      const p = liveProcess();
      const s = orgState(t, 'run-A', 'running', p.pid as number);
      expect(t.run(t.repo, 'acquire', '--runtime', s.runtime).status).toBe(0);
      const old = new Date(Date.now() - 31 * 60_000);
      utimesSync(s.bus, old, old);
      const r = t.run(t.repo, 'acquire', '--run', 'run-B', '--pid', String(p.pid));
      expect(r.status).toBe(0);
      expect(r.out).toMatch(/run-A \(no activity in .+ for 31 min\)/);
    });

    it('releases with the same --runtime it acquired with', () => {
      const t = setup();
      const p = liveProcess();
      const s = orgState(t, 'run-A', 'running', p.pid as number);
      expect(t.run(t.repo, 'acquire', '--runtime', s.runtime).status).toBe(0);
      expect(t.run(t.repo, 'release', '--runtime', s.runtime).status).toBe(0);
      expect(t.lockDirs()).toEqual([]);
    });
  });

  it('release: only the holder (or --force) removes it; a free lock is a no-op', () => {
    const t = setup();
    const p = liveProcess();
    expect(t.run(t.repo, 'release', '--run', 'run-A').status).toBe(0);
    expect(t.run(t.repo, 'acquire', '--run', 'run-A', '--pid', String(p.pid)).status).toBe(0);
    const other = t.run(t.repo, 'release', '--run', 'run-B');
    expect(other.status).toBe(3);
    expect(t.lockDirs()).toHaveLength(1);
    expect(t.run(t.worktree, 'release', '--run', 'run-A').status).toBe(0);
    expect(t.lockDirs()).toEqual([]);
    expect(t.run(t.repo, 'acquire', '--run', 'run-C', '--pid', String(p.pid)).status).toBe(0);
    expect(t.run(t.repo, 'release', '--force').status).toBe(0);
    expect(t.lockDirs()).toEqual([]);
  });

  it('keys the lock by clone: a different clone has its own lock', () => {
    const a = setup();
    const b = setup();
    const p = liveProcess();
    expect(a.run(a.repo, 'acquire', '--run', 'run-A', '--pid', String(p.pid)).status).toBe(0);
    const r = spawnSync(
      'node',
      [LOCK, 'acquire', '--run', 'run-B', '--pid', String(p.pid), '--lock-root', a.lockRoot],
      { cwd: b.repo, encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
  });
});
