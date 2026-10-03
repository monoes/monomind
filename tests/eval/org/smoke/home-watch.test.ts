// The real-$HOME top-level check (home-watch.mjs) that run-trial.sh runs before and after every trial.
// Every case uses a temp home; the real one is never read, written or listed.
// @ts-nocheck: plain .mjs modules
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HOME_IGNORE, homeOffenders, homeReport, homeSnapshot, isIgnored } from './home-watch.mjs';
import { trialRow, voidReasons } from './report.js';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
const fakeHome = () => {
  const h = scratch('hw-real-');
  for (const d of ['.claude', '.codex', '.cache', '.local', '.config', '.monomind', 'projects'])
    mkdirSync(join(h, d));
  for (const [f, body] of Object.entries({
    '.bashrc': '# rc\n',
    '.bash_history': 'ls\n',
    '.claude.json': '{}',
    notes: 'n',
  }))
    writeFileSync(join(h, f), body);
  // fixture entries must be born clearly before any snapshot taken from here on
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  return h;
};
/** A snapshot "taken" a moment ago, so files made after it have a later birth time. */
const snap = (h: string) => homeSnapshot(h, Date.now());
const later = async () => new Promise((r) => setTimeout(r, 30));
const names = (offs) => offs.map((o) => `${o.kind}:${o.name}`);

describe('the ignore list', () => {
  it('is a small explicit named constant of exact names and prefixes, with no catch-all', () => {
    expect(HOME_IGNORE.length).toBeLessThan(40);
    for (const p of HOME_IGNORE) {
      expect(p).not.toMatch(/^\*|^\.?\*?$/);
      expect(p.startsWith('.')).toBe(true); // nothing that could be an ordinary user file or a role's chosen name
    }
    for (const must of [
      '.claude.json',
      '.claude.json.tmp.*',
      '.claude',
      '.cache',
      '.local',
      '.config',
      '.codex',
      '.npm',
      '.bash_history',
      '.zsh_history',
      '.lesshst',
      '.viminfo',
      '.Xauthority',
    ])
      expect(HOME_IGNORE).toContain(must);
  });
  it('matches exact names and prefix patterns only', () => {
    expect(isIgnored('.claude.json')).toBe(true);
    expect(isIgnored('.claude.json.tmp.2531251.3be25dc6c391')).toBe(true);
    expect(isIgnored('.claude.jsonx')).toBe(false);
    expect(isIgnored('f7.sh')).toBe(false);
    expect(isIgnored('.bashrc')).toBe(false);
    expect(isIgnored('.claude-evil')).toBe(false);
  });
});

