import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const providers: any = require('../../.claude/helpers/jev-providers.cjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jp: any = require('../../.claude/helpers/jev-picker.cjs');

const apiKey = ['fake', 'test', 'credential'].join('-');
const config = (extra: Record<string, unknown> = {}) => ({
  name: 'an',
  kind: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey,
  model: 'claude-x',
  samples: 4,
  ...extra,
});

const reply = (answer: unknown, usage = { input_tokens: 10, output_tokens: 2 }) =>
  new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'answer', input: { answer } }], usage }), { status: 200 });

const choiceQ = {
  agent: { type: 'choice', instructions: 'Which agent?', criteria: { coder: 'writes code', tester: 'tests', __none__: 'none' } },
};
const ask = (cfg: object, qs: object, fetchImpl: unknown, timeoutMs = 1000) =>
  providers.createProvider(cfg).ask('fix the login bug', qs, { timeoutMs, fetchImpl });

/** A fetch that answers with the given values in call order. */
const sequence = (values: unknown[]) => {
  let i = 0;
  return vi.fn(async () => reply(values[i++ % values.length]));
};

describe('anthropic kind: request', () => {
  it('posts k samples per question with an enum-constrained forced tool', async () => {
    expect(providers.kinds()).toContain('anthropic');
    const fetchImpl = sequence(['coder']);
    await ask(config(), choiceQ, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.redirect).toBe('error');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(apiKey);
    expect(headers['anthropic-version']).toBeTruthy();
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('claude-x');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'answer' });
    expect(body.tools[0].input_schema.properties.answer.enum).toEqual(['coder', 'tester', '__none__']);
    expect(JSON.stringify(body.messages)).toContain('writes code');
  });

  it('defaults to 5 samples', async () => {
    const fetchImpl = sequence(['coder']);
    await ask(config({ samples: undefined }), choiceQ, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});

describe('anthropic kind: sampled probabilities', () => {
  it('turns answer frequencies into probabilities, probSource sampled', async () => {
    const res = await ask(config(), choiceQ, sequence(['coder', 'coder', 'coder', 'tester']));
    const a = res.answers.agent;
    expect(a.choice).toBe('coder');
    expect(a.probSource).toBe('sampled');
    expect(a.probabilities).toEqual({ coder: 0.75, tester: 0.25, __none__: 0 });
  });

  it('settles confidence centrally from the frequencies', async () => {
    const out = await jp.ask('t', choiceQ, { providers: [config()], fetchImpl: sequence(['coder', 'coder', 'coder', 'tester']) });
    expect(out.answers.agent.confidence).toBeCloseTo((0.75 - 1 / 3) / (1 - 1 / 3), 6);
  });

  it('discards samples outside the enum, and answers from the rest', async () => {
    const res = await ask(config({ samples: 4 }), choiceQ, sequence(['coder', 'evil-id', 'coder', 'rm -rf']));
    expect(res.answers.agent.probabilities.coder).toBe(1);
    expect(JSON.stringify(res)).not.toContain('evil-id');
  });

  it('gives no answer when fewer than half the samples are usable', async () => {
    const out = await jp.ask('t', choiceQ, { providers: [config({ samples: 4 })], fetchImpl: sequence(['coder', 'x', 'y', 'z']) });
    expect(out).toBeNull();
  });

  it('survives some failed requests', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (n++ % 2 ? new Response('no', { status: 529 }) : reply('tester')));
    const res = await ask(config(), choiceQ, fetchImpl);
    expect(res.answers.agent.choice).toBe('tester');
  });

  it('rejects a response that is not a tool_use block', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'coder' }] }), { status: 200 });
    const out = await jp.ask('t', choiceQ, { providers: [config()], fetchImpl });
    expect(out).toBeNull();
  });
});

describe('anthropic kind: noul and score', () => {
  it('uses a yes/no enum and the yes frequency', async () => {
    for (const type of ['noul', 'score']) {
      const fetchImpl = sequence(['yes', 'yes', 'yes', 'no']);
      const res = await ask(config(), { q: { type, instructions: 'Is it a bug?' } }, fetchImpl);
      const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body.tools[0].input_schema.properties.answer.enum).toEqual(['yes', 'no']);
      expect(res.answers.q).toMatchObject({ type, noul: 0.75, probSource: 'sampled' });
    }
  });

  it('passes the picker validation and the probe', async () => {
    await expect(jp.probe(config(), { fetchImpl: sequence(['yes', 'no']) })).resolves.toBeTypeOf('number');
  });
});

describe('anthropic kind: cost, safety, eligibility', () => {
  it('sums tokens over every sample and prices them', async () => {
    const res = await ask(config({ pricing: { in: 0.000001, out: 0.000005 } }), choiceQ, sequence(['coder']));
    expect(res.usage).toMatchObject({ tokensIn: 40, tokensOut: 8 });
    expect(res.usage.costUsd).toBeCloseTo(40 * 0.000001 + 8 * 0.000005, 9);
  });

  it('is never used by the prompt hook (k requests per prompt)', () => {
    expect(providers.hookEligible(config())).toBe(false);
  });

  it('refuses a key over plain http to a remote host, and talks only to its own origin', async () => {
    const fetchImpl = sequence(['coder']);
    await expect(ask(config({ baseUrl: 'http://proxy.example.com' }), choiceQ, fetchImpl)).rejects.toThrow(/https/);
    expect(fetchImpl).not.toHaveBeenCalled();
    await ask(config(), choiceQ, fetchImpl);
    for (const call of fetchImpl.mock.calls as unknown as [string][]) expect(new URL(call[0]).origin).toBe('https://api.anthropic.com');
  });

  it('aborts at the given window', async () => {
    const never = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const started = Date.now();
    await expect(ask(config(), choiceQ, never, 120)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('validates entries: model required, samples 2..10', () => {
    const ok = { name: 'an', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x' };
    expect(providers.validateEntry(ok)).toBeNull();
    expect(providers.validateEntry({ ...ok, model: undefined })).toMatch(/model/);
    expect(providers.validateEntry({ ...ok, samples: 1 })).toMatch(/samples/);
    expect(providers.validateEntry({ ...ok, samples: 11 })).toMatch(/samples/);
    expect(providers.validateEntry({ ...ok, samples: 3.5 })).toMatch(/samples/);
    expect(providers.validateEntry({ ...ok, samples: 5 })).toBeNull();
  });

  it('drops hook-ineligible providers in pick()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-'));
    tmpDirs.push(dir);
    const file = join(dir, 'providers.json');
    providers.writeStore(file, [{ name: 'an', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x', apiKeyEnv: 'AN_KEY', samples: 2 }]);
    const env = { MONOMIND_DECISION_PROVIDERS_FILE: file, AN_KEY: 'k' };
    const agents = [
      { id: 'a', name: 'a', description: 'x' },
      { id: 'b', name: 'b', description: 'y' },
    ];
    const fetchImpl = vi.fn(async () => reply('a'));
    expect(await jp.pick('task', { agents }, { env, hook: true, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    const picked = await jp.pick('task', { agents }, { env, fetchImpl });
    expect(picked.agent.choice).toBe('a');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
