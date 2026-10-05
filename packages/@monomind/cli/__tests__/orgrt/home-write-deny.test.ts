// packages/@monomind/cli/__tests__/orgrt/home-write-deny.test.ts
/**
 * policy.sandbox.homeWriteAllow: the role's whole process tree sees $HOME through a throwaway
 * overlay (reads fall through to the real home, every write lands in memory and goes when the
 * layer ends), and only the allowlisted subpaths are the real, writable ones. Found in the first
 * paid parallel-sweep trials: a role ran `cat > ~/f7.sh <<EOF` and created a file in the real
 * home. Everything below runs through the real bubblewrap in a TEMP home, the way a role's Bash
 * runs (inside the layer, and inside a nested sandbox like the SDK's).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authorityMaskAvailability, maskedCommand } from '../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { roleExecMask } from '../../src/orgrt/exec-deny.js';
import { homeLayerAvailability, homeWriteLayer } from '../../src/orgrt/home-write-deny.js';
import { RolePolicySchema } from '../../src/orgrt/types-policy.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const bus = () => new OrgBus('o', 'r', scratch('hw-bus-'));
const ALLOW = ['.claude', '.codex', '.gemini'];

/** A temp home shaped like a real one: runner dirs with dummy credentials, config, ordinary files. */
const fakeHome = () => {
  const h = scratch('hw-home-');
  for (const [p, body] of Object.entries({
    '.claude/.credentials.json': '{"claudeAiOauth":"dummy"}',
    '.claude/settings.json': '{}',
    '.codex/auth.json': '{"tokens":"dummy"}',
    '.gemini/antigravity-cli/settings.json': '{"auth":"dummy"}',
    '.claude.json': '{"oauthAccount":"dummy"}',
    '.bashrc': '# rc\n',
    '.cache/app/blob': 'cache',
    'Documents/notes.txt': 'notes',
  })) {
    mkdirSync(join(h, p, '..'), { recursive: true });
    writeFileSync(join(h, p), body);
  }
  return h;
};

/** Top level of a home: name, type, size and mtime of every entry, plus the file contents. */
const listing = (h: string) =>
  readdirSync(h)
    .filter((n) => !ALLOW.includes(n)) // the allowlisted runner dirs are meant to change
    .sort()
    .map((n) => {
      const st = statSync(join(h, n));
      return `${n} ${st.isDirectory() ? 'd' : 'f'} ${st.size} ${st.mtimeMs}`;
    });
const tree = (h: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      out.push(p.slice(h.length));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(h);
  return out.sort();
};

describe('homeWriteLayer (the bubblewrap arguments)', () => {
  it('overlays the real home path and binds back only existing allowlisted entries, read-write', () => {
    const h = fakeHome();
    const args = homeWriteLayer({
      home: h,
      env: {},
      allow: ['.claude', '.codex', '.nope', '.claude.json.tmp'],
    });
    expect(args.slice(0, 4)).toEqual(['--overlay-src', h, '--tmp-overlay', h]);
    const binds: string[] = [];
    for (let i = 0; i < args.length; i++) if (args[i] === '--bind') binds.push(args[i + 1]);
    expect(binds.sort()).toEqual([join(h, '.claude'), join(h, '.codex')].sort());
  });

  it('takes absolute entries under the home, and refuses ones that would reopen it', () => {
    const h = fakeHome();
    const abs = homeWriteLayer({ home: h, env: {}, allow: [join(h, '.gemini')] });
    expect(abs).toContain(join(h, '.gemini'));
    for (const bad of ['.', '', h, '..', '../x', 'Documents/../..'])
      expect(() => homeWriteLayer({ home: h, env: {}, allow: [bad] })).toThrow(/homeWriteAllow/);
  });

  it('ignores entries outside the home (they are not behind the overlay anyway)', () => {
    const h = fakeHome();
    const out = scratch('hw-out-');
    const args = homeWriteLayer({ home: h, env: {}, allow: [out] });
    expect(args).toEqual(['--overlay-src', h, '--tmp-overlay', h]);
  });

  it("keeps the role's workspace, org root, allowWrite and the runners' config dirs writable when they are under the home", () => {
    const h = fakeHome();
    for (const d of ['work/cwd', 'org', 'extra', 'cfg', 'cx']) mkdirSync(join(h, d), { recursive: true });
    const args = homeWriteLayer({
      home: h,
      env: { CLAUDE_CONFIG_DIR: join(h, 'cfg'), CODEX_HOME: join(h, 'cx') },
      allow: [],
      writable: [join(h, 'work/cwd'), join(h, 'org'), join(h, 'extra'), '/var/tmp', undefined],
    });
    const binds = args.filter((_, i) => args[i - 1] === '--bind').sort();
    expect(binds).toEqual(
      ['cfg', 'cx', 'extra', 'org', 'work/cwd'].map((d) => join(h, d)).sort(),
    );
  });
});

