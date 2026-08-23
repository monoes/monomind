/**
 * Gated smoke test for CodexAgentRunner against the real ChatGPT subscription.
 *
 * Only runs when MONOMIND_SMOKE=1 is set AND the `codex` CLI is on PATH with
 * valid `~/.codex/auth.json` (created by `codex login`). Skips otherwise.
 * Run manually before tagging a release:
 *
 *   MONOMIND_SMOKE=1 npx vitest run --reporter=dot \
 *     src/__tests__/smoke/codex.smoke.test.ts
 */

import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CodexAgentRunner } from '../../orgrt/codex-runner.js';

const SMOKE = process.env.MONOMIND_SMOKE === '1';

function codexAvailable(): boolean {
  try {
    execSync('codex --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const CODEX_OK = codexAvailable();

describe.skipIf(!SMOKE || !CODEX_OK)('CodexAgentRunner — ChatGPT smoke (real CLI)', () => {
  it('responds non-empty to a simple prompt', async () => {
    const runner = new CodexAgentRunner();
    const messages: any[] = [];

    const gen = runner.run({
      tools: [],
      prompt: (async function* () {
        yield 'Reply with exactly: CODEX_OK';
      })(),
      systemPrompt: 'You are a test echo. Follow instructions exactly.',
      model: 'gpt-5.6-terra',
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
