import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { HELPER_FILES } from '../../src/init/helpers-generator.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providers: any = require('../../.claude/helpers/jev-providers.cjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jp: any = require('../../.claude/helpers/jev-picker.cjs');

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

const questions = { agent: { type: 'choice', instructions: 'q', criteria: { coder: 'a', tester: 'b' } } };
const choice = (id: string, confidence: number) => ({
  type: 'choice',
  choice: id,
  confidence,
  probabilities: { [id]: confidence },
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('confidenceFrom', () => {
  it('is (p_max - 1/n) / (1 - 1/n)', () => {
    expect(providers.confidenceFrom([0.9, 0.1])).toBeCloseTo((0.9 - 0.5) / 0.5, 10);
    expect(providers.confidenceFrom([0.5, 0.3, 0.2], 30)).toBeCloseTo((0.5 - 1 / 30) / (1 - 1 / 30), 10);
  });

  it('is 0 for a uniform distribution and 1 for a certain one', () => {
    expect(providers.confidenceFrom([0.5, 0.5])).toBe(0);
    expect(providers.confidenceFrom(new Array(30).fill(1 / 30))).toBeCloseTo(0, 10);
    expect(providers.confidenceFrom([1, 0, 0])).toBe(1);
  });

  it('clamps to [0, 1] and handles degenerate input', () => {
    expect(providers.confidenceFrom([0.1], 2)).toBe(0);
    expect(providers.confidenceFrom([])).toBe(0);
    expect(providers.confidenceFrom([1], 1)).toBe(1);
  });
});

describe('settleAnswer (the one place confidence is decided)', () => {
  it('keeps a native confidence untouched', () => {
    const a = { ...choice('coder', 0.77), probSource: 'native' };
    expect(providers.settleAnswer(a, questions.agent)).toMatchObject({ confidence: 0.77, probSource: 'native' });
  });

  it('recomputes logprob and sampled confidence over the question options', () => {
    const a = {
      type: 'choice',
      choice: 'coder',
      confidence: 0.99,
      probabilities: { coder: 0.9, tester: 0.1 },
      probSource: 'logprob',
    };
    const out = providers.settleAnswer(a, questions.agent);
    expect(out.confidence).toBeCloseTo(0.8, 10);
    expect(out.probSource).toBe('logprob');
  });

  it('caps an answer with no probabilities below the automatic floor', () => {
    const a = { ...choice('coder', 1), probSource: 'none' };
    const out = providers.settleAnswer(a, questions.agent);
    expect(out.probSource).toBe('none');
    expect(out.confidence).toBeLessThan(jp.resolveMinConfidence({}));
  });

  it('treats an unknown or missing source as none, never as native', () => {
    expect(providers.settleAnswer(choice('coder', 1), questions.agent).probSource).toBe('none');
    expect(providers.settleAnswer({ ...choice('coder', 1), probSource: 'telepathy' }, questions.agent).probSource).toBe(
      'none',
    );
  });
});

describe('registry', () => {
  it('registers systemone out of the box', () => {
    expect(providers.kinds()).toContain('systemone');
  });

  it('creates a provider whose ask is the interface ask(state, questions, opts)', async () => {
    const fetchImpl = vi.fn(async () => json({ answers: { agent: choice('coder', 0.9) } }));
    const p = providers.createProvider({ name: 'custom', baseUrl: 'http://127.0.0.1:3000', model: 'm' });
    expect(p).toMatchObject({ name: 'custom', kind: 'systemone' });
    const res = await p.ask('task', questions, { timeoutMs: 1000, fetchImpl });
    expect(res.provider).toBe('custom');
    expect(res.answers.agent).toMatchObject({ choice: 'coder', confidence: 0.9, probSource: 'native' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not trust a probSource sent by the server', async () => {
    const fetchImpl = async () => json({ answers: { agent: { ...choice('coder', 0.9), probSource: 'logprob' } } });
    const p = providers.createProvider({ name: 'custom', baseUrl: 'http://127.0.0.1:3000', model: 'm' });
    const res = await p.ask('task', questions, { timeoutMs: 1000, fetchImpl });
    expect(res.answers.agent.probSource).toBe('native');
  });

  it('rejects an unknown kind loudly', () => {
    expect(() => providers.createProvider({ name: 'x', kind: 'nope', baseUrl: 'http://h', model: 'm' })).toThrow(/nope/);
  });

  it('lets a new kind plug in, and the picker asks it instead of any global', async () => {
    const ask = vi.fn(async () => ({
      provider: 'fake',
      answers: { agent: { ...choice('tester', 0.8), probSource: 'native' } },
    }));
    providers.registerProvider('fake-kind', (config: { name: string }) => ({
      name: config.name,
      kind: 'fake-kind',
      ask,
    }));
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const res = await jp.ask('task', questions, {
      env: {},
      providers: [{ name: 'fake', kind: 'fake-kind', baseUrl: 'http://h', model: 'm' }],
    });
    expect(res.provider).toBe('fake');
    expect(res.answers.agent.choice).toBe('tester');
    expect(ask).toHaveBeenCalledWith('task', questions, expect.objectContaining({ timeoutMs: expect.any(Number) }));
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });

  it('passes a provider usage through to the caller', async () => {
    const usage = { latencyMs: 12, tokensIn: 3, tokensOut: 1 };
    providers.registerProvider('usage-kind', (c: { name: string }) => ({
      name: c.name,
      kind: 'usage-kind',
      ask: async () => ({
        provider: c.name,
        answers: { agent: { ...choice('coder', 0.9), probSource: 'native' } },
        usage,
      }),
    }));
    const res = await jp.ask('task', questions, {
      env: {},
      providers: [{ name: 'u', kind: 'usage-kind', baseUrl: 'http://h', model: 'm' }],
    });
    expect(res.usage).toMatchObject({ tokensIn: 3, tokensOut: 1 });
    // The registry's own measurement replaces a provider-claimed latency.
    expect(res.usage.latencyMs).not.toBe(12);
  });

  it('drops an answer naming an option that was not sent, and falls through to the next provider', async () => {
    providers.registerProvider('liar-kind', (c: { name: string }) => ({
      name: c.name,
      kind: 'liar-kind',
      ask: async () => ({
        provider: c.name,
        answers: { agent: { ...choice('rm-rf', 1), probSource: 'native' } },
      }),
    }));
    const errors: string[] = [];
    const res = await jp.ask('task', questions, {
      env: {},
      onError: (e: Error) => errors.push(e.message),
      fetchImpl: async () => json({ answers: { agent: choice('coder', 0.9) } }),
      providers: [
        { name: 'liar', kind: 'liar-kind', baseUrl: 'http://h', model: 'm' },
        { name: 'custom', baseUrl: 'http://127.0.0.1:3000', model: 'm' },
      ],
    });
    expect(res.provider).toBe('custom');
    expect(errors).toEqual(['no usable answer']);
  });

  it('reports an unknown kind through onError and moves on', async () => {
    const errors: string[] = [];
    const res = await jp.ask('task', questions, {
      env: {},
      onError: (e: Error) => errors.push(e.message),
      providers: [{ name: 'x', kind: 'nope', baseUrl: 'http://h', model: 'm' }],
    });
    expect(res).toBeNull();
    expect(errors[0]).toMatch(/nope/);
  });
});

describe('env resolution still yields systemone providers', () => {
  it('tags custom and typesafe with kind systemone', () => {
    const p = jp.resolveProviders({
      MONOMIND_JEV_URL: 'http://127.0.0.1:3000',
      TYPESAFE_API_KEY: 'k',
      MONOMIND_JEV_HOSTED: '1',
    });
    expect(p.map((x: { name: string; kind: string }) => [x.name, x.kind])).toEqual([
      ['custom', 'systemone'],
      ['typesafe', 'systemone'],
    ]);
  });

  it('shares one JevError class between the picker and the registry', () => {
    expect(jp.JevError).toBe(providers.JevError);
  });
});

describe('usage metering', () => {
  const answer = { agent: choice('coder', 0.9) };
  const fakeKind = (usage?: Record<string, number>) => () => ({
    name: 'fake',
    kind: 'fake',
    ask: vi.fn(async () => ({ provider: 'fake', answers: answer, usage })),
  });

  it('measures latency for a systemone provider and reports no tokens or cost', async () => {
    const fetchImpl = vi.fn(async () => json({ answers: answer }));
    const p = providers.createProvider({ name: 'custom', baseUrl: 'http://x', model: 'm' });
    const res = await p.ask('s', questions, { timeoutMs: 1000, fetchImpl });
    expect(res.usage.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.usage).not.toHaveProperty('tokensIn');
    expect(res.usage).not.toHaveProperty('tokensOut');
    expect(res.usage).not.toHaveProperty('costUsd');
  });

  it('meters any kind: latency plus the tokens the kind reported', async () => {
    providers.registerProvider('meter-a', fakeKind({ tokensIn: 120, tokensOut: 1 }));
    const res = await providers.createProvider({ name: 'a', kind: 'meter-a' }).ask('s', questions, {});
    expect(res.usage).toMatchObject({ tokensIn: 120, tokensOut: 1 });
    expect(typeof res.usage.latencyMs).toBe('number');
    expect(res.usage).not.toHaveProperty('costUsd');
  });

  it('prices tokens from the config per-token table', async () => {
    providers.registerProvider('meter-b', fakeKind({ tokensIn: 1000, tokensOut: 10 }));
    const cfg = { name: 'b', kind: 'meter-b', pricing: { in: 2e-6, out: 10e-6 } };
    const res = await providers.createProvider(cfg).ask('s', questions, {});
    expect(res.usage.costUsd).toBeCloseTo(1000 * 2e-6 + 10 * 10e-6, 12);
  });

  it('costs a local server 0 and never estimates tokens it was not given', async () => {
    providers.registerProvider('meter-c', fakeKind());
    const res = await providers.createProvider({ name: 'c', kind: 'meter-c', local: true }).ask('s', questions, {});
    expect(res.usage.costUsd).toBe(0);
    expect(res.usage).not.toHaveProperty('tokensIn');
  });

  it('ignores a non-numeric token count from a provider', async () => {
    providers.registerProvider('meter-d', fakeKind({ tokensIn: 'many' as unknown as number }));
    const res = await providers.createProvider({ name: 'd', kind: 'meter-d', pricing: { in: 1, out: 1 } }).ask('s', questions, {});
    expect(res.usage).not.toHaveProperty('tokensIn');
    expect(res.usage).not.toHaveProperty('costUsd');
  });

  it('flows through the picker into JevPick.usage', async () => {
    const fetchImpl = vi.fn(async () => json({ answers: { agent: choice('coder', 0.9) } }));
    const res = await jp.pick(
      'fix the bug',
      { agents: [{ id: 'coder', name: 'coder' }, { id: 'tester', name: 'tester' }] },
      { env: { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' }, fetchImpl },
    );
    expect(res.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('helper registration', () => {
  it('registers jev-providers.cjs as a synced, doctor-tracked helper', () => {
    expect(HELPER_FILES['jev-providers.cjs']).toMatchObject({ forceSync: true, doctorTracked: true });
  });

  it('exists in the root .claude/helpers tree and is required by jev-picker.cjs', () => {
    expect(existsSync(join(REPO_ROOT, '.claude', 'helpers', 'jev-providers.cjs'))).toBe(true);
    expect(readFileSync(join(REPO_ROOT, '.claude', 'helpers', 'jev-picker.cjs'), 'utf-8')).toContain(
      "require('./jev-providers.cjs')",
    );
  });
});
