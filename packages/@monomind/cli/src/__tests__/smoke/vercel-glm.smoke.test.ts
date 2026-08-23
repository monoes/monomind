/**
 * Gated smoke test for VercelAgentRunner against the real GLM (z.ai) API.
 *
 * Only runs when MONOMIND_SMOKE=1 AND ZHIPU_API_KEY is set. Skips otherwise.
 * Run manually before tagging a release:
 *
 *   MONOMIND_SMOKE=1 ZHIPU_API_KEY=... npx vitest run --reporter=dot \
 *     src/__tests__/smoke/vercel-glm.smoke.test.ts
 */
import { describe, expect, it } from 'vitest';
import { VercelAgentRunner } from '../../orgrt/vercel-runner.js';

const SMOKE = process.env.MONOMIND_SMOKE === '1';
const KEY = process.env.ZHIPU_API_KEY;

describe.skipIf(!SMOKE || !KEY)('VercelAgentRunner — GLM smoke (real API)', () => {
  it('responds non-empty to a simple prompt', async () => {
    const runner = new VercelAgentRunner();
    const messages: any[] = [];

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'Reply with exactly: GLM_OK';
      })(),
      systemPrompt: 'You are a test echo. Follow instructions exactly.',
      model: 'glm-5.2',
      cwd: '/tmp',
      env: {
        ZHIPU_API_KEY: KEY!,
        MONOMIND_ORG_DIR: '/tmp/monomind-smoke',
        MONOMIND_ROLE_ID: 'glm-smoke',
      },
      maxTurns: 3,
      vendor: 'glm',
      providerConfig: { kind: 'vercel-api-key', vendor: 'glm', apiKeyEnv: 'ZHIPU_API_KEY' },
    } as any);

    for await (const m of gen) messages.push(m);

    const assistantText = messages
      .filter((m) => m.type === 'assistant')
      .map((m) => m.text ?? '')
      .join('');
    expect(assistantText.length).toBeGreaterThan(0);

    const result = messages.find((m) => m.type === 'result');
    expect(result).toBeDefined();
    expect(result?.input_tokens + result?.output_tokens).toBeGreaterThan(0);
  }, 60_000);
});
