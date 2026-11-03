/**
 * @huggingface/transformers (and onnxruntime, ~400 MB) is no longer a
 * dependency of the published CLI: it loads through the first-use installer.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPTIONAL_DEPENDENCIES } from '../utils/optional-deps.js';
import {
  loadTransformers,
  modelCacheDir,
  resetTransformersLoader,
  transformersCacheDir,
} from '../utils/transformers-loader.js';
import { notFound } from './fixtures/optional-deps-fixture.js';

const NAME = '@huggingface/transformers';
let home: string;
let env: NodeJS.ProcessEnv;
const absent = (extra: Record<string, unknown> = {}) => ({
  env,
  resolveOwn: notFound,
  log: () => {},
  ...extra,
});

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'mm-tf-')));
  env = { MONOMIND_HOME: home };
  mkdirSync(join(home, 'deps'), { recursive: true, mode: 0o700 });
  resetTransformersLoader();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('transformers is installed on first use, not with the CLI', () => {
  it('is a devDependency at the pinned version, not a dependency', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.devDependencies[NAME]).toBe(OPTIONAL_DEPENDENCIES[NAME].version);
    expect(pkg.dependencies?.[NAME]).toBeUndefined();
    expect(pkg.optionalDependencies?.[NAME]).toBeUndefined();
  });

  it('loads the pinned checkout copy (hash-verified) and exposes pipeline()', async () => {
    const hf = await loadTransformers();
    expect(typeof hf.pipeline).toBe('function');
  });

  it('install:false never downloads when the runtime is missing', async () => {
    let npmRan = false;
    await expect(
      loadTransformers({
        install: false,
        ensure: absent({ runNpm: async () => void (npmRan = true) }),
      }),
    ).rejects.toThrow(/download-embeddings/);
    expect(npmRan).toBe(false);
  });

  it('MONOMIND_NO_AUTO_INSTALL refuses and prints the manual command', async () => {
    env.MONOMIND_NO_AUTO_INSTALL = '1';
    await expect(loadTransformers({ ensure: absent() })).rejects.toThrow(
      /MONOMIND_NO_AUTO_INSTALL[\s\S]*npm install --prefix .*@huggingface\/transformers@4\.3\.0/,
    );
  });

  it('announces the download, and after a failed install waits before retrying', async () => {
    const lines: string[] = [];
    const runNpm = async () => {
      throw new Error('offline');
    };
    await expect(
      loadTransformers({ ensure: absent({ runNpm, log: (l: string) => lines.push(l) }) }),
    ).rejects.toThrow(/Could not install/);
    expect(lines.join('\n')).toMatch(/needs @huggingface\/transformers@4\.3\.0/);
    let retried = false;
    await expect(
      loadTransformers({ ensure: absent({ runNpm: async () => void (retried = true) }) }),
    ).rejects.toThrow(/not retrying for an hour/);
    expect(retried).toBe(false);
  });

  it('keeps model weights outside the replaceable deps dir', () => {
    expect(modelCacheDir(env)).toBe(join(home, 'models'));
    expect(transformersCacheDir()).not.toBeNull(); // checkout copy: package .cache
  });
});
