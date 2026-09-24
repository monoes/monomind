import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { agentCatalog } from '../../src/decision/catalogs.js';
import { pickRoute } from '../../src/routing/pick-step.js';

/** The CLI package: its .claude/agents are the registry these picks rank. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const routes = [
  { name: 'test-writing', agentSlug: 'tdd-london-monoswarm', utterances: ['add unit tests'] },
  { name: 'security', agentSlug: 'Security Engineer', utterances: ['audit for injection'] },
];
const localEnv = { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' };
const answering = (choice: string, confidence: number) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          answers: {
            agent: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } },
          },
        }),
        { status: 200 },
      ),
  ) as unknown as typeof fetch;

describe('pickRoute (the central picker inside the route layer)', () => {
  it('returns the decision model pick as a spawnable name when it is confident', async () => {
    const r = await pickRoute('security review of the login flow', routes, undefined, {
      root: ROOT,
      env: localEnv,
      fetchImpl: answering('engineering-security-engineer', 0.8),
    });
    expect(r.jev).toEqual({
      agentSlug: 'Security Engineer',
      confidence: 0.8,
      method: 'jev',
      routeName: 'security',
      provider: 'custom',
    });
  });

  it('always sends the routing keyword hit to the decision model', async () => {
    const fetchImpl = answering('engineering-security-engineer', 0.8);
    // A task the TDD agent would not be shortlisted for on its own.
    await pickRoute('security review of the login flow', routes, 'tdd-london-monoswarm', {
      root: ROOT,
      env: localEnv,
      fetchImpl,
    });
    const tdd = agentCatalog(ROOT).find((a) => a.name === 'tdd-london-monoswarm');
    const body = JSON.parse(
      String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body),
    );
    expect(Object.keys(body.questions.agent.criteria)).toContain(tdd?.id);
  });

  it('ignores a decision below the automatic floor', async () => {
    const r = await pickRoute('security review of the login flow', routes, undefined, {
      root: ROOT,
      env: localEnv,
      fetchImpl: answering('engineering-security-engineer', 0.4),
    });
    expect(r.jev).toBeNull();
  });

  it('returns a keyword pick only when it clearly leads', async () => {
    const env = { MONOMIND_JEV: 'off' };
    const clear = await pickRoute('set up a zettelkasten for my notes', routes, undefined, {
      root: ROOT,
      env,
    });
    expect(clear.jev).toBeNull();
    expect(clear.keyword).toMatchObject({ agentSlug: 'ZK Steward', method: 'keyword' });
    expect(clear.keyword?.confidence).toBeGreaterThan(0.4);

    const vague = await pickRoute(
      'the login page throws a null pointer when the session cookie is missing',
      routes,
      undefined,
      { root: ROOT, env },
    );
    expect(vague.keyword).toBeNull();
  });
});
