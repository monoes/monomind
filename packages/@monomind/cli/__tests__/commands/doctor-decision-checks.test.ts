import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkDecisionModel, checkDecisionModelIfConfigured } from '../../src/commands/doctor-decision-checks.js';

const noulOk = () =>
  new Response(JSON.stringify({ model: 'x', answers: { probe: { type: 'noul', noul: 0.9 } } }), { status: 200 });

describe('checkDecisionModelIfConfigured', () => {
  it('adds no doctor row when no Jev env is set', async () => {
    expect(await checkDecisionModelIfConfigured({ TYPESAFE_API_KEY: 'k' })).toEqual([]);
  });
  it('adds the config row when Jev env is set', async () => {
    const rows = await checkDecisionModelIfConfigured({ MONOMIND_JEV_URL: 'http://127.0.0.1:3000' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pass');
  });
});

describe('checkDecisionModel', () => {
  it('reports info when nothing is configured', async () => {
    const r = await checkDecisionModel({ env: {} });
    expect(r.status).toBe('info');
    expect(r.message).toMatch(/Not configured/);
  });

  it('reports info when disabled', async () => {
    const r = await checkDecisionModel({ env: { MONOMIND_JEV: 'off', TYPESAFE_API_KEY: 'k' } });
    expect(r).toMatchObject({ status: 'info', message: 'Disabled (MONOMIND_JEV=off)' });
  });

  it('warns about an unusable MONOMIND_JEV_URL', async () => {
    const r = await checkDecisionModel({ env: { MONOMIND_JEV_URL: 'ftp://x' } });
    expect(r.status).toBe('warn');
    expect(r.fix).toContain('MONOMIND_JEV_URL=http://');
  });

  it('makes no network call without probe', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await checkDecisionModel({ env: { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' }, fetchImpl });
    expect(r.status).toBe('pass');
    expect(r.message).toContain('custom (http://127.0.0.1:3000)');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes when every provider answers the probe', async () => {
    const fetchImpl = vi.fn(async () => noulOk()) as unknown as typeof fetch;
    const r = await checkDecisionModel({
      probe: true,
      env: { MONOMIND_JEV_URL: 'http://127.0.0.1:3000', TYPESAFE_API_KEY: 'k', MONOMIND_JEV_HOSTED: '1' },
      fetchImpl,
    });
    expect(r.status).toBe('pass');
    expect(r.message).toMatch(/custom \d+ms · typesafe \d+ms/);
  });

  it('warns with a fix when no provider answers, without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const r = await checkDecisionModel({ probe: true, env: { TYPESAFE_API_KEY: 'hidden7', MONOMIND_JEV_HOSTED: '1' }, fetchImpl });
    expect(r.status).toBe('warn');
    expect(r.message).toContain('typesafe: HTTP 401');
    expect(r.message).not.toContain('hidden7');
    expect(r.fix).toBeDefined();
  });
});

describe('named providers (decision-providers.json)', () => {
  const withStore = async (entries: unknown[], run: (env: NodeJS.ProcessEnv) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), 'doctor-named-'));
    try {
      const file = join(dir, 'p.json');
      writeFileSync(file, JSON.stringify({ providers: entries }));
      await run({ MONOMIND_DECISION_PROVIDERS_FILE: file });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('treats a named provider as configured, with no network without probe', async () => {
    await withStore([{ name: 'mine', baseUrl: 'http://127.0.0.1:3000' }], async (env) => {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      const r = await checkDecisionModel({ env, fetchImpl });
      expect(r.status).toBe('pass');
      expect(r.message).toContain('mine (http://127.0.0.1:3000)');
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(await checkDecisionModelIfConfigured(env)).toHaveLength(1);
    });
  });

  it('probes each named provider with doctor -c jev', async () => {
    await withStore([{ name: 'mine', baseUrl: 'http://127.0.0.1:3000' }], async (env) => {
      const fetchImpl = vi.fn(async () => noulOk()) as unknown as typeof fetch;
      const r = await checkDecisionModel({ env, probe: true, fetchImpl });
      expect(r.status).toBe('pass');
      expect(r.message).toMatch(/mine \d+ms/);
    });
  });

  it('warns about an ignored entry (unknown kind) instead of silently dropping it', async () => {
    await withStore([{ name: 'bad', kind: 'nope', baseUrl: 'http://h:1' }], async (env) => {
      const r = await checkDecisionModel({ env });
      expect(r.status).toBe('warn');
      expect(r.message).toMatch(/bad.*unknown provider kind "nope"/);
    });
  });

  it('lists provider kinds, and says which are never used by the prompt hook', async () => {
    const entries = [
      { name: 'oa', kind: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-x' },
      { name: 'an', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x' },
    ];
    await withStore(entries, async (env) => {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      const r = await checkDecisionModel({ env, fetchImpl });
      expect(r.status).toBe('pass');
      expect(r.message).toContain('oa (https://api.openai.com, openai)');
      expect(r.message).toMatch(/Not used by the prompt hook: an/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  it('probes an openai provider through chat completions', async () => {
    const entries = [{ name: 'oa', kind: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-x', logprobs: false }];
    await withStore(entries, async (env) => {
      const fetchImpl = vi.fn(
        async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Y' } }] }), { status: 200 }),
      ) as unknown as typeof fetch;
      const r = await checkDecisionModel({ env, probe: true, fetchImpl });
      expect(r.message).toMatch(/oa \d+ms/);
    });
  });

  it('adds no row and no network when no file exists', async () => {
    const env = { MONOMIND_DECISION_PROVIDERS_FILE: join(tmpdir(), 'does-not-exist-decision.json') };
    expect(await checkDecisionModelIfConfigured(env)).toEqual([]);
  });
});
