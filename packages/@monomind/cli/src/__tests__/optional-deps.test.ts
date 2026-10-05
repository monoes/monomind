/**
 * #428: heavy dependencies are installed on first use into
 * $MONOMIND_HOME/deps, never into the user's project.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dependencyDir,
  depsRoot,
  ensureOptionalDependency,
  lockIsStale,
  manualInstallCommand,
  OPTIONAL_DEPENDENCIES,
  OptionalDependencyError,
} from '../utils/optional-deps.js';
import { OPTIONAL_DEPENDENCY_LOCKS } from '../utils/optional-deps-locks.js';
import {
  FAKE_PINS,
  fakeNpm,
  HOST,
  notFound,
  SDK,
  VERSION,
  writeFakeSdk,
} from './fixtures/optional-deps-fixture.js';

let home: string;
let env: NodeJS.ProcessEnv;
const log = vi.fn();
const base = () => ({ env, resolveOwn: notFound, log, host: HOST, pins: FAKE_PINS });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mm-deps-'));
  env = { MONOMIND_HOME: home };
  log.mockClear();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('ensureOptionalDependency', () => {
  it('imports the pinned copy monomind itself resolves, without installing', async () => {
    const own = mkdtempSync(join(tmpdir(), 'mm-own-'));
    const entry = writeFakeSdk(own, 'own');
    const npm = fakeNpm('unused');
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
      ...base(),
      resolveOwn: () => entry,
      runNpm: npm.run,
    });
    expect(mod.marker).toBe('own');
    expect(npm.calls).toHaveLength(0);
    expect(existsSync(depsRoot(env))).toBe(false);
    rmSync(own, { recursive: true, force: true });
  });

  it('with intoCache it installs into the deps cache even though monomind resolves the pinned copy itself', async () => {
    // `monomind deps install` run from a checkout: the checkout's own node_modules holds the pin, so the
    // plain call counts it as present and writes nothing, while an org role's sandbox can only use the cache.
    const own = mkdtempSync(join(tmpdir(), 'mm-own-'));
    const entry = writeFakeSdk(own, 'own');
    const npm = fakeNpm('cached');
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
      ...base(),
      resolveOwn: () => entry,
      runNpm: npm.run,
      intoCache: true,
    });
    expect(npm.calls).toHaveLength(1);
    expect(mod.marker).toBe('cached');
    expect(existsSync(join(dependencyDir(SDK, env), 'node_modules', SDK, 'package.json'))).toBe(
      true,
    );
    // a second call finds the cache complete and installs nothing more
    await ensureOptionalDependency(SDK, {
      ...base(),
      resolveOwn: () => entry,
      runNpm: npm.run,
      intoCache: true,
    });
    expect(npm.calls).toHaveLength(1);
    rmSync(own, { recursive: true, force: true });
  });

  it('without intoCache a pinned copy monomind resolves is still used and nothing is installed', async () => {
    const own = mkdtempSync(join(tmpdir(), 'mm-own-'));
    const entry = writeFakeSdk(own, 'own');
    const npm = fakeNpm('unused');
    await ensureOptionalDependency(SDK, { ...base(), resolveOwn: () => entry, runNpm: npm.run });
    expect(npm.calls).toHaveLength(0);
    rmSync(own, { recursive: true, force: true });
  });

  it('(M1) ignores a copy monomind resolves at another version and uses the pin', async () => {
    const own = mkdtempSync(join(tmpdir(), 'mm-own-'));
    const entry = writeFakeSdk(own, 'projects-own-sdk', { version: '0.2.0' });
    const npm = fakeNpm('pinned');
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
      ...base(),
      resolveOwn: () => entry,
      runNpm: npm.run,
    });
    expect(mod.marker).toBe('pinned');
    expect(npm.calls).toHaveLength(1);
    rmSync(own, { recursive: true, force: true });
  });

  it('imports an existing install from the deps directory', async () => {
    mkdirSync(depsRoot(env), { recursive: true, mode: 0o700 });
    writeFakeSdk(dependencyDir(SDK, env), 'from-deps');
    const npm = fakeNpm('unused');
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
      ...base(),
      runNpm: npm.run,
    });
    expect(mod.marker).toBe('from-deps');
    expect(npm.calls).toHaveLength(0);
  });

  it('installs with `npm ci` against the shipped lockfile, without scripts, one fetch attempt', async () => {
    const npm = fakeNpm('installed');
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
      ...base(),
      runNpm: async (args, cwd, e) => {
        // The staging dir holds the shipped manifest and lockfile when npm runs.
        expect(JSON.parse(readFileSync(join(cwd, 'package-lock.json'), 'utf8'))).toEqual(
          OPTIONAL_DEPENDENCY_LOCKS[SDK],
        );
        expect(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).dependencies).toEqual({
          [SDK]: VERSION,
        });
        await npm.run(args, cwd, e);
      },
    });
    expect(mod.marker).toBe('installed');
    const { args, cwd } = npm.calls[0];
    expect(args[0]).toBe('ci');
    for (const f of ['--ignore-scripts', '--global=false', '--fetch-retries=0', `--prefix=${cwd}`])
      expect(args).toContain(f);
    expect(args.some((a) => a.startsWith('--fetch-timeout='))).toBe(true);
    expect(cwd.startsWith(depsRoot(env))).toBe(true);
    expect(readdirSync(depsRoot(env)).sort()).toEqual([`${SDK.replace('/', '+')}@${VERSION}`]);
    expect(log.mock.calls[0][0]).toMatch(/Installing it once into/);
  });

  it('reinstalls over a version that does not match the pin', async () => {
    mkdirSync(depsRoot(env), { recursive: true, mode: 0o700 });
    writeFakeSdk(dependencyDir(SDK, env), 'stale', { version: '0.0.1' });
    const npm = fakeNpm('fresh');
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
      ...base(),
      runNpm: npm.run,
    });
    expect(mod.marker).toBe('fresh');
    expect(npm.calls).toHaveLength(1);
  });

  it('(minor 5) repairs an install that lacks the platform package with the Claude binary', async () => {
    mkdirSync(depsRoot(env), { recursive: true, mode: 0o700 });
    writeFakeSdk(dependencyDir(SDK, env), 'partial', { platform: false });
    const npm = fakeNpm('repaired');
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
      ...base(),
      runNpm: npm.run,
    });
    expect(mod.marker).toBe('repaired');
    expect(npm.calls).toHaveLength(1);
  });

  describe('(#522) with an installed Claude Code (withoutSdkBinary)', () => {
    const platformDir = (prefix: string) =>
      join(prefix, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64');

    it('installs the SDK with --omit=optional, and without the platform package', async () => {
      const npm = fakeNpm('js-only');
      const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
        ...base(),
        runNpm: npm.run,
        withoutSdkBinary: true,
      });
      expect(mod.marker).toBe('js-only');
      expect(npm.calls[0].args).toContain('--omit=optional');
      expect(npm.calls[0].args[0]).toBe('ci'); // still the shipped lockfile
      expect(existsSync(platformDir(dependencyDir(SDK, env)))).toBe(false);
      expect(log.mock.calls[0][0]).toMatch(/about 4 MB without its bundled Claude binary/);
    });

    it('accepts an existing install that lacks the platform package', async () => {
      mkdirSync(depsRoot(env), { recursive: true, mode: 0o700 });
      writeFakeSdk(dependencyDir(SDK, env), 'js-only', { platform: false });
      const npm = fakeNpm('unused');
      const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
        ...base(),
        runNpm: npm.run,
        withoutSdkBinary: true,
      });
      expect(mod.marker).toBe('js-only');
      expect(npm.calls).toHaveLength(0);
    });

    it('without it, replaces a JS-only install with the full one', async () => {
      mkdirSync(depsRoot(env), { recursive: true, mode: 0o700 });
      writeFakeSdk(dependencyDir(SDK, env), 'js-only', { platform: false });
      const npm = fakeNpm('full');
      const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
        ...base(),
        runNpm: npm.run,
      });
      expect(mod.marker).toBe('full');
      expect(npm.calls[0].args).not.toContain('--omit=optional');
      expect(existsSync(platformDir(dependencyDir(SDK, env)))).toBe(true);
    });

    it('prints the manual command with --omit=optional, and appends the note', async () => {
      const err = (await ensureOptionalDependency(SDK, {
        ...base(),
        env: { ...env, MONOMIND_NO_AUTO_INSTALL: '1' },
        withoutSdkBinary: true,
      }).catch((e: unknown) => e)) as Error;
      expect(err.message).toContain(manualInstallCommand(SDK, env, true));
      expect(manualInstallCommand(SDK, env, true)).toContain('--omit=optional');
      expect(manualInstallCommand(SDK, env)).not.toContain('--omit=optional');
      await ensureOptionalDependency(SDK, {
        ...base(),
        runNpm: fakeNpm('x').run,
        note: 'Set MONOMIND_CLAUDE_PATH.',
      });
      expect(log.mock.calls[0][0]).toMatch(/instead\)\.\.\. Set MONOMIND_CLAUDE_PATH\.$/);
    });
  });

  it('with MONOMIND_NO_AUTO_INSTALL set, installs nothing and prints the single-quoted command', async () => {
    const npm = fakeNpm('unused');
    const err = (await ensureOptionalDependency(SDK, {
      ...base(),
      env: { ...env, MONOMIND_NO_AUTO_INSTALL: '1' },
      runNpm: npm.run,
    }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(OptionalDependencyError);
    expect(err.message).toContain(manualInstallCommand(SDK, env));
    expect(err.message).toContain(`npm install --prefix '${dependencyDir(SDK, env)}'`);
    expect(npm.calls).toHaveLength(0);
    expect(existsSync(depsRoot(env))).toBe(false);
  });

  it('quotes a path with a single quote safely in the manual command', () => {
    const cmd = manualInstallCommand(SDK, { MONOMIND_HOME: "/h/o'brien" });
    expect(cmd).toContain(`--prefix '/h/o'\\''brien/deps/`);
  });

  it('treats MONOMIND_NO_AUTO_INSTALL=0 as unset', async () => {
    const npm = fakeNpm('installed');
    await ensureOptionalDependency(SDK, {
      ...base(),
      env: { ...env, MONOMIND_NO_AUTO_INSTALL: '0' },
      runNpm: npm.run,
    });
    expect(npm.calls).toHaveLength(1);
  });

  it('refuses any package that is not in the allow-list', async () => {
    const npm = fakeNpm('unused');
    await expect(
      ensureOptionalDependency('left-pad; rm -rf ~' as typeof SDK, { ...base(), runNpm: npm.run }),
    ).rejects.toThrow(/not a dependency monomind installs/);
    expect(npm.calls).toHaveLength(0);
  });

  it('rethrows a resolution failure that is not "package missing"', async () => {
    await expect(
      ensureOptionalDependency(SDK, {
        ...base(),
        resolveOwn: () => {
          throw new SyntaxError('broken package.json');
        },
        runNpm: fakeNpm('unused').run,
      }),
    ).rejects.toThrow('broken package.json');
  });

  it('reports a failed install with the manual command and leaves no partial directory', async () => {
    const err = (await ensureOptionalDependency(SDK, {
      ...base(),
      runNpm: async (args) => {
        const prefix = args.find((a) => a.startsWith('--prefix='))?.slice(9) as string;
        writeFileSync(join(prefix, 'half-written'), '');
        throw new Error('npm exited 1: E404');
      },
    }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(OptionalDependencyError);
    expect(err.message).toContain('E404');
    expect(err.message).toContain(manualInstallCommand(SDK, env));
    expect(existsSync(dependencyDir(SDK, env))).toBe(false);
    expect(readdirSync(depsRoot(env))).toEqual([]);
  });

  it('in a read-only deps dir (an org role), fails with a message for the operator', async () => {
    const err = (await ensureOptionalDependency(SDK, {
      ...base(),
      runNpm: async () => {
        throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
      },
    }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(OptionalDependencyError);
    expect(err.message).toMatch(/Org roles cannot install into it; ask the operator/);
    expect(err.message).toContain(manualInstallCommand(SDK, env));
  });

  it('never runs npm in, or writes to, the current project', async () => {
    const project = mkdtempSync(join(tmpdir(), 'mm-proj-'));
    const manifest = '{ "name": "users-project", "dependencies": {} }\n';
    writeFileSync(join(project, 'package.json'), manifest);
    const cwd = process.cwd();
    process.chdir(project);
    try {
      const npm = fakeNpm('installed');
      await ensureOptionalDependency(SDK, { ...base(), runNpm: npm.run });
      expect(npm.calls[0].cwd.startsWith(project)).toBe(false);
      expect(npm.calls[0].args.some((a) => a.includes(project))).toBe(false);
    } finally {
      process.chdir(cwd);
    }
    expect(readFileSync(join(project, 'package.json'), 'utf8')).toBe(manifest);
    expect(readdirSync(project)).toEqual(['package.json']);
    rmSync(project, { recursive: true, force: true });
  });
});

describe('install lock', () => {
  it('installs once when two callers race', async () => {
    const npm = fakeNpm('raced', 300);
    const opts = { ...base(), runNpm: npm.run };
    const [a, b] = await Promise.all([
      ensureOptionalDependency<{ marker: string }>(SDK, opts),
      ensureOptionalDependency<{ marker: string }>(SDK, opts),
    ]);
    expect([a.marker, b.marker]).toEqual(['raced', 'raced']);
    expect(npm.calls).toHaveLength(1);
    expect(existsSync(`${dependencyDir(SDK, env)}.lock`)).toBe(false);
  });

  const writeOwner = (lock: string, owner: object) => {
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner));
  };
  const id = { pidNamespace: () => 'pid:[1]', bootId: () => 'boot-a' };

  it('takes over a lock whose owner died in our pid namespace', async () => {
    const lock = `${dependencyDir(SDK, env)}.lock`;
    writeOwner(lock, { pid: 2147483646, token: 't', ns: readNs(), boot: readBoot() });
    const npm = fakeNpm('recovered');
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, {
      ...base(),
      runNpm: npm.run,
    });
    expect(mod.marker).toBe('recovered');
    expect(existsSync(lock)).toBe(false);
  });

  it('(minor 1) never judges a pid from another pid namespace dead', () => {
    const lock = join(home, 'x.lock');
    writeOwner(lock, { pid: 2147483646, token: 't', ns: 'pid:[2]', boot: 'boot-a' });
    expect(lockIsStale(lock, id)).toBe(false);
    writeOwner(lock, { pid: 2147483646, token: 't', ns: 'pid:[1]', boot: 'boot-a' });
    expect(lockIsStale(lock, id)).toBe(true);
    writeOwner(lock, { pid: process.pid, token: 't', ns: 'pid:[1]', boot: 'boot-a' });
    expect(lockIsStale(lock, id)).toBe(false);
    // A lock from a previous boot is stale whatever its pid.
    writeOwner(lock, { pid: process.pid, token: 't', ns: 'pid:[2]', boot: 'boot-old' });
    expect(lockIsStale(lock, id)).toBe(true);
  });

  it('(minor 1) keeps a finished install and discards its own copy', async () => {
    const npm = fakeNpm('second', 0);
    const opts = {
      ...base(),
      runNpm: async (args: string[], cwd: string, e: NodeJS.ProcessEnv) => {
        // Another process (whose lock we took over) finishes meanwhile.
        writeFakeSdk(dependencyDir(SDK, env), 'first');
        await npm.run(args, cwd, e);
      },
    };
    mkdirSync(depsRoot(env), { recursive: true, mode: 0o700 });
    const mod = await ensureOptionalDependency<{ marker: string }>(SDK, opts);
    expect(mod.marker).toBe('first');
    expect(readdirSync(depsRoot(env))).toEqual([`${SDK.replace('/', '+')}@${VERSION}`]);
  });
});

describe('pins', () => {
  it('pins the SDK to the version the CLI develops and tests against', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies[SDK]).toBe(VERSION);
    expect(pkg.dependencies[SDK]).toBeUndefined();
  });

  it('(minor 3) ships a lockfile per package, pinned to the same version, with integrity', () => {
    for (const [name, spec] of Object.entries(OPTIONAL_DEPENDENCIES)) {
      const lock = OPTIONAL_DEPENDENCY_LOCKS[name as keyof typeof OPTIONAL_DEPENDENCIES];
      const pkgs = lock.packages as Record<string, { version?: string; integrity?: string }>;
      expect(pkgs[''] as unknown).toMatchObject({ dependencies: { [name]: spec.version } });
      expect(pkgs[`node_modules/${name}`].version).toBe(spec.version);
      for (const [path, p] of Object.entries(pkgs))
        if (path) expect(p.integrity).toMatch(/^sha512-/);
    }
  });
});

function readNs(): string | undefined {
  try {
    return readlinkSync('/proc/self/ns/pid');
  } catch {
    return undefined;
  }
}
function readBoot(): string | undefined {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return undefined;
  }
}
