import { describe, expect, it, vi } from 'vitest';
import {
  type DecisionProvidersDeps,
  decisionCommand,
  runConfigure,
  runList,
  runRemove,
  runTest,
} from '../../src/commands/decision-providers.js';
import type { NamedProviderEntry } from '../../src/decision/jev.js';

/** In-memory store standing in for jev-providers.cjs (London School: the
 *  collaborator is faked, the command's decisions are what is under test). */
function makeDeps(initial: Record<string, NamedProviderEntry[]> = {}, env: NodeJS.ProcessEnv = {}) {
  const files: Record<string, NamedProviderEntry[]> = {
    '/p/decision-providers.json': [],
    '/u/decision-providers.json': [],
    ...initial,
  };
  const registry = {
    kinds: () => ['systemone'],
    storeFile: (scope: string) => (scope === 'user' ? '/u/decision-providers.json' : '/p/decision-providers.json'),
    readStore: (f: string) => ({ providers: [...(files[f] ?? [])] }),
    writeStore: vi.fn((f: string, entries: NamedProviderEntry[]) => {
      files[f] = entries;
    }),
    validateEntry: (e: unknown) => {
      const x = e as NamedProviderEntry & { apiKey?: string };
      if (x.kind && x.kind !== 'systemone') return `unknown provider kind "${x.kind}" (known: systemone)`;
      if (!/^https?:/.test(x.baseUrl)) return 'baseUrl must be an http(s) URL';
      return null;
    },
  };
  const probe = vi.fn(async () => 42);
  const deps = {
    jev: { registry, probe, normalizeBaseUrl: (u: string) => u.replace(/\/+$/, '').replace(/\/v1$/, '') },
    env,
    cwd: '/p',
  } as unknown as DecisionProvidersDeps;
  return { deps, files, registry, probe };
}

describe('decision providers configure', () => {
  it('stores a named provider with only the env-var name of the key', async () => {
    const { deps, files } = makeDeps();
    const r = await runConfigure({ name: 'local', url: 'http://127.0.0.1:3000', apiKeyEnv: 'MY_KEY' }, deps);
    expect(r.success).toBe(true);
    expect(files['/p/decision-providers.json']).toEqual([
      { name: 'local', kind: 'systemone', baseUrl: 'http://127.0.0.1:3000', apiKeyEnv: 'MY_KEY' },
    ]);
    expect(JSON.stringify(files)).not.toMatch(/apiKey"/);
  });

  it('replaces an entry of the same name instead of duplicating it', async () => {
    const { deps, files } = makeDeps();
    await runConfigure({ name: 'a', url: 'http://h:1' }, deps);
    await runConfigure({ name: 'a', url: 'http://h:2', model: 'm' }, deps);
    expect(files['/p/decision-providers.json']).toHaveLength(1);
    expect(files['/p/decision-providers.json'][0]).toMatchObject({ baseUrl: 'http://h:2', model: 'm' });
  });

  it('writes the user scope file with --scope user', async () => {
    const { deps, files } = makeDeps();
    await runConfigure({ name: 'a', url: 'http://h:1', scope: 'user' }, deps);
    expect(files['/u/decision-providers.json']).toHaveLength(1);
    expect(files['/p/decision-providers.json']).toHaveLength(0);
  });

  it('refuses a raw key and writes nothing', async () => {
    const { deps, registry } = makeDeps();
    const r = await runConfigure({ name: 'a', url: 'http://h:1', key: 'sk-live-xyz' }, deps);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/--api-key-env/);
    expect(registry.writeStore).not.toHaveBeenCalled();
  });

  it('turns an unknown kind into a clear error and writes nothing', async () => {
    const { deps, registry } = makeDeps();
    const r = await runConfigure({ name: 'a', kind: 'openai', url: 'http://h:1' }, deps);
    expect(r).toMatchObject({ success: false });
    expect(r.message).toMatch(/unknown provider kind "openai"/);
    expect(registry.writeStore).not.toHaveBeenCalled();
  });

  it('requires a name and a url', async () => {
    const { deps } = makeDeps();
    expect((await runConfigure({ url: 'http://h:1' }, deps)).success).toBe(false);
    expect((await runConfigure({ name: 'a' }, deps)).success).toBe(false);
  });
});

describe('decision providers list', () => {
  it('lists entries with scope and whether the key variable is set, never a key', async () => {
    const { deps } = makeDeps(
      { '/p/decision-providers.json': [{ name: 'a', baseUrl: 'http://h:1', apiKeyEnv: 'MY_KEY' }] },
      { MY_KEY: 'secret-value' },
    );
    const r = await runList({}, deps);
    expect(r.data).toEqual([
      expect.objectContaining({ name: 'a', scope: 'project', apiKeyEnv: 'MY_KEY', keySet: true }),
    ]);
    expect(JSON.stringify(r)).not.toContain('secret-value');
  });
});

describe('decision providers remove', () => {
  it('removes by name from whichever scope holds it', async () => {
    const { deps, files } = makeDeps({ '/u/decision-providers.json': [{ name: 'a', baseUrl: 'http://h:1' }] });
    const r = await runRemove({ name: 'a' }, deps);
    expect(r.success).toBe(true);
    expect(files['/u/decision-providers.json']).toEqual([]);
  });
  it('reports a name that is not configured', async () => {
    const { deps } = makeDeps();
    expect((await runRemove({ name: 'zzz' }, deps)).success).toBe(false);
  });
});

describe('decision providers test', () => {
  it('probes the named provider with its key from the environment', async () => {
    const { deps, probe } = makeDeps(
      { '/p/decision-providers.json': [{ name: 'a', baseUrl: 'http://h:1', apiKeyEnv: 'MY_KEY' }] },
      { MY_KEY: 'k' },
    );
    const r = await runTest({ name: 'a' }, deps);
    expect(r.success).toBe(true);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a', kind: 'systemone', baseUrl: 'http://h:1', apiKey: 'k' }),
      expect.anything(),
    );
  });
  it('fails when the probe fails, and for an unknown name', async () => {
    const { deps, probe } = makeDeps({ '/p/decision-providers.json': [{ name: 'a', baseUrl: 'http://h:1' }] });
    probe.mockRejectedValueOnce(new Error('HTTP 500'));
    expect(await runTest({ name: 'a' }, deps)).toMatchObject({ success: false });
    expect((await runTest({ name: 'nope' }, deps)).success).toBe(false);
  });
});

describe('command wiring', () => {
  it('is a new top-level group `decision` with `providers` configure|test|list|remove', () => {
    expect(decisionCommand.name).toBe('decision');
    const providers = decisionCommand.subcommands?.find((c) => c.name === 'providers');
    expect(providers?.subcommands?.map((c) => c.name).sort()).toEqual(['configure', 'list', 'remove', 'test']);
  });
});
