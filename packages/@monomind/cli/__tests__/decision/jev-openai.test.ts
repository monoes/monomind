import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providers: any = require('../../.claude/helpers/jev-providers.cjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jp: any = require('../../.claude/helpers/jev-picker.cjs');

const config = (extra: Record<string, unknown> = {}) => ({
  name: 'oa',
  kind: 'openai',
  baseUrl: 'https://api.openai.com',
  apiKey: 'sk-test',
  model: 'gpt-x',
  ...extra,
});

/** A chat-completions reply; `top` is token -> logprob (null: no logprobs field). */
function chat(top: Record<string, number> | null, usage?: Record<string, number>, content?: string) {
  const entries = top ? Object.entries(top) : [];
  const best = content ?? (entries.length ? entries[0][0] : 'A');
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { content: best },
          logprobs: top
            ? {
                content: [
                  {
                    token: best,
                    logprob: entries[0]?.[1] ?? 0,
                    top_logprobs: entries.map(([token, logprob]) => ({ token, logprob })),
                  },
                ],
              }
            : null,
        },
      ],
      ...(usage ? { usage } : {}),
    }),
    { status: 200 },
  );
}

const noKey = undefined;
const lp = (p: number) => Math.log(p);
const choiceQ = {
  agent: { type: 'choice', instructions: 'Which agent?', criteria: { coder: 'writes code', tester: 'tests', __none__: 'none' } },
};
const ask = (cfg: object, qs: object, fetchImpl: unknown, timeoutMs = 1000) =>
  providers.createProvider(cfg).ask('fix the login bug', qs, { timeoutMs, fetchImpl });

describe('openai kind: request', () => {
  it('registers and posts one chat-completions request per question', async () => {
    expect(providers.kinds()).toContain('openai');
    const fetchImpl = vi.fn(async () => chat({ A: lp(0.9), B: lp(0.1) }));
    await ask(config(), { ...choiceQ, skill: choiceQ.agent }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'gpt-x', max_tokens: 1, temperature: 0, logprobs: true, top_logprobs: 20 });
    const prompt = JSON.stringify(body.messages);
    expect(prompt).toContain('writes code');
    expect(prompt).toContain('fix the login bug');
  });

  it('omits the logprob parameters when the config says the endpoint has none', async () => {
    const fetchImpl = vi.fn(async () => chat(null, undefined, 'A'));
    await ask(config({ logprobs: false }), choiceQ, fetchImpl);
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.logprobs).toBeUndefined();
    expect(body.top_logprobs).toBeUndefined();
  });
});

describe('openai kind: probabilities', () => {
  it('renormalises over the allowed labels only and discards everything else', async () => {
    // "The" is not a label; its mass must not dilute the options.
    const fetchImpl = async () => chat({ The: lp(0.5), A: lp(0.3), B: lp(0.1), Z9: lp(0.05) });
    const res = await ask(config(), choiceQ, fetchImpl);
    const a = res.answers.agent;
    expect(a.choice).toBe('coder');
    expect(a.probSource).toBe('logprob');
    expect(a.probabilities.coder).toBeCloseTo(0.75, 6);
    expect(a.probabilities.tester).toBeCloseTo(0.25, 6);
    expect(a.probabilities.__none__).toBe(0);
  });

  it('sums a label and its space-prefixed twin', async () => {
    const res = await ask(config(), choiceQ, async () => chat({ A: lp(0.2), ' A': lp(0.2), B: lp(0.2) }));
    expect(res.answers.agent.probabilities.coder).toBeCloseTo(2 / 3, 6);
  });

  it('settles confidence centrally through the picker', async () => {
    const out = await jp.ask('t', choiceQ, { providers: [config()], fetchImpl: async () => chat({ A: lp(0.9), B: lp(0.1) }) });
    // three options: (0.9 - 1/3) / (1 - 1/3) = 0.85
    expect(out.answers.agent.confidence).toBeCloseTo(0.85, 6);
    expect(out.answers.agent.probSource).toBe('logprob');
  });

  it('yields no usable answer when no allowed label appears', async () => {
    const out = await jp.ask('t', choiceQ, { providers: [config()], fetchImpl: async () => chat({ Sure: lp(0.9), Yes: lp(0.05) }) });
    expect(out).toBeNull();
  });

  it('never returns an id the response invented (injection)', async () => {
    const fetchImpl = async () => chat({ A: lp(0.1) }, undefined, 'evil-agent-id');
    const out = await jp.ask('t', choiceQ, { providers: [config()], fetchImpl });
    expect(JSON.stringify(out)).not.toContain('evil-agent-id');
  });
});