describe('homeOffenders', () => {
  it('is clean when nothing changed', () => {
    const h = fakeHome();
    expect(homeOffenders(snap(h), snap(h))).toEqual([]);
  });

  it('a stray new file in ~ is an offender, by name (the f7.sh case)', async () => {
    const h = fakeHome();
    const before = snap(h);
    await later();
    writeFileSync(join(h, 'f7.sh'), '');
    const after = snap(h);
    const offs = homeOffenders(before, after);
    expect(names(offs)).toEqual(['created:f7.sh']);
    const { lines } = homeReport(before, after);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^created {2}.*\/f7\.sh \(file\) size=0 birth=\d{4}-\d\d-\d\dT.* mtime=\d{4}/,
    );
  });

  it('a new directory, a new link and a new file with any other name are offenders too', async () => {
    const h = fakeHome();
    const before = snap(h);
    await later();
    mkdirSync(join(h, 'd'));
    symlinkSync('/etc/hostname', join(h, 'l'));
    writeFileSync(join(h, '.hidden-thing'), 'x');
    writeFileSync(join(h, '.claude.evil'), 'x');
    expect(names(homeOffenders(before, snap(h)))).toEqual([
      'created:.claude.evil',
      'created:.hidden-thing',
      'created:d',
      'created:l',
    ]);
  });

  it('ignored names are not an offender, new or modified', async () => {
    const h = fakeHome();
    const before = snap(h);
    await later();
    writeFileSync(join(h, '.claude.json.tmp.12.abc'), 'tmp'); // claude's atomic-write temp file
    writeFileSync(join(h, '.claude.json'), '{"changed":1}');
    writeFileSync(join(h, '.bash_history'), 'ls\npwd\n');
    writeFileSync(join(h, '.lesshst'), 'x');
    writeFileSync(join(h, '.viminfo'), 'x');
    mkdirSync(join(h, '.npm'));
    writeFileSync(join(h, '.claude/anything'), 'x'); // inside a directory: out of scope
    writeFileSync(join(h, '.cache/blob'), 'x');
    const { lines, notes } = homeReport(before, snap(h));
    expect(lines).toEqual([]);
    // the home directory moved, and the report says so without voiding
    expect(notes.join('\n')).toMatch(/itself was modified/);
  });

  it('modifying an existing, non-ignored file is an offender (size, mtime, link target, type)', async () => {
    const h = fakeHome();
    symlinkSync('/a', join(h, 'link'));
    writeFileSync(join(h, 'same-size'), 'aaaa');
    const before = snap(h);
    await later();
    writeFileSync(join(h, 'notes'), 'now longer');
    writeFileSync(join(h, 'same-size'), 'bbbb'); // same size, new mtime
    utimesSync(join(h, 'same-size'), new Date(), new Date(Date.now() + 5000)); // explicit, not clock-granularity dependent
    utimesSync(join(h, '.bashrc'), new Date(), new Date(Date.now() + 5000));
    rmSync(join(h, 'link'));
    symlinkSync('/b', join(h, 'link'));
    const offs = homeOffenders(before, snap(h));
    expect(names(offs)).toEqual(
      expect.arrayContaining(['changed:.bashrc', 'changed:notes', 'changed:same-size']),
    );
    expect(offs.find((o) => o.name === 'link')).toBeTruthy(); // changed target (and re-born)
  });

  it('a removed non-ignored entry is an offender; an ignored one is not', () => {
    const h = fakeHome();
    const before = snap(h);
    rmSync(join(h, 'notes'));
    rmSync(join(h, '.bash_history'));
    expect(names(homeOffenders(before, snap(h)))).toEqual(['removed:notes']);
  });

  it('a file replaced by rename over an existing name is caught by its birth time', async () => {
    const h = fakeHome();
    const before = snap(h);
    await later();
    writeFileSync(join(h, 'notes.tmp'), 'n');
    // same size and (forced) same mtime as before: only the new inode's birth time differs
    const old = readFileSync(join(h, 'notes'));
    const st = (await import('node:fs')).statSync(join(h, 'notes'));
    utimesSync(join(h, 'notes.tmp'), st.atime, st.mtime);
    (await import('node:fs')).renameSync(join(h, 'notes.tmp'), join(h, 'notes'));
    expect(old.length).toBe(1);
    expect(names(homeOffenders(before, snap(h)))).toEqual(['replaced:notes']);
  });

  it('a directory that merely gained or lost contents is not an offender', async () => {
    const h = fakeHome();
    const before = snap(h);
    await later();
    writeFileSync(join(h, 'projects/work.txt'), 'x');
    expect(homeOffenders(before, snap(h))).toEqual([]);
  });

  it('a file created and removed again inside the window cannot be seen: only a note, never a void', async () => {
    const h = fakeHome();
    const before = snap(h);
    await later();
    writeFileSync(join(h, 'flash'), 'x');
    rmSync(join(h, 'flash'));
    const { lines, notes } = homeReport(before, snap(h));
    expect(lines).toEqual([]);
    expect(notes.join('\n')).toMatch(/created and removed again/);
  });

  it('works on a home it cannot stat an entry of (gone between readdir and lstat)', () => {
    const h = fakeHome();
    expect(Object.keys(homeSnapshot(h).entries).sort()).toContain('.bashrc');
  });
});