describe('roleExecMask with homeWriteAllow', () => {
  const base = { roleId: 'w', home: scratch('hw-h-'), env: { PATH: '' } as NodeJS.ProcessEnv };
  it('is unchanged without it (the existing mask comes back untouched)', () => {
    const m = ['--dev-bind', '/', '/'];
    expect(roleExecMask({ ...base, bus: bus(), authorityMask: m, denyExec: [] })).toBe(m);
    expect(roleExecMask({ ...base, bus: bus(), authorityMask: m })).toBe(m);
  });

  it('puts the overlay right after the root bind, before every later bind, and keeps the rest', () => {
    const m = ['--dev-bind', '/', '/', '--ro-bind', '/a', '/a', '--tmpfs', '/x'];
    const out = roleExecMask({
      ...base,
      bus: bus(),
      authorityMask: m,
      homeWriteAllow: ['.claude'],
      availability: { available: true },
      homeAvailability: { available: true },
    }) as string[];
    expect(out.slice(0, 3)).toEqual(['--dev-bind', '/', '/']);
    expect(out.slice(3, 7)).toEqual(['--overlay-src', base.home, '--tmp-overlay', base.home]);
    expect(out.join(' ')).toContain('--ro-bind /a /a --tmpfs /x');
  });

  it('builds a mask of its own when the role has none', () => {
    const out = roleExecMask({
      ...base,
      bus: bus(),
      authorityMask: undefined,
      homeWriteAllow: [],
      availability: { available: true },
      homeAvailability: { available: true },
    }) as string[];
    expect(out.slice(0, 7)).toEqual([
      '--dev-bind',
      '/',
      '/',
      '--overlay-src',
      base.home,
      '--tmp-overlay',
      base.home,
    ]);
  });

  it('fails closed when the overlay cannot be made: the role does not start', () => {
    const b = bus();
    expect(() =>
      roleExecMask({
        ...base,
        bus: b,
        authorityMask: undefined,
        homeWriteAllow: ['.claude'],
        availability: { available: true },
        homeAvailability: { available: false, reason: 'bwrap too old' },
      }),
    ).toThrow(/homeWriteAllow.*bwrap too old/);
  });

  it('is a known sandbox key (the schema is strict)', () => {
    expect(RolePolicySchema.parse({ sandbox: { homeWriteAllow: ['.claude'] } }).sandbox).toEqual({
      homeWriteAllow: ['.claude'],
    });
    expect(() => RolePolicySchema.parse({ sandbox: { homeWriteAllow: 'x' } })).toThrow();
  });
});

