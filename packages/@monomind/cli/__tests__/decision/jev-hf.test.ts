import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providers: any = require('../../.claude/helpers/jev-providers.cjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jp: any = require('../../.claude/helpers/jev-picker.cjs');

const apiKey = ['fake', 'hf', 'credential'].join('-');
const config = (extra: Record<string, unknown> = {}) => ({
  name: 'hf',
  kind: 'hf-zeroshot',
  baseUrl: 'https://router.huggingface.co/hf-inference',
  apiKey,
  model: 'facebook/bart-large-mnli',
  ...extra,
});

const classic = (labels: string[], scores: number[]) =>
  new Response(JSON.stringify({ sequence: 's', labels, scores }), { status: 200 });
const listShape = (pairs: [string, number][]) =>
  new Response(JSON.stringify(pairs.map(([label, score]) => ({ label, score }))), { status: 200 });

const choiceQ = {
  agent: { type: 'choice', instructions: 'Which agent?', criteria: { coder: 'writes code', tester: 'runs tests', __none__: 'nothing fits' } },
};
const ask = (cfg: object, qs: object, fetchImpl: unknown, timeoutMs = 1000) =>
  providers.createProvider(cfg).ask('fix the login bug', qs, { timeoutMs, fetchImpl });

describe('hf-zeroshot kind', () => {
  it('posts the text with the option descriptions as candidate labels', async () => {
    expect(providers.kinds()).toContain('hf-zeroshot');
    const fetchImpl = vi.fn(async () => classic(['writes code', 'runs tests', 'nothing fits'], [0.7, 0.2, 0.1]));
    await ask(config(), choiceQ, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://router.huggingface.co/hf-inference/models/facebook/bart-large-mnli');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${apiKey}`);
    const body = JSON.parse(String(init.body));
    expect(body.inputs).toContain('fix the login bug');
    expect(body.parameters).toMatchObject({ candidate_labels: ['writes code', 'runs tests', 'nothing fits'], multi_label: false });
  });

  it('maps labels back to option ids and settles confidence centrally', async () => {
    const fetchImpl = async () => classic(['runs tests', 'writes code', 'nothing fits'], [0.8, 0.15, 0.05]);
    const out = await jp.ask('t', choiceQ, { providers: [config()], fetchImpl });
    expect(out.answers.agent.choice).toBe('tester');
    expect(out.answers.agent.probabilities.coder).toBeCloseTo(0.15, 6);
    expect(out.answers.agent.confidence).toBeCloseTo((0.8 - 1 / 3) / (1 - 1 / 3), 6);
  });

  it('understands the list reply shape too, and renormalises', async () => {
    const res = await ask(config(), choiceQ, async () => listShape([['writes code', 0.3], ['runs tests', 0.1]]));
    const probs = res.answers.agent.probabilities;
    expect(probs.coder).toBeCloseTo(0.75, 9);
    expect(probs.tester).toBeCloseTo(0.25, 9);
    expect(probs.__none__).toBe(0);
  });

  it('discards labels it did not send', async () => {
    const out = await jp.ask('t', choiceQ, { providers: [config()], fetchImpl: async () => classic(['rm -rf /', 'evil'], [0.9, 0.1]) });
    expect(out).toBeNull();
    const res = await ask(config(), choiceQ, async () => classic(['evil', 'writes code'], [0.9, 0.1]));
    expect(res.answers.agent.choice).toBe('coder');
    expect(JSON.stringify(res)).not.toContain('evil');
  });

  it('keeps colliding descriptions apart', async () => {
    const q = { a: { type: 'choice', instructions: 'x', criteria: { one: 'same', two: 'same' } } };
    const fetchImpl = vi.fn(async () => classic(['same [two]', 'same'], [0.6, 0.4]));
    const res = await ask(config(), q, fetchImpl);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(new Set(body.parameters.candidate_labels).size).toBe(2);
    expect(res.answers.a.choice).toBe('two');
  });

  it('answers yes/no questions (noul and score) with the yes score', async () => {
    for (const type of ['noul', 'score']) {
      const fetchImpl = vi.fn(async () => classic(['yes', 'no'], [0.8, 0.2]));
      const res = await ask(config(), { q: { type, instructions: 'Is it a bug?' } }, fetchImpl);
      const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(body.inputs).toContain('Is it a bug?');
      expect(body.parameters.candidate_labels).toEqual(['yes', 'no']);
      expect(res.answers.q).toMatchObject({ type, probSource: 'logprob' });
      expect(res.answers.q.noul).toBeCloseTo(0.8, 6);
    }
    await expect(jp.probe(config(), { fetchImpl: async () => classic(['yes', 'no'], [0.5, 0.5]) })).resolves.toBeTypeOf('number');
  });

  it('is eligible for the hook (one cheap request per question)', () => {
    expect(providers.hookEligible(config())).toBe(true);
  });

  it('validates the model name, which becomes part of the URL path', () => {
    const ok = { name: 'hf', kind: 'hf-zeroshot', baseUrl: 'https://router.huggingface.co/hf-inference', model: 'facebook/bart-large-mnli' };
    expect(providers.validateEntry(ok)).toBeNull();
    expect(providers.validateEntry({ ...ok, model: undefined })).toMatch(/model/);
    expect(providers.validateEntry({ ...ok, model: '../../admin' })).toMatch(/model/);
    expect(providers.validateEntry({ ...ok, model: 'a b' })).toMatch(/model/);
  });

  it('keeps the transport rules: own host, https for keys, size cap, timeout, status', async () => {
    const fetchImpl = vi.fn(async () => classic(['yes', 'no'], [1, 0]));
    const yn = { q: { type: 'noul', instructions: 'x' } };
    await expect(ask(config({ baseUrl: 'http://hf.example.com' }), yn, fetchImpl)).rejects.toThrow(/https/);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(ask(config(), yn, async () => new Response('x'.repeat(1024 * 1024 + 1)))).rejects.toThrow(/too large/);
    await expect(ask(config(), yn, async () => new Response('no', { status: 503 }))).rejects.toMatchObject({ status: 503 });
    const never = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const started = Date.now();
    await expect(ask(config(), yn, never, 120)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('reports no tokens and a zero cost only for a local config', async () => {
    const res = await ask(config({ local: true }), { q: { type: 'noul', instructions: 'x' } }, async () => classic(['yes', 'no'], [0.5, 0.5]));
    expect(res.usage.costUsd).toBe(0);
    expect(res.usage.tokensIn).toBeUndefined();
  });
});
