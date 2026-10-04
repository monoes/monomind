/**
 * #522: the Claude runtime runs an installed Claude Code when one is usable,
 * instead of the 300 MB copy bundled with the SDK.
 */
import type { Stats } from 'node:fs';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_PATH_ENV,
  type ClaudeProbe,
  claudeCandidates,
  compatibleClaudeVersion,
  defaultClaudeProbe,
  findInstalledClaude,
  looksLikeClaude,
  protectedClaudeBinary,
  queryWithExecutable,
  SDK_BUNDLED_CLAUDE_VERSION,
  sdkLoadOptions,
} from '../orgrt/claude-sdk.js';
import { OPTIONAL_DEPENDENCIES } from '../utils/optional-deps.js';

const HOME = '/home/op';
const ME = 1000;

interface Node {
  uid: number;
  mode: number;
  file?: boolean;
  exec?: boolean;
  /** First two bytes; `#!` makes it a script. */
  head?: string;
  /** Real path, when this is a symlink. */
  to?: string;
  version?: string;
}

/** A probe over an in-memory file system. Directories not listed are
 *  root-owned 0755; files must be listed. */
function fakeProbe(nodes: Record<string, Node>, env: NodeJS.ProcessEnv = {}) {
  const version = vi.fn(async (f: string) => {
    const v = nodes[f]?.version;
    if (!v) throw new Error('no version');
    return `${v} (Claude Code)\n`;
  });
  const log = vi.fn();
  const probe: ClaudeProbe = {
    env: { PATH: '/usr/local/bin:/usr/bin', ...env },
    home: HOME,
    platform: 'linux',
    uid: ME,
    roleWritableRoots: [HOME, '/tmp'],
    realpath: (p) => {
      const n = nodes[p];
      if (n?.to) return n.to;
      if (n) return p;
      throw Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
    },
    stat: (p) => {
      const n = nodes[p] ?? { uid: p.startsWith(HOME) ? ME : 0, mode: 0o755 };
      return { uid: n.uid, mode: n.mode, isFile: () => !!n.file } as unknown as Stats;
    },
    isExecutable: (p) => nodes[p]?.exec !== false,
    head: (p) => nodes[p]?.head ?? '\x7fE',
    version,
    log,
  };
  return { probe, version, log };
}

const rootBin = (v = SDK_BUNDLED_CLAUDE_VERSION): Node => ({
  uid: 0,
  mode: 0o755,
  file: true,
  version: v,
});
const userBin = (v = SDK_BUNDLED_CLAUDE_VERSION): Node => ({
  uid: ME,
  mode: 0o755,
  file: true,
  version: v,
});

describe('claudeCandidates', () => {
  it('looks at PATH, then ~/.local/bin, then ~/.claude/local, skipping relative PATH entries', () => {
    expect(
      claudeCandidates({ PATH: `/usr/bin:bin::/opt/c/bin:/usr/bin` }, HOME, 'linux').map(
        (c) => c.path,
      ),
    ).toEqual([
      '/usr/bin/claude',
      '/opt/c/bin/claude',
      `${HOME}/.local/bin/claude`,
      `${HOME}/.claude/local/claude`,
    ]);
  });

  it(`${CLAUDE_PATH_ENV} is the only candidate when set, and "bundled" turns detection off`, () => {
    expect(
      claudeCandidates({ PATH: '/usr/bin', [CLAUDE_PATH_ENV]: '/x/claude' }, HOME, 'linux'),
    ).toEqual([{ path: '/x/claude', explicit: true }]);
    expect(
      claudeCandidates({ PATH: '/usr/bin', [CLAUDE_PATH_ENV]: 'bundled' }, HOME, 'linux'),
    ).toEqual([]);
  });

  it('looks for claude.exe on Windows', () => {
    expect(claudeCandidates({ PATH: 'C:\\bin' }, 'C:\\Users\\op', 'win32')[0].path).toMatch(
      /claude\.exe$/,
    );
  });
});

