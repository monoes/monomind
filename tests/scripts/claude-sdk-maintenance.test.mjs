import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessFreshness,
  refresh,
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
  it('updates both manifest pins, dependency lock, code pins and the probed native version together', async () => {
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
  });
});
