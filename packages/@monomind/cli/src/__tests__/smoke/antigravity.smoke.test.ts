/**
 * Gated smoke test for AntigravityAgentRunner against the real Google AI Pro/Ultra
 * subscription via the Antigravity CLI.
 *
 * Only runs when MONOMIND_SMOKE=1 is set AND the `agy` CLI is on PATH with
 * valid OS keyring credentials (created by running `agy` interactively once).
 * Skips otherwise. Run manually before tagging a release:
 *
 *   MONOMIND_SMOKE=1 npx vitest run --reporter=dot \
 *     src/__tests__/smoke/antigravity.smoke.test.ts
 */

import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AntigravityAgentRunner } from '../../orgrt/antigravity-runner.js';

const SMOKE = process.env.MONOMIND_SMOKE === '1';

function agyAvailable(): boolean {
  try {
    execSync('agy --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const AGY_OK = agyAvailable();

describe.skipIf(!SMOKE || !AGY_OK)('AntigravityAgentRunner — Gemini Pro smoke (real CLI)', () => {
  it('responds non-empty to a simple prompt', async () => {
    const runner = new AntigravityAgentRunner();
    const messages: any[] = [];

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'Reply with exactly: AGY_OK';
      })(),
      systemPrompt: 'You are a test echo. Follow instructions exactly.',
      model: 'gemini-3.6-flash-high',
      cwd: '/tmp',
      env: {},
      maxTurns: 3,
    });

    for await (const m of gen) messages.push(m);

    const assistantText = messages
      .filter((m) => m.type === 'assistant')
      .map((m) => m.text ?? '')
      .join('');
    expect(assistantText.length).toBeGreaterThan(0);

    const result = messages.find((m) => m.type === 'result');
    expect(result).toBeDefined();
    expect(result?.input_tokens + result?.output_tokens).toBeGreaterThan(0);
  }, 120_000);
});
