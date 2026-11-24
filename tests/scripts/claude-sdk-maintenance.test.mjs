import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessFreshness,
  OPTIONAL_PACKAGES,
  refresh,
  refreshOptional,
  replaceSdkObject,
  verifiedTarball,
} from '../../scripts/claude-sdk-maintenance.mjs';

describe('Claude SDK release maintenance', () => {
  const metadata = {
    'dist-tags': { latest: '0.4.0' },
    versions: {
      '0.3.226': {},
      '0.3.227': {},
      '0.3.999-beta.1': {},
      '0.4.0': {},
      '0.5.0-beta.1': {},
    },
  };
  it('counts published stable versions rather than subtracting patch numbers', () => {
    expect(assessFreshness('0.3.226', metadata, 1)).toEqual({
      latest: '0.4.0',
      behind: 2,
      stale: true,
    });
    expect(assessFreshness('0.3.226', metadata, 2).stale).toBe(false);
    expect(assessFreshness('0.4.0', metadata, 0).behind).toBe(0);
  });
  it('rejects invalid registry metadata and missing pins', () => {
    expect(() => assessFreshness('0.3.225', metadata)).toThrow('not published');
    expect(() =>
      assessFreshness('0.3.226', { ...metadata, 'dist-tags': { latest: 'evil' } }),
    ).toThrow('stable');
  });
  it('updates only the SDK object while preserving unrelated pins and types', () => {
    const source =
      "export const PINS: Record<string, X> = {\n  '@anthropic-ai/claude-agent-sdk': { version: 'old', entry: {file: 'sdk.mjs'} },\n  'other': {version: 'keep'},\n};";
    const result = replaceSdkObject(source, 'PINS', { version: 'new', entry: { file: 'sdk.mjs' } });
    expect(result).toContain('"version": "new"');
    expect(result).toContain("'other': {version: 'keep'}");
    expect(result).toContain('Record<string, X>');
  });
  it('verifies registry tarball integrity before any code is hashed or run', async () => {
    const bytes = Buffer.from('registry tarball');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const fetcher = async () => ({ ok: true, arrayBuffer: async () => bytes });
    expect(
      await verifiedTarball(
        { resolved: 'https://registry.npmjs.org/pkg/-/pkg.tgz', integrity },
        fetcher,
      ),
    ).toEqual(bytes);
    await expect(
      verifiedTarball(
        { resolved: 'https://registry.npmjs.org/pkg/-/pkg.tgz', integrity: 'sha512-bad' },
        fetcher,
      ),
    ).rejects.toThrow('integrity');
    await expect(
      verifiedTarball({ resolved: 'https://evil.example/pkg.tgz', integrity }, fetcher),
    ).rejects.toThrow('registry');
  });
});

