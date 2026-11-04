/**
 * #526 (1): assertTrustedTree cannot tell a tree planted by this same user
 * from monomind's own install, so the file it imports and the Claude binary
 * the SDK spawns must match SHA-256 pins shipped beside the lockfiles.
 * (3): no directory above the deps root may be a symlink this user could
 * replace.
 */

import type * as fs from 'node:fs';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Opens of a file named sdk.mjs: each one is a hash computed. */
const opened = vi.hoisted(() => ({ entry: 0 }));
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  return {
    ...real,
    openSync: ((p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p).endsWith('sdk.mjs')) opened.entry++;
      return (real.openSync as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof real.openSync,
  };
});

import { withPinnedExecutable } from '../orgrt/claude-sdk-pin.js';
import {
  dependencyDir,
  ensureOptionalDependency,
  OPTIONAL_DEPENDENCIES,
} from '../utils/optional-deps.js';
import {
  OPTIONAL_DEPENDENCIES_UNPINNED,
  OPTIONAL_DEPENDENCY_CODE_PINS,
  OPTIONAL_DEPENDENCY_LOCKS,
} from '../utils/optional-deps-locks.js';
import {
  claudeBinaryCandidates,
  resetPinnedCodeCache,
  sha256File,
  verifyPinnedCode,
} from '../utils/optional-deps-verify.js';
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
const opts = (extra: Record<string, unknown> = {}) => ({
  env,
  resolveOwn: notFound,
  log: () => {},
  host: HOST,
  runNpm: fakeNpm('npm').run,
  ...extra,
});
const plant = (marker = 'PLANTED CODE RAN') => writeFakeSdk(dependencyDir(SDK, env), marker);
const fail = (m: string): never => {
  throw new Error(m);
};

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'mm-pins-')));
  env = { MONOMIND_HOME: home };
  mkdirSync(join(home, 'deps'), { recursive: true, mode: 0o700 });
  resetPinnedCodeCache();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('the pins stay in step with the pinned versions and lockfiles', () => {
  const pins = OPTIONAL_DEPENDENCY_CODE_PINS[SDK];
  const lock = OPTIONAL_DEPENDENCY_LOCKS[SDK].packages as Record<string, { version?: string }>;

  it('pins the SDK at the version it installs, with one binary per platform package', () => {
    expect(pins?.version).toBe(OPTIONAL_DEPENDENCIES[SDK].version);
    const platformPackages = Object.keys(lock)
      .filter((p) => p.startsWith(`node_modules/${SDK}-`))
      .map((p) => p.slice('node_modules/'.length));
    expect(Object.keys(pins?.binaries ?? {}).sort()).toEqual(platformPackages.sort());
    for (const [pkg, pin] of Object.entries(pins?.binaries ?? {})) {
      expect(lock[`node_modules/${pkg}`].version).toBe(pins?.version);
      expect(pin.file).toBe(pkg.includes('-win32-') ? 'claude.exe' : 'claude');
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(pins?.entry).toMatchObject({
      file: 'sdk.mjs',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('matches the registry copy this checkout installed (sdk.mjs and this host’s binary)', async () => {
    // The CLI's devDependency is the same pinned version, installed by pnpm
    // from the registry with the tarball's integrity checked.
    const entry = createRequire(import.meta.url).resolve(SDK);
    expect(await sha256File(entry)).toBe(pins?.entry.sha256);
    const req = createRequire(entry);
    const found = claudeBinaryCandidates({ platform: process.platform, arch: process.arch })
      .map((spec) => {
        try {
          return { pkg: spec.slice(0, spec.lastIndexOf('/')), bin: req.resolve(spec) };
        } catch {
          return undefined;
        }
      })
      .find((x) => x);
    expect(found, 'pnpm installs this host’s platform package').toBeDefined();
    if (found) expect(await sha256File(found.bin)).toBe(pins?.binaries?.[found.pkg]?.sha256);
  });

  it('pins monofence-ai at its version, every .js file of the copy this checkout resolves', async () => {
    const mf = OPTIONAL_DEPENDENCY_CODE_PINS['monofence-ai'];
    expect(mf?.version).toBe(OPTIONAL_DEPENDENCIES['monofence-ai'].version);
    const lockPkgs = OPTIONAL_DEPENDENCY_LOCKS['monofence-ai'].packages as Record<
      string,
      { version?: string }
    >;
    expect(lockPkgs['node_modules/monofence-ai'].version).toBe(mf?.version);
    // The workspace copy is built from the published source; a change to it
    // needs a version bump and new pins, or monomind refuses to load it.
    const pkgDir = join(realpathSync(new URL('../../node_modules/monofence-ai', import.meta.url)));
    const pinned = [mf?.entry, ...(mf?.modules ?? [])].map((f) => f?.file);
    const onDisk: string[] = [];
    const walk = (d: string, rel: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true }))
        if (e.isDirectory()) walk(join(d, e.name), `${rel}${e.name}/`);
        else if (e.name.endsWith('.js')) onDisk.push(`${rel}${e.name}`);
    };
    walk(join(pkgDir, 'dist'), 'dist/');
    expect(pinned.sort()).toEqual(onDisk.sort());
    for (const f of [mf?.entry, ...(mf?.modules ?? [])])
      expect(await sha256File(join(pkgDir, f?.file as string)), f?.file).toBe(f?.sha256);
  });

  it('pins @huggingface/transformers at its version, to the entry of the copy this checkout resolves', async () => {
    const tf = OPTIONAL_DEPENDENCY_CODE_PINS['@huggingface/transformers'];
    expect(tf?.version).toBe(OPTIONAL_DEPENDENCIES['@huggingface/transformers'].version);
    const entry = createRequire(import.meta.url).resolve('@huggingface/transformers');
    expect(entry.endsWith(tf?.entry.file as string)).toBe(true);
    expect(await sha256File(entry)).toBe(tf?.entry.sha256);
  });

  it('pins every optional dependency or lists it as unpinned, with a reason', () => {
    for (const name of Object.keys(OPTIONAL_DEPENDENCIES)) {
      const pinned = !!OPTIONAL_DEPENDENCY_CODE_PINS[name];
      const reason = OPTIONAL_DEPENDENCIES_UNPINNED[name];
      expect(pinned !== !!reason, name).toBe(true);
      if (reason) expect(reason.length, name).toBeGreaterThan(20);
    }
    expect(Object.keys(OPTIONAL_DEPENDENCIES_UNPINNED)).toEqual(['@puppeteer/browsers']);
  });

  it('tries the Claude binaries in the SDK’s order', () => {
    const base = '@anthropic-ai/claude-agent-sdk';
    expect(claudeBinaryCandidates({ platform: 'linux', arch: 'x64', musl: false })).toEqual([
      `${base}-linux-x64/claude`,
      `${base}-linux-x64-musl/claude`,
    ]);
    expect(claudeBinaryCandidates({ platform: 'linux', arch: 'arm64', musl: true })).toEqual([
      `${base}-linux-arm64-musl/claude`,
      `${base}-linux-arm64/claude`,
    ]);
    expect(claudeBinaryCandidates({ platform: 'win32', arch: 'x64' })).toEqual([
      `${base}-win32-x64/claude.exe`,
    ]);
    expect(claudeBinaryCandidates({ platform: 'darwin', arch: 'arm64' })).toEqual([
      `${base}-darwin-arm64/claude`,
    ]);
  });
});

describe('a same-user plant fails the pins', () => {
  it('refuses a planted SDK in the deps dir before importing it, with a clear message', async () => {
    plant();
    const err = await ensureOptionalDependency(SDK, opts()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/^Refusing to load @anthropic-ai\/claude-agent-sdk@\d/);
    expect(msg).toMatch(/sdk\.mjs has SHA-256 [0-9a-f]{64}, but monomind pins [0-9a-f]{64}/);
    expect(msg).toContain(`Delete ${dependencyDir(SDK, env)}`);
    expect(msg).not.toContain('PLANTED CODE RAN');
  });

  it('refuses a genuine entry with a planted Claude binary', async () => {
    plant();
    const bin = join(
      dependencyDir(SDK, env),
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
    );
    writeFileSync(bin, '#!/bin/sh\necho planted\n');
    await expect(ensureOptionalDependency(SDK, opts({ pins: FAKE_PINS }))).rejects.toThrow(
      /claude-agent-sdk-linux-x64\/claude has SHA-256 .*but monomind pins/,
    );
  });

  it('refuses a package.json that points the import at another file', async () => {
    plant();
    const pkg = join(dependencyDir(SDK, env), 'node_modules', SDK);
    writeFileSync(join(pkg, 'evil.mjs'), 'export const marker = "PLANTED";\n');
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: SDK, version: VERSION, type: 'module', exports: './evil.mjs' }),
    );
    await expect(ensureOptionalDependency(SDK, opts({ pins: FAKE_PINS }))).rejects.toThrow(
      /package\.json points to .*evil\.mjs/,
    );
  });

  it('refuses a package whose other module files were changed', async () => {
    const pkgDir = dirname(writeFakeSdk(join(home, 'mod'), 'x'));
    writeFileSync(join(pkgDir, 'lib.js'), 'export const x = 1;\n');
    const pins = {
      ...FAKE_PINS[SDK],
      modules: [{ file: 'lib.js', sha256: await sha256File(join(pkgDir, 'lib.js')) }],
    };
    const where = { entry: join(pkgDir, 'sdk.mjs'), pkgDir, remove: pkgDir };
    await verifyPinnedCode(SDK, pins, where, HOST, fail);
    writeFileSync(join(pkgDir, 'lib.js'), 'export const x = "planted";\n');
    await expect(verifyPinnedCode(SDK, pins, where, HOST, fail)).rejects.toThrow(
      /lib\.js has SHA-256/,
    );
  });

  it('refuses a platform binary the pins do not list', async () => {
    plant();
    const unpinned = { [SDK]: { ...FAKE_PINS[SDK], binaries: {} } };
    await expect(ensureOptionalDependency(SDK, opts({ pins: unpinned }))).rejects.toThrow(
      /comes from @anthropic-ai\/claude-agent-sdk-linux-x64, which has no pin/,
    );
  });

  it('holds a copy found up monomind’s own module path (~/node_modules) to the same pins', async () => {
    const planted = writeFakeSdk(join(home, 'node_modules-root'), 'OWN PLANT');
    const err = await ensureOptionalDependency(SDK, opts({ resolveOwn: () => planted })).catch(
      (e: Error) => e,
    );
    expect((err as Error).message).toMatch(/Refusing to load .*sdk\.mjs has SHA-256/);
    // With matching pins the same copy loads.
    const mod = await ensureOptionalDependency<{ marker: string }>(
      SDK,
      opts({ resolveOwn: () => planted, pins: FAKE_PINS }),
    );
    expect(mod.marker).toBe('OWN PLANT');
  });

  it('loads the genuine SDK this checkout installed, with the shipped pins', async () => {
    const mod = await ensureOptionalDependency<{ query: unknown }>(SDK, {
      env,
      log: () => {},
    });
    expect(typeof mod.query).toBe('function');
  });
});