describe('env.mjs home-snapshot / home-check (the commands run-trial.sh calls)', () => {
  const run = (home: string, ...args: string[]) =>
    spawnSync('node', [join(here, 'env.mjs'), ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home },
    });

  it('exits 0 and prints nothing on an untouched home, 1 and the offender when ~/f7.sh appears', async () => {
    const h = fakeHome();
    const file = join(scratch('hw-snap-'), 'before.json');
    writeFileSync(file, run(h, 'home-snapshot').stdout);
    expect(JSON.parse(readFileSync(file, 'utf8')).home).toBe(h);
    const clean = run(h, 'home-check', file);
    expect([clean.status, clean.stdout]).toEqual([0, '']);
    await later();
    writeFileSync(join(h, 'f7.sh'), '');
    const dirty = run(h, 'home-check', file);
    expect(dirty.status).toBe(1);
    expect(dirty.stdout).toContain(join(h, 'f7.sh'));
    expect(dirty.stdout).toMatch(/birth=/);
  });

  it('fails closed without a usable before-listing', () => {
    const h = fakeHome();
    const r = run(h, 'home-check', join(h, 'nope.json'));
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/no usable listing/);
  });
});

describe('run-trial.sh voids a trial that wrote ~/f7.sh, and says why (temp home, fake cli, no model)', () => {
  const trial = (home: string, runCmd: string) => {
    const root = scratch('hw-trial-');
    const guard = join(root, 'guard');
    mkdirSync(guard);
    writeFileSync(join(guard, 'g.txt'), 'g');
    writeFileSync(
      join(root, 'trial.json'),
      JSON.stringify({
        name: 'hw-t1',
        scenario: 'research-report',
        contender: 'phase2',
        task: 'x',
        deadlineSeconds: 60,
        guard: [guard],
      }),
    );
    const cli = join(root, 'cli.js');
    writeFileSync(cli, 'process.exit(0)\n');
    chmodSync(cli, 0o755);
    // output to a file, not a pipe: run-trial.sh's helper loops leave a `sleep` that would hold a pipe open
    const out = openSync(join(root, 'run-trial.out'), 'w');
    const r = spawnSync('bash', [join(here, 'run-trial.sh'), root, cli], {
      stdio: ['ignore', out, out],
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        SMOKE_RUN_CMD: runCmd,
      },
    });
    return { root, r };
  };

  it('clean when the run leaves the home alone (only ignored names move)', () => {
    const h = fakeHome();
    const { root, r } = trial(
      h,
      'echo {} > "$HOME/.claude.json.tmp.1.x"; echo ok > "$HOME/.bash_history"',
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'result.json'), 'utf8')).realState).toBe('clean');
    expect(readFileSync(join(root, 'real-state-home.txt'), 'utf8')).toBe('');
  });

  it('VOID when the run creates ~/f7.sh: result.json says VOID and the reason names the file', () => {
    const h = fakeHome();
    const { root, r } = trial(h, 'sleep 1; touch "$HOME/f7.sh"');
    expect(r.status).not.toBe(0);
    const result = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'));
    expect(result.realState).toBe('VOID');
    expect(result.inputs).toBe('clean');
    expect(readFileSync(join(root, 'real-state-home.txt'), 'utf8')).toContain(join(h, 'f7.sh'));
    expect(voidReasons(root, result).join('\n')).toMatch(/real home: created .*f7\.sh \(file\)/);
  });

  it('VOID when the run modifies an existing top-level file such as ~/.bashrc', () => {
    const h = fakeHome();
    const { root } = trial(h, 'sleep 1; echo "alias x=y" >> "$HOME/.bashrc"');
    expect(JSON.parse(readFileSync(join(root, 'result.json'), 'utf8')).realState).toBe('VOID');
    expect(readFileSync(join(root, 'real-state-home.txt'), 'utf8')).toMatch(/changed .*\.bashrc/);
  });

  it('the trial row carries the reason, so the reports can show it', () => {
    const h = fakeHome();
    const { root } = trial(h, 'sleep 1; touch "$HOME/f7.sh"');
    // trialRow wants a scenario manifest: use a real scenario id
    const row = trialRow(root);
    expect(row.voided).toBe(true);
    expect(row.voidReasons.join('\n')).toMatch(/f7\.sh/);
  });
});