describe('compatibleClaudeVersion', () => {
  it.each([
    [`${SDK_BUNDLED_CLAUDE_VERSION} (Claude Code)`, true],
    ['2.1.999 (Claude Code)', true],
    ['2.2.0 (Claude Code)\n', true],
    ['2.2.0', false],
    ['mise 2.2.0 (Claude Code)', false],
    ['2.1.225 (Claude Code)', false],
    ['2.0.999', false],
    ['1.9.0', false],
    ['3.0.0', false],
    ['claude', false],
  ])('%s -> %s', (out, ok) => {
    expect(compatibleClaudeVersion(out).ok).toBe(ok);
  });

  it('SDK_BUNDLED_CLAUDE_VERSION is what the pinned SDK bundles', () => {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@anthropic-ai/claude-agent-sdk');
    const dir = dirname(entry);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.version).toBe(OPTIONAL_DEPENDENCIES['@anthropic-ai/claude-agent-sdk'].version);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(SDK_BUNDLED_CLAUDE_VERSION);
  });
});

describe('looksLikeClaude', () => {
  it.each([
    ['/usr/bin/claude', true],
    ['/c/bin/claude.exe', true],
    ['/home/user/.local/share/claude/versions/2.1.283', true],
    ['/home/user/.local/share/claude/2.1.283', false],
    ['/usr/bin/mise', false],
    ['/usr/bin/claude-wrapper', false],
  ])('%s -> %s', (p, ok) => {
    expect(looksLikeClaude(p)).toBe(ok);
  });
});

const NATIVE = `${HOME}/.local/share/claude/versions/2.1.283`;

