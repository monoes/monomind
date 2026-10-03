// A trial the harness ends by a kill leaves the runtime's sandbox mount-point stubs behind (parallel-sweep-3 p1t: an empty
// 0444 ~/.mcp.json, after `timeout` sent SIGTERM at the deadline). The runtime now releases them on SIGTERM/SIGINT
// itself; for the SIGKILL that follows `timeout --kill-after`, which no handler can catch, run-trial.sh calls the runtime's
// own reclaim() on the trial's ledger once the org process is gone (stubs-reclaim.mjs). Every case uses a temp home: the
// real one is never read, written or listed.
// @ts-nocheck: plain .mjs modules
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SandboxStubs,
  sandboxStubPaths,
} from '../../../../packages/@monomind/cli/src/orgrt/sandbox-stubs.js';
import { homeReport, homeSnapshot } from './home-watch.mjs';
import { reclaimTrialStubs } from './stubs-reclaim.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A trial root with its own stub ledger (env.mjs: <root>/.state/stubs), a workspace and a temp home. */
function trial() {
  const root = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'reclaim-')));
  dirs.push(root);
  const cwd = join(root, 'workspace');
  const home = join(root, 'home');
  for (const d of [
    join(cwd, '.claude'),
    join(cwd, '.git'),
    join(home, '.claude'),
    join(root, '.state/stubs'),
  ])
    mkdirSync(d, { recursive: true });
  const ledger = join(root, '.state/stubs/ledger.json');
  const paths = sandboxStubPaths({ cwd, home, writableRoots: [cwd, home], env: {} });
  return { root, cwd, home, ledger, paths };
}
const present = (paths: string[]) => paths.filter((p) => existsSync(p));
/** The runtime that held the stubs was killed: its ledger entries name a pid that no longer exists. */
function killRuntime(ledger: string) {
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  const j = JSON.parse(readFileSync(ledger, 'utf8'));
  for (const e of j.entries) e.pid = dead;
  writeFileSync(ledger, JSON.stringify(j));
}

describe('reclaimTrialStubs: the post-trial reclaim of a killed trial', () => {
  it('removes the stubs the dead runtime created, leaves a path that existed before the run, and the home check stays clean', () => {
    const t = trial();
    const mcp = join(t.home, '.mcp.json');
    writeFileSync(join(t.home, '.keep'), 'x');
    const beforeHome = homeSnapshot(t.home, Date.now() + 1000); // listing taken before the trial
    const pre = present(t.paths);
    new SandboxStubs(t.ledger).hold('run-1', t.paths); // the trial's runtime, in a process that is then killed
    expect(existsSync(mcp)).toBe(true);
    killRuntime(t.ledger);
    const removed = reclaimTrialStubs(t.root, SandboxStubs);
    expect(removed).toContain(mcp);
    expect(present(t.paths)).toEqual(pre);
    // the cleanup is not an offender: nothing is new, replaced or removed in the home against the earlier listing
    expect(homeReport(beforeHome, homeSnapshot(t.home)).lines).toEqual([]);
    expect(reclaimTrialStubs(t.root, SandboxStubs)).toEqual([]); // twice is harmless
  });

  it('never removes a path that existed before the run (an owner-held empty ~/.mcp.json) or one that was filled or replaced', () => {
    const t = trial();
    const mcp = join(t.home, '.mcp.json');
    writeFileSync(mcp, '');
    chmodSync(mcp, 0o444);
    writeFileSync(join(t.cwd, '.bashrc'), '# mine\n'); // non-empty, pre-existing
    const pre = present(t.paths);
    new SandboxStubs(t.ledger).hold('run-1', t.paths);
    const filled = join(t.cwd, '.gitconfig');
    chmodSync(filled, 0o644);
    writeFileSync(filled, '[user]\n'); // one of ours, filled during the run
    killRuntime(t.ledger);
    reclaimTrialStubs(t.root, SandboxStubs);
    expect(readFileSync(mcp, 'utf8')).toBe('');
    expect(readFileSync(join(t.cwd, '.bashrc'), 'utf8')).toBe('# mine\n');
    expect(readFileSync(filled, 'utf8')).toBe('[user]\n');
    expect(present(t.paths).sort()).toEqual([...pre, filled].sort());
  });

  it('a trial with no ledger (a baseline that never held a stub, or a failed prepare) reclaims nothing', () => {
    const t = trial();
    expect(reclaimTrialStubs(t.root, SandboxStubs)).toEqual([]);
    expect(reclaimTrialStubs(join(t.root, 'missing'), SandboxStubs)).toEqual([]);
  });
});

describe('stubs-reclaim.mjs and run-trial.sh', () => {
  it('the command never fails a trial: with no built runtime next to the cli it says so and exits 0', () => {
    const t = trial();
    const r = spawnSync(
      process.execPath,
      [join(here, 'stubs-reclaim.mjs'), t.root, join(t.root, 'nowhere/bin/cli.js')],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/no built runtime/);
  });

  it('run-trial.sh reclaims after the org process is gone and before it compares the real home', () => {
    const sh = readFileSync(join(here, 'run-trial.sh'), 'utf8');
    const reclaim = sh.indexOf('stubs-reclaim.mjs');
    expect(reclaim).toBeGreaterThan(sh.indexOf('--kill-after=60'));
    expect(reclaim).toBeLessThan(sh.indexOf('env.mjs" home-check'));
    expect(sh.slice(reclaim, reclaim + 200)).toMatch(/\|\| true|\|\| :/); // best effort, never the trial's verdict
  });
});