describe.runIf(authorityMaskAvailability().available && homeLayerAvailability().available)(
  'a role in the layer cannot change the home (real bwrap, temp home)',
  () => {
    const h = fakeHome();
    const work = join(h, 'work/cwd');
    mkdirSync(work, { recursive: true });
    // describe bodies run even when runIf is false, and roleExecMask refuses without bubblewrap
    const mask = (
      authorityMaskAvailability().available && homeLayerAvailability().available
        ? roleExecMask({
            bus: bus(),
            roleId: 'w',
            authorityMask: undefined,
            denyExec: ['node'],
            homeWriteAllow: ALLOW,
            writableRoots: [work],
            home: h,
            env: { PATH: process.env.PATH ?? '' },
          })
        : []
    ) as string[];
    const run = (cmd: string, nested = false) => {
      const script = nested
        ? // the SDK's Bash sandbox: read-only root, the home among the writable roots
          `bwrap --ro-bind / / --dev /dev --proc /proc --unshare-pid --bind '${h}' '${h}' --bind '${work}' '${work}' -- sh -c '${cmd.replace(/'/g, `'\\''`)}'`
        : cmd;
      const [bin, args] = maskedCommand(mask, 'sh', ['-c', script]);
      return spawnSync(bin, args, {
        cwd: work,
        encoding: 'utf8',
        timeout: 30_000,
        env: { PATH: process.env.PATH ?? '', HOME: h },
      });
    };

    it('control: the layer starts, reads fall through, the workspace is writable for real', () => {
      const r = run(
        'cat ~/.bashrc ~/Documents/notes.txt ~/.cache/app/blob; echo ok > ~/work/cwd/out.txt; ls ~',
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('# rc');
      expect(r.stdout).toContain('notes');
      expect(readFileSync(join(work, 'out.txt'), 'utf8')).toBe('ok\n');
    });

    const attempts: Array<[string, string]> = [
      ['echo > ~/f7.sh', 'echo x > ~/f7.sh && cat ~/f7.sh'],
      ['cd $TMPDIR && cat > ~/f7.sh <<EOF', 'cd "${TMPDIR:-/tmp}" && cat > ~/f7.sh <<EOF\necho hi\nEOF\ncat ~/f7.sh'],
      ['touch ~/x', 'touch ~/x && test -e ~/x'],
      ['mkdir ~/d', 'mkdir ~/d && mkdir ~/d/e && test -d ~/d/e'],
      ['ln -s ~/l', 'ln -s /etc/passwd ~/l && test -L ~/l'],
      ['ln (hard link)', 'ln ~/.bashrc ~/hardlink && test -e ~/hardlink'],
      ['cp into ~', 'cp ~/.bashrc ~/copy && test -e ~/copy'],
      ['rename within ~', 'mv ~/.bashrc ~/.bashrc.old && test -e ~/.bashrc.old'],
      ['rename a directory within ~', 'mv ~/Documents ~/Docs2 && test -d ~/Docs2'],
      ['delete a file', 'rm ~/.bashrc && ! test -e ~/.bashrc'],
      ['delete a directory tree', 'rm -r ~/Documents && ! test -e ~/Documents'],
      ['overwrite an existing file', 'echo evil >> ~/.bashrc && echo evil > ~/Documents/notes.txt'],
      ['write below an ordinary dir', 'echo x > ~/.cache/app/new && echo y > ~/.cache/app/blob'],
      ['chmod an existing file', 'chmod 777 ~/.bashrc'],
      ['the CLI temp-file-plus-rename of ~/.claude.json', 'echo {} > ~/.claude.json.tmp.1.abc && mv ~/.claude.json.tmp.1.abc ~/.claude.json && cat ~/.claude.json'],
      ['dd / tee / sed -i', 'echo a | tee ~/t1 >/dev/null; sed -i s/rc/pwned/ ~/.bashrc; dd if=/dev/zero of=~/z bs=1 count=4 2>/dev/null'],
    ];
    it.each(attempts)('%s: never reaches the real home', (_n, cmd) => {
      const before = listing(h);
      const treeBefore = tree(h);
      const rc = readFileSync(join(h, '.bashrc'), 'utf8');
      const notes = readFileSync(join(h, 'Documents/notes.txt'), 'utf8');
      for (const nested of [false, true]) {
        const r = run(cmd, nested);
        // the layer lets the role's command succeed (it writes into its own throwaway view) or
        // fails it: what must hold is that the home itself did not change
        expect(r.stderr).not.toMatch(/Can't|bwrap:/);
        expect(listing(h)).toEqual(before);
        expect(tree(h)).toEqual(treeBefore);
        expect(readFileSync(join(h, '.bashrc'), 'utf8')).toBe(rc);
        expect(readFileSync(join(h, 'Documents/notes.txt'), 'utf8')).toBe(notes);
        expect(existsSync(join(h, 'f7.sh'))).toBe(false);
        expect(readFileSync(join(h, '.claude.json'), 'utf8')).toBe('{"oauthAccount":"dummy"}');
      }
    });

    it('control: without homeWriteAllow the same command does create the file in the home', () => {
      const open = roleExecMask({
        bus: bus(),
        roleId: 'w',
        authorityMask: undefined,
        denyExec: ['node'],
        home: h,
        env: { PATH: process.env.PATH ?? '' },
      }) as string[];
      const [bin, args] = maskedCommand(open, 'sh', ['-c', 'echo x > ~/f7.sh']);
      spawnSync(bin, args, { env: { PATH: process.env.PATH ?? '', HOME: h } });
      expect(existsSync(join(h, 'f7.sh'))).toBe(true);
      rmSync(join(h, 'f7.sh'));
    });

    it('a file the role writes in ~ is seen by its own later commands in the same layer, then gone', () => {
      const r = run('echo kept > ~/f7.sh; cat ~/f7.sh; sh -c "cat ~/f7.sh"');
      expect(r.stdout).toBe('kept\nkept\n');
      expect(existsSync(join(h, 'f7.sh'))).toBe(false);
    });

    it('the allowlisted runner dirs are real: credentials read, state written and renamed', () => {
      const r = run(
        [
          'cat ~/.claude/.credentials.json ~/.codex/auth.json ~/.gemini/antigravity-cli/settings.json',
          'echo new > ~/.claude/session.jsonl',
          'mkdir -p ~/.claude/projects/p && echo t > ~/.claude/projects/p/a.tmp && mv ~/.claude/projects/p/a.tmp ~/.claude/projects/p/a.jsonl',
          'echo refreshed > ~/.codex/auth.json.tmp && mv ~/.codex/auth.json.tmp ~/.codex/auth.json',
          'echo s > ~/.gemini/antigravity-cli/state.db',
          'echo w >> ~/.codex/history.jsonl',
        ].join('; '),
      );
      expect(r.stdout).toContain('"claudeAiOauth":"dummy"');
      expect(r.stdout).toContain('"tokens":"dummy"');
      expect(r.stdout).toContain('"auth":"dummy"');
      expect(readFileSync(join(h, '.claude/session.jsonl'), 'utf8')).toBe('new\n');
      expect(readFileSync(join(h, '.claude/projects/p/a.jsonl'), 'utf8')).toBe('t\n');
      expect(readFileSync(join(h, '.codex/auth.json'), 'utf8')).toBe('refreshed\n');
      expect(readFileSync(join(h, '.gemini/antigravity-cli/state.db'), 'utf8')).toBe('s\n');
      expect(readFileSync(join(h, '.codex/history.jsonl'), 'utf8')).toBe('w\n');
    });

    it('the same allowlisted writes work from a nested (SDK-style) sandbox', () => {
      const r = run('echo n > ~/.claude/nested.txt; echo n2 > ~/work/cwd/nested.txt', true);
      expect(r.status).toBe(0);
      expect(readFileSync(join(h, '.claude/nested.txt'), 'utf8')).toBe('n\n');
      expect(readFileSync(join(work, 'nested.txt'), 'utf8')).toBe('n2\n');
    });

    it('a symlink planted in the allowlisted dir does not lead out to the rest of the home', () => {
      run('ln -s ~ ~/.claude/home-link; echo x > ~/.claude/home-link/f7.sh');
      expect(existsSync(join(h, 'f7.sh'))).toBe(false);
    });

    it('the denyExec mask still applies on top (a masked program does not run)', () => {
      const r = run('node -e 1; echo "rc=$?"');
      expect(r.stdout).not.toMatch(/rc=0/);
    });

    it('the SDK stub mount points keep working: stubs created beforehand in ~/.claude are the real files', () => {
      writeFileSync(join(h, '.claude/CLAUDE.md'), '');
      const r = run(
        `bwrap --ro-bind / / --dev /dev --bind '${h}' '${h}' --ro-bind /dev/null ~/.claude/CLAUDE.md -- sh -c 'cat ~/.claude/CLAUDE.md | wc -c; echo x > ~/.claude/CLAUDE.md; echo rc=$?'`,
      );
      expect(r.stdout).toContain('0');
      expect(r.stdout).toMatch(/rc=[12]/);
      expect(readFileSync(join(h, '.claude/CLAUDE.md'), 'utf8')).toBe('');
    });
  },
);

const claudeBin = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).stdout.trim();
describe.runIf(
  claudeBin && authorityMaskAvailability().available && homeLayerAvailability().available,
)('the real claude CLI in the layer (no model call)', () => {
  const h = fakeHome();
  // describe bodies run even when runIf is false, and roleExecMask refuses without bubblewrap
  const mask = (
    authorityMaskAvailability().available && homeLayerAvailability().available
      ? roleExecMask({
          bus: bus(),
          roleId: 'w',
          authorityMask: undefined,
          denyExec: ['node'],
          homeWriteAllow: ALLOW,
          home: h,
          env: { PATH: process.env.PATH ?? '' },
        })
      : []
  ) as string[];
  const claude = (...a: string[]) => {
    const [bin, args] = maskedCommand(mask, claudeBin, a);
    return spawnSync(bin, args, {
      cwd: h,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: h,
        TMPDIR: scratch('hw-tmp-'),
        DISABLE_AUTOUPDATER: '1',
      },
    });
  };
  it('starts and prints its version', () => {
    const r = claude('--version');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Claude Code/);
  });
  it('writes its config through temp-file-plus-rename in the layer and leaves the home top level alone', () => {
    const before = listing(h);
    const r = claude('mcp', 'add', 'probe', '--', 'true');
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/not saved/);
    expect(listing(h)).toEqual(before);
    expect(readFileSync(join(h, '.claude.json'), 'utf8')).toBe('{"oauthAccount":"dummy"}');
    // what it keeps in its own directory is real
    expect(existsSync(join(h, '.claude/backups'))).toBe(true);
  });
});
