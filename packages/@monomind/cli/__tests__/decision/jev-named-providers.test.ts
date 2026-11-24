import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providers: any = require('../../.claude/helpers/jev-providers.cjs');

let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'named-prov-proj-'));
  home = mkdtempSync(join(tmpdir(), 'named-prov-home-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const writeProject = (entries: unknown) => {
  mkdirSync(join(root, '.monomind'), { recursive: true });
  writeFileSync(join(root, '.monomind', 'decision-providers.json'), JSON.stringify({ providers: entries }));
};
const resolve = (env: Record<string, string> = {}) =>
  providers.resolveProviders({ HOME: home, ...env }, { cwd: root });
const names = (list: Array<{ name: string }>) => list.map((p) => p.name);

describe('validateEntry', () => {
  const ok = { name: 'local', kind: 'systemone', baseUrl: 'http://127.0.0.1:3000' };

  it('accepts a minimal systemone entry', () => {
    expect(providers.validateEntry(ok)).toBeNull();
  });
  it('rejects an unknown kind with a clear error naming the known kinds', () => {
    expect(providers.validateEntry({ ...ok, kind: 'palm' })).toMatch(/unknown provider kind "palm".*systemone/);
  });
  it('rejects reserved env provider names and bad names', () => {
    expect(providers.validateEntry({ ...ok, name: 'custom' })).toMatch(/reserved/);
    expect(providers.validateEntry({ ...ok, name: 'typesafe' })).toMatch(/reserved/);
    expect(providers.validateEntry({ ...ok, name: 'a b' })).toMatch(/name/);
  });
  it('rejects an unusable url', () => {
    expect(providers.validateEntry({ ...ok, baseUrl: 'ftp://x' })).toMatch(/http\(s\) URL/);
  });
  it('never accepts a key in the file, only an env-var name', () => {
    expect(providers.validateEntry({ ...ok, apiKey: 'sk-live' })).toMatch(/apiKeyEnv/);
    expect(providers.validateEntry({ ...ok, apiKeyEnv: 'sk-live-123' })).toMatch(/environment variable name/);
    expect(providers.validateEntry({ ...ok, apiKeyEnv: 'MY_JEV_KEY' })).toBeNull();
  });
});

describe('resolveProviders with a named-provider file', () => {
  it('adds nothing when no file exists (no behaviour change)', () => {
    expect(resolve()).toEqual([]);
  });

  it('resolves a named provider and reads its key from the named env var', () => {
    writeProject([{ name: 'mine', kind: 'systemone', baseUrl: 'http://h:1/v1', apiKeyEnv: 'MY_KEY', model: 'm' }]);
    const [p] = resolve({ MY_KEY: 'secret' });
    expect(p).toMatchObject({ name: 'mine', kind: 'systemone', baseUrl: 'http://h:1', apiKey: 'secret', model: 'm' });
  });

  it('leaves the key unset when the env var is empty', () => {
    writeProject([{ name: 'mine', baseUrl: 'http://h:1', apiKeyEnv: 'MY_KEY' }]);
    expect(resolve()[0].apiKey).toBeUndefined();
  });

  it('lists env providers first and lets them win a name tie', () => {
    writeProject([
      { name: 'custom', baseUrl: 'http://file:1' },
      { name: 'mine', baseUrl: 'http://file:2' },
    ]);
    const got = resolve({ MONOMIND_JEV_URL: 'http://env:3' }).map((p: { name: string; baseUrl: string }) => [
      p.name,
      p.baseUrl,
    ]);
    expect(got).toEqual([
      ['custom', 'http://env:3'],
      ['mine', 'http://file:2'],
    ]);
  });

  it('puts project providers before user providers', () => {
    writeProject([{ name: 'proj', baseUrl: 'http://p:1' }]);
    mkdirSync(join(home, '.monomind'), { recursive: true });
    writeFileSync(
      join(home, '.monomind', 'decision-providers.json'),
      JSON.stringify({ providers: [{ name: 'usr', baseUrl: 'http://u:1' }] }),
    );
    expect(names(resolve())).toEqual(['proj', 'usr']);
  });

  it('skips invalid, unknown-kind and disabled entries instead of throwing', () => {
    writeProject([
      { name: 'bad-kind', kind: 'nope', baseUrl: 'http://h:1' },
      { name: 'bad-url', baseUrl: 'ftp://x' },
      { name: 'off', baseUrl: 'http://h:2', enabled: false },
      { name: 'good', baseUrl: 'http://h:3' },
    ]);
    expect(names(resolve())).toEqual(['good']);
  });

  it('tolerates a corrupt file', () => {
    mkdirSync(join(root, '.monomind'), { recursive: true });
    writeFileSync(join(root, '.monomind', 'decision-providers.json'), '{nope');
    expect(resolve()).toEqual([]);
  });

  it('MONOMIND_JEV=off disables named providers too', () => {
    writeProject([{ name: 'mine', baseUrl: 'http://h:1' }]);
    expect(resolve({ MONOMIND_JEV: 'off' })).toEqual([]);
  });

  it('MONOMIND_DECISION_PROVIDERS_FILE replaces the lookup entirely', () => {
    writeProject([{ name: 'mine', baseUrl: 'http://h:1' }]);
    expect(resolve({ MONOMIND_DECISION_PROVIDERS_FILE: join(root, 'missing.json') })).toEqual([]);
    const other = join(root, 'other.json');
    writeFileSync(other, JSON.stringify({ providers: [{ name: 'other', baseUrl: 'http://o:1' }] }));
    expect(names(resolve({ MONOMIND_DECISION_PROVIDERS_FILE: other }))).toEqual(['other']);
  });
});

describe('store read/write', () => {
  it('writes project scope to .monomind/decision-providers.json and reads it back', () => {
    const file = providers.storeFile('project', { HOME: home }, { cwd: root });
    expect(file).toBe(join(root, '.monomind', 'decision-providers.json'));
    providers.writeStore(file, [{ name: 'a', kind: 'systemone', baseUrl: 'http://h:1' }]);
    expect(existsSync(file)).toBe(true);
    expect(providers.readStore(file).providers).toEqual([{ name: 'a', kind: 'systemone', baseUrl: 'http://h:1' }]);
    expect(readFileSync(file, 'utf-8')).not.toMatch(/apiKey"/);
  });
  it('user scope lives under the home of the given env', () => {
    expect(providers.storeFile('user', { HOME: home }, { cwd: root })).toBe(
      join(home, '.monomind', 'decision-providers.json'),
    );
  });
  it('readStore of a missing file is empty, of a corrupt file reports an error', () => {
    expect(providers.readStore(join(root, 'nope.json'))).toEqual({ providers: [] });
    const bad = join(root, 'bad.json');
    writeFileSync(bad, 'x');
    expect(providers.readStore(bad).error).toMatch(/JSON/);
  });
});