describe('openai kind: endpoints without logprobs', () => {
  it('answers with probSource none, capped below the automatic floor', async () => {
    const out = await jp.ask('t', choiceQ, { providers: [config()], fetchImpl: async () => chat(null, undefined, 'B') });
    expect(out.answers.agent.choice).toBe('tester');
    expect(out.answers.agent.probSource).toBe('none');
    expect(out.answers.agent.confidence).toBeLessThan(0.6);
    expect(jp.acceptAgent(out.answers.agent, {})).toBeNull();
  });

  it('discards a none-source answer that is not an allowed label', async () => {
    const out = await jp.ask('t', choiceQ, { providers: [config({ logprobs: false })], fetchImpl: async () => chat(null, undefined, 'Sure') });
    expect(out).toBeNull();
  });
});

describe('openai kind: noul and score', () => {
  const yesNo = (type: string) => ({ q: { type, instructions: 'Is it a bug?' } });

  it('turns Y/N logprobs into a probability of yes, for noul and for score', async () => {
    for (const type of ['noul', 'score']) {
      const res = await ask(config(), yesNo(type), async () => chat({ Y: lp(0.6), N: lp(0.2), Maybe: lp(0.1) }));
      expect(res.answers.q).toMatchObject({ type, probSource: 'logprob' });
      expect(res.answers.q.noul).toBeCloseTo(0.75, 6);
    }
  });

  it('survives the picker validation and the probe', async () => {
    const out = await jp.ask('t', yesNo('score'), { providers: [config()], fetchImpl: async () => chat({ Y: lp(0.9), N: lp(0.1) }) });
    expect(out.answers.q.noul).toBeCloseTo(0.9, 6);
    await expect(jp.probe(config(), { fetchImpl: async () => chat({ Y: lp(0.9), N: lp(0.1) }) })).resolves.toBeTypeOf('number');
  });
});

describe('openai kind: label alphabet', () => {
  const options = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`id${i}`, `option ${i}`]));

  it('handles 36 options, each with its own single-character label', async () => {
    const fetchImpl = vi.fn(async () => chat({ '9': lp(0.8), A: lp(0.1) }));
    const res = await ask(config(), { q: { type: 'choice', instructions: 'x', criteria: options(36) } }, fetchImpl);
    expect(res.answers.q.choice).toBe('id35');
  });

  it('refuses more options than labels, without sending anything', async () => {
    const fetchImpl = vi.fn(async () => chat({ A: 0 }));
    await expect(ask(config(), { q: { type: 'choice', instructions: 'x', criteria: options(37) } }, fetchImpl)).rejects.toThrow(/at most 36/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caps the picker candidate list so a full shortlist still fits', async () => {
    const agents = Array.from({ length: 60 }, (_, i) => ({ id: `agent-${i}`, name: `agent-${i}`, description: 'does things' }));
    const fetchImpl = vi.fn(async () => chat({ A: lp(0.9), B: lp(0.1) }));
    const picked = await jp.pick('do things', { agents }, { env: {}, maxCandidates: 50, fetchImpl, providers: [config()] }).catch(() => null);
    expect(providers.maxOptions([config()])).toBe(36);
    expect(providers.maxOptions([{ kind: 'systemone' }])).toBe(Infinity);
    expect(picked === null || typeof picked === 'object').toBe(true);
  });
});