describe('findInstalledClaude', () => {
  it('uses the first system-installed candidate, resolved to its real path', async () => {
    const { probe, version } = fakeProbe({
      '/usr/bin/claude': { uid: 0, mode: 0o777, to: '/usr/lib/claude/bin/claude' },
      '/usr/lib/claude/bin/claude': rootBin(),
      [`${HOME}/.local/bin/claude`]: rootBin(),
    });
    expect(await findInstalledClaude(probe)).toMatchObject({
      path: '/usr/lib/claude/bin/claude',
      skipped: [],
    });
    expect(version).toHaveBeenCalledExactlyOnceWith('/usr/lib/claude/bin/claude');
  });

  it('refuses a binary under $HOME (role-writable) without running it, and goes on', async () => {
    const { probe, version } = fakeProbe({
      '/usr/local/bin/claude': { uid: ME, mode: 0o777, to: NATIVE },
      [NATIVE]: userBin(),
      '/usr/bin/claude': rootBin(),
    });
    const r = await findInstalledClaude(probe);
    expect(r.path).toBe('/usr/bin/claude');
    expect(r.skipped).toEqual([
      `/usr/local/bin/claude: ${NATIVE} is under ${HOME}, which org roles can write`,
    ]);
    expect(version).toHaveBeenCalledExactlyOnceWith('/usr/bin/claude');
  });

  it('refuses one under $HOME or a temp dir even when root owns it', async () => {
    const { probe } = fakeProbe(
      { [`${HOME}/.local/bin/claude`]: rootBin(), '/tmp/x/claude': rootBin() },
      { PATH: '/tmp/x' },
    );
    const r = await findInstalledClaude(probe);
    expect(r.path).toBeUndefined();
    expect(r.skipped).toEqual([
      '/tmp/x/claude: /tmp/x/claude is under /tmp, which org roles can write',
      `${HOME}/.local/bin/claude: ${HOME}/.local/bin/claude is under ${HOME}, which org roles can write`,
    ]);
  });

  it('refuses a root-owned binary under a directory this user owns', async () => {
    const { probe } = fakeProbe(
      { '/opt/mine': { uid: ME, mode: 0o755 }, '/opt/mine/claude': rootBin() },
      { PATH: '/opt/mine' },
    );
    const r = await findInstalledClaude(probe);
    expect(r.path).toBeUndefined();
    expect(r.skipped[0]).toContain(`/opt/mine is owned by uid ${ME}, not root`);
  });

  it('refuses a binary under a group- or other-writable directory', async () => {
    const { probe } = fakeProbe(
      {
        '/opt/shared': { uid: 0, mode: 0o775 },
        '/opt/shared/claude': rootBin(),
      },
      { PATH: '/opt/shared' },
    );
    const r = await findInstalledClaude(probe);
    expect(r.path).toBeUndefined();
    expect(r.skipped[0]).toContain('/opt/shared is writable by group or others');
  });

  it('(M1) running as root, picks up nothing on its own: roles are root too', async () => {
    const { probe, version } = fakeProbe({ '/usr/bin/claude': rootBin() });
    probe.uid = 0;
    const r = await findInstalledClaude(probe);
    expect(r.path).toBeUndefined();
    expect(r.skipped).toEqual([
      '/usr/bin/claude: running as root: ownership cannot separate a system install from a role-writable one',
    ]);
    expect(version).not.toHaveBeenCalled();
  });

  it('never runs a script or a binary with another name (a mise shim resolves to mise)', async () => {
    const { probe, version } = fakeProbe({
      '/usr/local/bin/claude': { uid: 0, mode: 0o755, to: '/usr/bin/mise' },
      '/usr/bin/mise': rootBin(),
      '/usr/bin/claude': { ...rootBin(), head: '#!' },
    });
    const r = await findInstalledClaude(probe);
    expect(r.path).toBeUndefined();
    expect(r.skipped).toEqual([
      '/usr/local/bin/claude: /usr/bin/mise is not named claude or versions/<x.y.z>, so it is not run',
      `/usr/bin/claude: /usr/bin/claude is a script; Claude Code ${SDK_BUNDLED_CLAUDE_VERSION}+ is a native binary`,
    ]);
    expect(version).not.toHaveBeenCalled();
  });

  it('refuses a version older than the bundled one or of another major, and goes on', async () => {
    const { probe } = fakeProbe({
      '/usr/local/bin/claude': rootBin('2.1.100'),
      '/usr/bin/claude': rootBin(SDK_BUNDLED_CLAUDE_VERSION),
    });
    const r = await findInstalledClaude(probe);
    expect(r.path).toBe('/usr/bin/claude');
    expect(r.skipped[0]).toMatch(
      `is Claude Code 2.1.100, and the Claude runtime needs 2.x, ${SDK_BUNDLED_CLAUDE_VERSION} or newer`,
    );
    const other = fakeProbe({ '/usr/bin/claude': rootBin('3.0.0') });
    expect((await findInstalledClaude(other.probe)).path).toBeUndefined();
  });

  it('falls back to the bundled binary when nothing is installed', async () => {
    const { probe, version } = fakeProbe({});
    expect(await findInstalledClaude(probe)).toMatchObject({ skipped: [] });
    expect(version).not.toHaveBeenCalled();
  });

  it('cannot vouch for any found binary without file ownership (Windows)', async () => {
    const { probe } = fakeProbe({ '/usr/bin/claude': rootBin() });
    probe.uid = undefined;
    expect((await findInstalledClaude(probe)).path).toBeUndefined();
  });

  it(`accepts ${CLAUDE_PATH_ENV} in a directory this user owns, with a warning`, async () => {
    const { probe, log } = fakeProbe(
      {
        [`${HOME}/.local/bin/claude`]: { uid: ME, mode: 0o755, to: NATIVE },
        [NATIVE]: userBin(),
      },
      { [CLAUDE_PATH_ENV]: `${HOME}/.local/bin/claude` },
    );
    expect((await findInstalledClaude(probe)).path).toBe(NATIVE);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatch(/is not a system install .*org roles can replace it/);
  });

  it(`accepts a system-installed ${CLAUDE_PATH_ENV} silently`, async () => {
    const { probe, log } = fakeProbe(
      { '/opt/claude/claude': rootBin() },
      { [CLAUDE_PATH_ENV]: '/opt/claude/claude' },
    );
    expect((await findInstalledClaude(probe)).path).toBe('/opt/claude/claude');
    expect(log).not.toHaveBeenCalled();
  });

  it(`reports a refused ${CLAUDE_PATH_ENV} and does not substitute another binary`, async () => {
    for (const [nodes, why] of [
      [{ '/x/claude': { ...userBin(), mode: 0o775 } }, /is writable by group or others/],
      [{ '/x/claude': { ...userBin(), uid: 4242 } }, /owned by uid 4242, not by this user or root/],
      [{ '/x/claude': { ...userBin(), exec: false } }, /is not executable/],
      [{ '/x/claude': { ...userBin(), head: '#!' } }, /is a script/],
      [{ '/x/claude': userBin('2.0.1') }, /is Claude Code 2\.0\.1/],
      [{}, /it does not exist/],
    ] as const) {
      const { probe, log } = fakeProbe(
        { ...nodes, '/usr/bin/claude': rootBin() },
        { [CLAUDE_PATH_ENV]: '/x/claude' },
      );
      expect((await findInstalledClaude(probe)).path).toBeUndefined();
      const last = log.mock.calls.at(-1)?.[0];
      expect(last).toMatch(why);
      expect(last).toMatch(/Using the Claude Agent SDK's bundled Claude Code/);
    }
    const rel = fakeProbe({}, { [CLAUDE_PATH_ENV]: 'claude' });
    expect((await findInstalledClaude(rel.probe)).path).toBeUndefined();
    expect(rel.log.mock.calls[0][0]).toMatch(/not an absolute path/);
  });
});

describe('sdkLoadOptions', () => {
  it('skips the platform package when a binary was found', () => {
    expect(sdkLoadOptions({ path: '/usr/bin/claude', skipped: [] })).toEqual({
      withoutSdkBinary: true,
    });
    expect(sdkLoadOptions({ skipped: [] })).toEqual({});
  });

  it('tells the operator how to use a refused binary', () => {
    const { note } = sdkLoadOptions({
      skipped: ['/home/user/.local/bin/claude: owned by uid 1000'],
    });
    expect(note).toContain('/home/user/.local/bin/claude: owned by uid 1000');
    expect(note).toContain(CLAUDE_PATH_ENV);
  });
});

describe('with real files', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const scratch = () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'mm-claude-')));
    return dir;
  };

  it.skipIf(process.platform === 'win32')('refuses a script named claude', async () => {
    const file = join(scratch(), 'claude');
    writeFileSync(file, "#!/bin/sh\necho '2.1.300 (Claude Code)'\n");
    chmodSync(file, 0o755);
    const probe = { ...defaultClaudeProbe({ PATH: '', [CLAUDE_PATH_ENV]: file }), log: vi.fn() };
    expect((await findInstalledClaude(probe)).path).toBeUndefined();
    expect(probe.log.mock.calls.at(-1)?.[0]).toMatch(/is a script/);
  });

  it.skipIf(process.platform === 'win32')(
    'runs `--version` on a native binary and refuses output that is not Claude Code',
    async () => {
      // node prints "v24.x.y": a real run, and not a Claude Code version line.
      const file = join(scratch(), 'claude');
      copyFileSync(process.execPath, file);
      chmodSync(file, 0o755);
      const probe = { ...defaultClaudeProbe({ PATH: '', [CLAUDE_PATH_ENV]: file }), log: vi.fn() };
      expect((await findInstalledClaude(probe)).path).toBeUndefined();
      expect(probe.log.mock.calls.at(-1)?.[0]).toMatch(/is Claude Code of an unknown version/);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'protectedClaudeBinary: the real file, and every directory below $HOME on the way',
    () => {
      const home = scratch();
      const file = join(home, '.local', 'share', 'claude', 'versions', '2.1.300');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, '\x7fELF');
      mkdirSync(join(home, '.local', 'bin'));
      symlinkSync(file, join(home, '.local', 'bin', 'claude'));
      const env = { [CLAUDE_PATH_ENV]: join(home, '.local', 'bin', 'claude') };
      expect(protectedClaudeBinary(env, home)).toEqual({
        file,
        dirs: ['.local', '.local/share', '.local/share/claude', '.local/share/claude/versions'].map(
          (d) => join(home, d),
        ),
      });
      expect(protectedClaudeBinary({}, home)).toBeUndefined();
      expect(protectedClaudeBinary({ [CLAUDE_PATH_ENV]: 'bundled' }, home)).toBeUndefined();
      expect(
        protectedClaudeBinary({ [CLAUDE_PATH_ENV]: join(home, 'gone') }, home),
      ).toBeUndefined();
    },
  );
});