describe('verified SDK refresh', () => {
  // reason: refresh() runs the linux-x64 native binary to read its version and refuses elsewhere by design (#798)
  it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')(
    'updates both manifest pins, dependency lock, code pins and the probed native version together',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'sdk-refresh-test-'));
      const cli = join(root, 'packages/@monomind/cli');
      const name = '@anthropic-ai/claude-agent-sdk';
      const bytes = Buffer.from('verified registry bytes');
      const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
      const entry = {
        version: '0.3.289',
        resolved: 'https://registry.npmjs.org/sdk/-/sdk.tgz',
        integrity,
      };
      const lock = {
        packages: {
          [`node_modules/${name}`]: {
            ...entry,
            optionalDependencies: { [`${name}-linux-x64`]: '0.3.289' },
          },
          [`node_modules/${name}-linux-x64`]: entry,
        },
      };
      try {
        mkdirSync(join(cli, 'src/utils'), { recursive: true });
        mkdirSync(join(cli, 'src/orgrt'), { recursive: true });
        writeFileSync(
          join(cli, 'src/utils/optional-deps.ts'),
          `export const OPTIONAL_DEPENDENCIES = { '${name}': { version: '0.3.226' } };`,
        );
        writeFileSync(
          join(cli, 'src/utils/optional-deps-locks.ts'),
          `export const OPTIONAL_DEPENDENCY_LOCKS = { '${name}': { old: true }, 'other': { keep: true } };\nexport const OPTIONAL_DEPENDENCY_CODE_PINS = { '${name}': { old: true } };`,
        );
        writeFileSync(
          join(cli, 'src/orgrt/claude-sdk.ts'),
          "export const SDK_BUNDLED_CLAUDE_VERSION = '2.1.226';\n// unrelated change stays",
        );
        writeFileSync(
          join(cli, 'package.json'),
          JSON.stringify({
            devDependencies: { [name]: '0.3.226' },
            peerDependencies: { [name]: '0.3.226' },
          }),
        );
        const run = (command, args, options) => {
          if (command === 'npm') {
            writeFileSync(join(options.cwd, 'package-lock.json'), JSON.stringify(lock));
            return;
          }
          if (command === 'tar')
            return Buffer.from(args.at(-1) === 'package/sdk.mjs' ? 'sdk entry' : 'native binary');
          return '2.1.289 (Claude Code)\n';
        };
        await refresh(root, '0.3.289', {
          run,
          fetcher: async () => ({ ok: true, arrayBuffer: async () => bytes }),
        });
        const manifest = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'));
        expect(manifest.devDependencies[name]).toBe('0.3.289');
        expect(manifest.peerDependencies[name]).toBe('0.3.289');
        expect(readFileSync(join(cli, 'src/orgrt/claude-sdk.ts'), 'utf8')).toContain(
          "'2.1.289';\n// unrelated change stays",
        );
        const locks = readFileSync(join(cli, 'src/utils/optional-deps-locks.ts'), 'utf8');
        expect(locks).toContain(integrity);
        expect(locks).toContain(createHash('sha256').update('sdk entry').digest('hex'));
        expect(locks).toContain(createHash('sha256').update('native binary').digest('hex'));
        expect(locks).toContain("'other': { keep: true }");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  describe('the other exact-pinned optional packages (#851)', () => {
    const tf = '@huggingface/transformers';
    const pb = '@puppeteer/browsers';
    const bytes = Buffer.from('verified registry bytes');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const fetcher = async () => ({ ok: true, arrayBuffer: async () => bytes });
    const setup = () => {
      const root = mkdtempSync(join(tmpdir(), 'optional-refresh-test-'));
      const cli = join(root, 'packages/@monomind/cli');
      mkdirSync(join(cli, 'src/utils'), { recursive: true });
      writeFileSync(
        join(cli, 'src/utils/optional-deps.ts'),
        `export const OPTIONAL_DEPENDENCIES = {\n  '${pb}': { version: '3.0.6' },\n  '${tf}': { version: '4.3.0' },\n};`,
      );
      writeFileSync(
        join(cli, 'src/utils/optional-deps-locks.ts'),
        `export const OPTIONAL_DEPENDENCY_LOCKS = {\n  '${pb}': { old: true },\n  '${tf}': { old: true },\n};\nexport const OPTIONAL_DEPENDENCY_CODE_PINS = {\n  '${tf}': { old: true },\n  'other': { keep: true },\n};`,
      );
      writeFileSync(
        join(cli, 'package.json'),
        JSON.stringify({ devDependencies: { [tf]: '4.3.0', other: '1.0.0' } }),
      );
      return { root, cli };
    };
    const fakeRun = (name, version) => (command, args, options) => {
      if (command === 'npm') {
        const resolved = 'https://registry.npmjs.org/p/-/p.tgz';
        const lock = { packages: { [`node_modules/${name}`]: { version, resolved, integrity } } };
        writeFileSync(join(options.cwd, 'package-lock.json'), JSON.stringify(lock));
        return;
      }
      expect(args.at(-1)).toBe('package/dist/transformers.node.cjs');
      return Buffer.from('transformers entry');
    };

    it('lists both packages, with the entry file only where code is pinned', () => {
      expect(OPTIONAL_PACKAGES[tf]).toEqual({ entry: 'dist/transformers.node.cjs' });
      expect(OPTIONAL_PACKAGES[pb]).toEqual({});
    });
    it('refreshes transformers: pin, lock, entry hash and devDependency together', async () => {
      const { root, cli } = setup();
      try {
        await refreshOptional(root, tf, '4.4.0', { run: fakeRun(tf, '4.4.0'), fetcher });
        const deps = readFileSync(join(cli, 'src/utils/optional-deps.ts'), 'utf8');
        expect(deps).toContain(`'${tf}': { version: '4.4.0' }`);
        expect(deps).toContain(`'${pb}': { version: '3.0.6' }`);
        const locks = readFileSync(join(cli, 'src/utils/optional-deps-locks.ts'), 'utf8');
        expect(locks).toContain(integrity);
        expect(locks).toContain(createHash('sha256').update('transformers entry').digest('hex'));
        expect(locks).toContain(`'${pb}': { old: true }`);
        expect(locks).toContain("'other': { keep: true }");
        const manifest = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'));
        expect(manifest.devDependencies).toEqual({ [tf]: '4.4.0', other: '1.0.0' });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
    it('refreshes @puppeteer/browsers: lock only, no code pin and no manifest entry', async () => {
      const { root, cli } = setup();
      try {
        await refreshOptional(root, pb, '3.1.0', { run: fakeRun(pb, '3.1.0'), fetcher });
        const deps = readFileSync(join(cli, 'src/utils/optional-deps.ts'), 'utf8');
        expect(deps).toContain(`'${pb}': { version: '3.1.0' }`);
        expect(deps).toContain(`'${tf}': { version: '4.3.0' }`);
        const locks = readFileSync(join(cli, 'src/utils/optional-deps-locks.ts'), 'utf8');
        expect(locks).toContain(integrity);
        expect(locks).toContain(`'${tf}': { old: true }`);
        const manifest = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'));
        expect(manifest.devDependencies[pb]).toBeUndefined();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
    it('writes nothing when the tarball fails its integrity check', async () => {
      const { root, cli } = setup();
      try {
        await expect(
          refreshOptional(root, pb, '3.1.0', {
            run: fakeRun(pb, '3.1.0'),
            fetcher: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('tampered') }),
          }),
        ).rejects.toThrow('integrity');
        expect(readFileSync(join(cli, 'src/utils/optional-deps.ts'), 'utf8')).toContain("'3.0.6'");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
    it('rejects a lock whose version differs from the requested one', async () => {
      const { root } = setup();
      try {
        await expect(
          refreshOptional(root, pb, '3.1.0', { run: fakeRun(pb, '9.9.9'), fetcher }),
        ).rejects.toThrow('version mismatch');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
    it('refuses a package that is not in the refresh list', async () => {
      await expect(refreshOptional('/nonexistent', 'evil', '1.0.0')).rejects.toThrow('Unsupported');
    });
  });

  describe('a registry failure', () => {
    const offline =
      "data:text/javascript,globalThis.fetch=()=>Promise.reject(new Error('offline'))";
    const run = (...flags) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          offline,
          join(import.meta.dirname, '../../scripts/claude-sdk-maintenance.mjs'),
          ...flags,
        ],
        { encoding: 'utf8' },
      );
    it('fails the check by default', () => {
      expect(run().status).toBe(1);
    });
    it('only warns with --warn-only, so a registry blip cannot block a publish', () => {
      const result = run('--warn-only');
      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/offline/);
      expect(result.stderr).toMatch(/warning/i);
    });
  });
});