describe('verified once per process, again when the file changes', () => {
  it('does not rehash an unchanged file, and rehashes one that changed', async () => {
    const pkgDir = dirname(writeFakeSdk(join(home, 'p'), 'x'));
    const entry = join(pkgDir, 'sdk.mjs');
    const pins = FAKE_PINS[SDK];
    const where = { entry, pkgDir, remove: pkgDir };
    opened.entry = 0;
    await verifyPinnedCode(SDK, pins, where, HOST, fail);
    await verifyPinnedCode(SDK, pins, where, HOST, fail);
    expect(opened.entry).toBe(1);
    const later = new Date(Date.now() + 5000);
    utimesSync(entry, later, later);
    await verifyPinnedCode(SDK, pins, where, HOST, fail);
    expect(opened.entry).toBe(2);
    writeFileSync(entry, 'export const marker = "CHANGED";\n');
    await expect(verifyPinnedCode(SDK, pins, where, HOST, fail)).rejects.toThrow(/has SHA-256/);
  });
});

describe('every query runs the binary that was verified (#526 review)', () => {
  const load = async () => {
    plant('PINNED');
    const mod = await ensureOptionalDependency<{ query: never }>(SDK, opts({ pins: FAKE_PINS }));
    const calls: Array<Record<string, unknown>> = [];
    const fakeQuery = ((p: { options?: Record<string, unknown> }) => {
      calls.push(p.options ?? {});
      const spawn = p.options?.spawnClaudeCodeProcess as ((o: unknown) => unknown) | undefined;
      return spawn?.({ command: 'x', args: [] });
    }) as never;
    const sdk = withPinnedExecutable({ ...(mod as object), query: fakeQuery });
    const bin = realpathSync(
      join(dependencyDir(SDK, env), 'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude'),
    );
    const query = sdk.query as unknown as (p: unknown) => unknown;
    return { sdk, query, calls, bin };
  };

  it('passes the verified binary as pathToClaudeCodeExecutable on every query', async () => {
    const { sdk, query, calls, bin } = await load();
    expect(sdk.executable).toBe(bin);
    query({ prompt: 'a', options: { cwd: home } });
    query({ prompt: 'b' });
    expect(calls.map((c) => c.pathToClaudeCodeExecutable)).toEqual([bin, bin]);
    expect(calls[0].cwd).toBe(home);
  });

  it('leaves a caller-chosen binary (an installed Claude Code) alone, with no pin check', async () => {
    const { query, calls, bin } = await load();
    const external = join(home, 'installed', 'claude');
    writeFileSync(bin, '#!/bin/sh\necho swapped\n'); // would fail a pin check
    expect(() =>
      query({ prompt: 'a', options: { pathToClaudeCodeExecutable: external } }),
    ).not.toThrow();
    expect(calls.at(-1)?.pathToClaudeCodeExecutable).toBe(external);
  });

  it('refuses the next query once the binary is swapped after the check', async () => {
    const { query, bin } = await load();
    query({ prompt: 'a' });
    writeFileSync(bin, '#!/bin/sh\necho swapped\n');
    expect(() => query({ prompt: 'b' })).toThrow(/changed after monomind verified it/);
  });

  it('checks again right before a spawn hook runs', async () => {
    const { query: run, bin } = await load();
    const spawned: unknown[] = [];
    const spawnClaudeCodeProcess = (o: unknown) => {
      spawned.push(o);
      return 'child';
    };
    expect(run({ prompt: 'a', options: { spawnClaudeCodeProcess } })).toBe('child');
    // Swapped between the query's own check and the SDK's spawn.
    const wrapped = withPinnedExecutable({
      query: ((p: { options?: { spawnClaudeCodeProcess?: (o: unknown) => unknown } }) => {
        const s = p.options?.spawnClaudeCodeProcess as (o: unknown) => unknown;
        writeFileSync(bin, '#!/bin/sh\necho swapped\n');
        return s({ command: 'x' });
      }) as never,
    });
    expect(() =>
      (wrapped.query as unknown as (p: unknown) => unknown)({
        prompt: 'b',
        options: { spawnClaudeCodeProcess },
      }),
    ).toThrow(/changed after monomind verified it/);
    expect(spawned).toHaveLength(1);
  });
});