describe('queryWithExecutable (#522 review, minor 5)', () => {
  it('always passes the installed Claude Code as pathToClaudeCodeExecutable', () => {
    const query = vi.fn((_: { options?: Record<string, unknown> }) => 'q');
    const q = queryWithExecutable(query as never, process.execPath);
    q({ prompt: 'hi', options: { model: 'haiku', pathToClaudeCodeExecutable: '/elsewhere' } });
    q({ prompt: 'hi' });
    expect(query.mock.calls.map((c) => c[0].options)).toEqual([
      { model: 'haiku', pathToClaudeCodeExecutable: process.execPath },
      { pathToClaudeCodeExecutable: process.execPath },
    ]);
  });

  it('fails with a clear message when that binary is gone', () => {
    const gone = join(tmpdir(), 'mm-no-such-claude', 'versions', '2.1.1');
    expect(existsSync(gone)).toBe(false);
    const q = queryWithExecutable(vi.fn() as never, gone);
    expect(() => q({ prompt: 'hi' })).toThrow(/no longer exists .*looks for Claude Code again/);
  });
});

describe('Claude runtime diagnostics (#595)', () => {
  it('reports the selected version and real path', async () => {
    const { probe } = fakeProbe({ '/usr/bin/claude': rootBin(SDK_BUNDLED_CLAUDE_VERSION) });
    expect((await findInstalledClaude(probe)).claude_code).toEqual({
      used: '/usr/bin/claude',
      version: SDK_BUNDLED_CLAUDE_VERSION,
      skipped: [],
    });
  });
  it('reports skipped native installs without executing a role-writable binary', async () => {
    const native = `${HOME}/.local/share/claude/versions/2.1.999`;
    const { probe, version } = fakeProbe({
      [`${HOME}/.local/bin/claude`]: { uid: ME, mode: 0o755, to: native },
      [native]: userBin('2.1.999'),
    });
    const found = await findInstalledClaude(probe);
    expect(found.claude_code).toMatchObject({
      used: 'bundled',
      version: SDK_BUNDLED_CLAUDE_VERSION,
      skipped: [
        {
          path: `${HOME}/.local/bin/claude`,
          version: '2.1.999',
          reason: expect.stringContaining('org roles can write'),
        },
      ],
    });
    expect(version).not.toHaveBeenCalled();
  });
});
it('reports a newer skipped compatible Claude only once per process', async () => {
  const { reportClaudeSkip } = await import('../orgrt/claude-sdk.js');
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const info = {
      used: 'bundled',
      version: SDK_BUNDLED_CLAUDE_VERSION,
      skipped: [{ path: '/home/op/claude', version: '2.999.0', reason: 'operator owned' }],
    };
    reportClaudeSkip(info);
    reportClaudeSkip(info);
    expect(stderr).toHaveBeenCalledOnce();
    expect(stderr.mock.calls[0][0]).toContain('2.999.0');
  } finally {
    stderr.mockRestore();
  }
});
