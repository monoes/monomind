import { describe, expect, it, vi } from 'vitest';
import { routeWithJev } from '../../src/routing/jev-step.js';

const routes = [
  { name: 'core-coder', agentSlug: 'coder', description: 'Writes code', utterances: ['implement a feature'] },
  { name: 'core-tester', agentSlug: 'tester', description: 'Writes tests', utterances: ['add unit tests'] },
  { name: 'sec', agentSlug: 'security-engineer', utterances: ['audit for injection'] },
];
const localEnv = { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' };
const answering = (choice: string, confidence: number) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({ answers: { agent: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } } } }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;

describe('routeWithJev', () => {
  it('returns a jev result when the model is confident', async () => {
    const r = await routeWithJev('write specs', routes, undefined, { env: localEnv, fetchImpl: answering('tester', 0.8) });
    expect(r).toEqual({ agentSlug: 'tester', confidence: 0.8, method: 'jev', routeName: 'core-tester', provider: 'custom' });
  });

  it('returns null below the confidence floor', async () => {
    expect(await routeWithJev('t', routes, undefined, { env: localEnv, fetchImpl: answering('tester', 0.4) })).toBeNull();
  });

  it('returns null without a request when nothing is configured', async () => {
    const fetchImpl = answering('tester', 0.9);
    expect(await routeWithJev('t', routes, 'coder', { env: {}, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null and reports when the model fails', async () => {
    const onError = vi.fn();
    const fetchImpl = (async () => {
      throw new TypeError('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await routeWithJev('t', routes, undefined, { env: localEnv, fetchImpl, onError })).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });
});