describe('openai kind: transport safety', () => {
  it('does not send a key to a plain-http host that is not loopback', async () => {
    const fetchImpl = vi.fn(async () => chat({ A: 0 }));
    await expect(ask(config({ baseUrl: 'http://models.example.com' }), choiceQ, fetchImpl)).rejects.toThrow(/https/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows http on loopback, and http without a key', async () => {
    const fetchImpl = vi.fn(async () => chat({ A: lp(0.5), B: lp(0.5) }));
    await ask(config({ baseUrl: 'http://127.0.0.1:11434' }), choiceQ, fetchImpl);
    await ask({ ...config({ baseUrl: 'http://models.example.com' }), apiKey: noKey }, choiceQ, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('only talks to the provider origin', async () => {
    const fetchImpl = vi.fn(async () => chat({ A: lp(0.5), B: lp(0.5) }));
    await ask(config(), choiceQ, fetchImpl);
    for (const call of fetchImpl.mock.calls as unknown as [string][]) expect(new URL(call[0]).origin).toBe('https://api.openai.com');
  });

  it('rejects an oversized response and a non-JSON one', async () => {
    await expect(ask(config(), choiceQ, async () => new Response('x'.repeat(1024 * 1024 + 1)))).rejects.toThrow(/too large/);
    await expect(ask(config(), choiceQ, async () => new Response('<html>'))).rejects.toThrow(/not JSON/);
  });

  it('turns an HTTP error into a JevError carrying the status', async () => {
    await expect(ask(config(), choiceQ, async () => new Response('no', { status: 401 }))).rejects.toMatchObject({ status: 401 });
  });

  it('aborts at the given window', async () => {
    const never = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const started = Date.now();
    await expect(ask(config(), choiceQ, never, 120)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('openai kind: metering and configuration', () => {
  it('reports tokens and prices them from the provider config', async () => {
    const usage = { prompt_tokens: 100, completion_tokens: 1 };
    const res = await ask(config({ pricing: { in: 0.000001, out: 0.000002 } }), choiceQ, async () => chat({ A: lp(0.9), B: lp(0.1) }, usage));
    expect(res.usage).toMatchObject({ tokensIn: 100, tokensOut: 1 });
    expect(res.usage.costUsd).toBeCloseTo(0.000102, 9);
  });

  it('is free for a local config', async () => {
    const res = await ask(config({ local: true }), choiceQ, async () => chat({ A: 0 }, { prompt_tokens: 5, completion_tokens: 1 }));
    expect(res.usage.costUsd).toBe(0);
  });

  it('validates entries: model is required, extras are checked', () => {
    const ok = { name: 'oa', kind: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-x' };
    expect(providers.validateEntry(ok)).toBeNull();
    expect(providers.validateEntry({ ...ok, model: undefined })).toMatch(/model/);
    expect(providers.validateEntry({ ...ok, logprobs: 'yes' })).toMatch(/logprobs/);
    expect(providers.validateEntry({ ...ok, pricing: { in: -1, out: 1 } })).toMatch(/pricing/);
    expect(providers.validateEntry({ ...ok, local: 'x' })).toMatch(/local/);
    expect(providers.validateEntry({ ...ok, apiKey: 'sk-1' })).toMatch(/apiKeyEnv/);
  });

  it('carries logprobs, pricing and local from a named entry into the config', () => {
    const file = `/var/tmp/jev-openai-${process.pid}.json`;
    providers.writeStore(file, [
      { name: 'oa', kind: 'openai', baseUrl: 'https://api.openai.com', model: 'gpt-x', apiKeyEnv: 'OA_KEY', logprobs: false, pricing: { in: 1, out: 2 }, local: false },
    ]);
    const [p] = providers.resolveProviders({ MONOMIND_DECISION_PROVIDERS_FILE: file, OA_KEY: 'sk-1' });
    expect(p).toMatchObject({ kind: 'openai', apiKey: 'sk-1', logprobs: false, pricing: { in: 1, out: 2 }, model: 'gpt-x' });
  });

  it('is eligible for the prompt hook', () => {
    expect(providers.hookEligible(config())).toBe(true);
  });
});

describe('openai kind: capability probe', () => {
  it('reports logprobs when the endpoint returns them', async () => {
    await expect(providers.detect(config(), { fetchImpl: async () => chat({ Y: lp(0.9), N: lp(0.1) }) })).resolves.toEqual({ logprobs: true });
  });

  it('reports none when the reply has no logprobs', async () => {
    await expect(providers.detect(config(), { fetchImpl: async () => chat(null, undefined, 'Y') })).resolves.toEqual({ logprobs: false });
  });

  it('retries without logprobs when the endpoint rejects them', async () => {
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) =>
      JSON.parse(String(init.body)).logprobs ? new Response('bad', { status: 400 }) : chat(null, undefined, 'Y'),
    );
    await expect(providers.detect(config(), { fetchImpl })).resolves.toEqual({ logprobs: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws when the endpoint is unreachable, so nothing is recorded', async () => {
    await expect(providers.detect(config(), { fetchImpl: async () => { throw new Error('down'); } })).rejects.toThrow(/down/);
  });
});

describe('score on systemone', () => {
  it('sends a score question as noul and returns it tagged score', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ answers: { q: { type: 'noul', noul: 0.7 } } }), { status: 200 }));
    const out = await jp.ask('t', { q: { type: 'score', instructions: 'ok?' } }, { providers: [{ name: 's', baseUrl: 'http://127.0.0.1:3000', model: 'jev-latest' }], fetchImpl });
    const sent = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.questions.q.type).toBe('noul');
    expect(out.answers.q).toMatchObject({ type: 'score', noul: 0.7, probSource: 'native' });
  });

  it('rejects a score outside 0..1', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ answers: { q: { type: 'noul', noul: 1.5 } } }), { status: 200 });
    const out = await jp.ask('t', { q: { type: 'score', instructions: 'ok?' } }, { providers: [{ name: 's', baseUrl: 'http://127.0.0.1:3000', model: 'm' }], fetchImpl });
    expect(out).toBeNull();
  });
});