describe('no replaceable symlink above the deps root', () => {
  it('refuses a MONOMIND_HOME reached through a symlink in a writable directory', async () => {
    const real = join(home, 'real-mm');
    mkdirSync(join(real, 'deps'), { recursive: true, mode: 0o700 });
    const link = join(home, 'link');
    symlinkSync(real, link);
    env = { MONOMIND_HOME: link };
    writeFakeSdk(dependencyDir(SDK, env), 'x');
    await expect(ensureOptionalDependency(SDK, opts({ pins: FAKE_PINS }))).rejects.toThrow(
      new RegExp(`${link}, above it, is a symlink in a directory this user can write`),
    );
  });

  it.skipIf(process.getuid?.() === 0)(
    'accepts one in a directory this user cannot write',
    async () => {
      const real = join(home, 'real-mm');
      mkdirSync(join(real, 'deps'), { recursive: true, mode: 0o700 });
      const locked = join(home, 'locked');
      mkdirSync(locked);
      symlinkSync(real, join(locked, 'link'));
      chmodSync(locked, 0o555);
      try {
        env = { MONOMIND_HOME: join(locked, 'link') };
        writeFakeSdk(dependencyDir(SDK, env), 'LOCKED OK');
        const mod = await ensureOptionalDependency<{ marker: string }>(
          SDK,
          opts({ pins: FAKE_PINS }),
        );
        expect(mod.marker).toBe('LOCKED OK');
      } finally {
        chmodSync(locked, 0o755);
      }
    },
  );
});
