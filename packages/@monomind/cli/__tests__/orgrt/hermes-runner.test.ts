/**
 * Unit tests for HermesAgentRunner. The invocation shape and edge cases here
 * (no --usage-file on `chat`, a leaked warning line on stdout despite -Q,
 * session_id on stderr) are all live-verified against a real installed
 * `hermes` binary — see hermes-runner.ts's header for the full account,
 * including the two things an earlier docs-only design got wrong.
 *
 * Driven by a fake `hermes` binary (a node script, same convention as
 * kimicode-runner.test.ts's makeFakeKimi) so the tests exercise a REAL
 * subprocess (real argv/exit-code/signal behavior), not a mocked
 * child_process module.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { HermesAgentRunner } from '../../src/orgrt/hermes-runner.js';
import type { AgentMessage, AgentRunArgs } from '../../src/orgrt/agent-runner.js';

/** Write an executable fake-hermes script into a temp dir and return its
 *  path plus the invocation log file the script appends each invocation to.
 *  Each log line is `{ argv, prompt }` — the prompt is read from the file
 *  named by `--query-file`, the only channel the runner uses (confirmed
 *  live — see hermes-runner.ts's header). */
function makeFakeHermes(body: string): { bin: string; logFile: string; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-fake-hermes-'));
  const logFile = path.join(tmpDir, 'argv.log');
  const bin = path.join(tmpDir, 'fake-hermes.cjs');
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${FAKE_HERMES_PRELUDE}${body}`);
  fs.chmodSync(bin, 0o755);
  return { bin, logFile, tmpDir };
}

const FAKE_HERMES_PRELUDE = `
const fs = require('fs');
const argv = process.argv.slice(2);
const qfIdx = argv.indexOf('--query-file');
const prompt = qfIdx !== -1 ? fs.readFileSync(argv[qfIdx + 1], 'utf8') : '';
fs.appendFileSync(process.env.FAKE_HERMES_LOG, JSON.stringify({ argv, prompt }) + '\\n');
`;

function readInvocations(logFile: string): Array<{ argv: string[]; prompt: string }> {
  return fs.readFileSync(logFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
}

function makeRunArgs(tmpDir: string, overrides?: Partial<AgentRunArgs>): AgentRunArgs {
  return {
    tools: [],
    prompt: (async function* () {
      yield 'do work';
    })(),
    systemPrompt: 'test role',
    cwd: tmpDir,
    env: { FAKE_HERMES_LOG: path.join(tmpDir, 'argv.log') },
    maxTurns: 5,
    ...overrides,
  };
}

async function collect(
  runner: HermesAgentRunner,
  args: AgentRunArgs,
): Promise<{ messages: AgentMessage[]; times: number[] }> {
  const messages: AgentMessage[] = [];
  const times: number[] = [];
  for await (const m of runner.run(args)) {
    messages.push(m);
    times.push(Date.now());
  }
  return { messages, times };
}

// Simple successful turn: delayed reply, proving liveness fires before it.
const FAKE_HERMES_SIMPLE = `
(async () => {
  await new Promise((r) => setTimeout(r, 200));
  console.error('session_id: sess_fake_1');
  console.log('Hello from hermes');
})();
`;

// Reproduces the live-observed bug: a warning line leaks onto stdout ahead
// of the real answer, despite -Q ("quiet mode").
const FAKE_HERMES_WITH_WARNING = `
console.log('\\u26a0 tirith security scanner enabled but not available — command scanning will use pattern matching only');
console.log('the real answer');
`;

// Emits a tool_call fence on the first round, a plain reply once the resent
// transcript contains actual tool results. Checks for the literal "Tool
// results:" prefix formatToolResults() emits — NOT the bare substring
// "tool_result", which also appears in buildToolProtocol()'s own
// instructional text ("Results come back as \`\`\`tool_result fences...")
// and would otherwise false-match on round 0 before any real result exists.
const FAKE_HERMES_FENCE = `
(async () => {
  if (prompt.includes('Tool results:')) {
    console.log('final answer');
  } else {
    console.log('Sending now.\\n\`\`\`tool_call\\n{"name":"org_echo","arguments":{"text":"hi"}}\\n\`\`\`');
  }
})();
`;

// Always emits a tool_call fence, regardless of prompt — drives the
// MAX_TOOL_ROUNDS cap.
const FAKE_HERMES_ALWAYS_TOOLCALL = `
console.log('\`\`\`tool_call\\n{"name":"org_echo","arguments":{"text":"x"}}\\n\`\`\`');
`;

// Fails with a fatal (auth) stderr pattern.
const FAKE_HERMES_AUTH_FAIL = `
console.error('401 unauthorized — run hermes setup');
process.exit(1);
`;

describe('HermesAgentRunner', () => {
  it('invokes hermes chat --query-file --oneshot -Q (no --usage-file — invalid on `chat`, confirmed live), yields the reply, and reports zero usage', async () => {
    const { bin, logFile, tmpDir } = makeFakeHermes(FAKE_HERMES_SIMPLE);
    try {
      const { messages } = await collect(new HermesAgentRunner(bin), makeRunArgs(tmpDir));

      const [inv] = readInvocations(logFile);
      expect(inv.argv).toContain('chat');
      expect(inv.argv).toContain('--oneshot');
      expect(inv.argv).toContain('-Q');
      expect(inv.argv).toContain('--query-file');
      // --usage-file is a top-level `-z` flag, not a `chat` flag — passing
      // it to `chat` is a hard argument-parse error (confirmed live).
      expect(inv.argv).not.toContain('--usage-file');
      expect(inv.prompt).toContain('do work');

      const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
      expect(texts).toEqual(['Hello from hermes']);

      const result = messages.find((m) => m.type === 'result');
      expect(result?.subtype).toBe('success');
      // hermes has no usage-report mechanism reachable from `chat` — always 0.
      expect(result?.input_tokens).toBe(0);
      expect(result?.output_tokens).toBe(0);
      expect(result?.cost_usd).toBe(0);
      // session_id IS available, but from stderr, not a usage file.
      expect(result?.session_id).toBe('sess_fake_1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('strips a leaked warning line from stdout before treating the rest as the response (live-observed: -Q does not guarantee pure stdout)', async () => {
    const { bin, tmpDir } = makeFakeHermes(FAKE_HERMES_WITH_WARNING);
    try {
      const { messages } = await collect(new HermesAgentRunner(bin), makeRunArgs(tmpDir));
      const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
      expect(texts).toEqual(['the real answer']);
      expect(texts.some((t) => t?.includes('tirith'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('yields a liveness tool_use message immediately, before the subprocess produces any output', async () => {
    const { bin, tmpDir } = makeFakeHermes(FAKE_HERMES_SIMPLE);
    try {
      const start = Date.now();
      const { messages, times } = await collect(new HermesAgentRunner(bin), makeRunArgs(tmpDir));

      expect(messages[0]).toEqual({ type: 'tool_use', session_id: undefined, text: 'turn started' });
      // The fake sleeps 200ms before printing anything — the liveness yield
      // must land well before that, not after.
      expect(times[0] - start).toBeLessThan(150);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('fence protocol: executes tool_call fences and resends the FULL transcript (system+tools+history) every round, since headless hermes has no session-resume flag', async () => {
    const { bin, logFile, tmpDir } = makeFakeHermes(FAKE_HERMES_FENCE);
    try {
      const handled: string[] = [];
      const args = makeRunArgs(tmpDir, {
        systemPrompt: 'UNIQUE-SYSTEM-PROMPT-MARKER',
        tools: [
          {
            name: 'org_echo',
            description: 'echo text back',
            schema: { text: z.string() },
            handler: async (a) => {
              handled.push(String(a.text));
              return { text: `echo:${a.text}` };
            },
          },
        ],
      });
      const { messages } = await collect(new HermesAgentRunner(bin), args);

      expect(handled).toEqual(['hi']);
      const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
      expect(texts).toContain('Sending now.'); // fence stripped from prose
      expect(texts).toContain('final answer');
      expect(texts.every((t) => !t?.includes('tool_call'))).toBe(true);

      const invocations = readInvocations(logFile);
      expect(invocations).toHaveLength(2);
      // Round 2 has no resume flag to rely on — its resent prompt must carry
      // the ENTIRE prior context: the original system prompt, round 1's raw
      // assistant text (fence intact), and the tool_result fence.
      expect(invocations[1].prompt).toContain('UNIQUE-SYSTEM-PROMPT-MARKER');
      expect(invocations[1].prompt).toContain('Sending now.');
      expect(invocations[1].prompt).toContain('tool_call');
      expect(invocations[1].prompt).toContain('tool_result');
      expect(invocations[1].prompt).toContain('echo:hi');

      const results = messages.filter((m) => m.type === 'result');
      expect(results).toHaveLength(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('threads canUseTool through to executeToolCall — a deny decision blocks the real handler', async () => {
    const { bin, logFile, tmpDir } = makeFakeHermes(FAKE_HERMES_FENCE);
    try {
      const handled: string[] = [];
      const canUseToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
      const args = makeRunArgs(tmpDir, {
        tools: [
          {
            name: 'org_echo',
            description: 'echo text back',
            schema: { text: z.string() },
            handler: async (a) => {
              handled.push(String(a.text));
              return { text: `echo:${a.text}` };
            },
          },
        ],
        canUseTool: async (name, input) => {
          canUseToolCalls.push({ name, input });
          return { behavior: 'deny', message: 'blocked by policy' };
        },
      });
      await collect(new HermesAgentRunner(bin), args);

      expect(canUseToolCalls).toEqual([{ name: 'org_echo', input: { text: 'hi' } }]);
      expect(handled).toEqual([]);

      const invocations = readInvocations(logFile);
      expect(invocations[1].prompt).toContain('denied by policy');
      expect(invocations[1].prompt).not.toContain('echo:hi');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('caps tool-call rounds at MAX_TOOL_ROUNDS and reports the drop instead of looping forever', async () => {
    const { bin, tmpDir } = makeFakeHermes(FAKE_HERMES_ALWAYS_TOOLCALL);
    try {
      const args = makeRunArgs(tmpDir, {
        tools: [
          {
            name: 'org_echo',
            description: 'echo text back',
            schema: { text: z.string() },
            handler: async (a) => ({ text: `echo:${a.text}` }),
          },
        ],
      });
      const { messages } = await collect(new HermesAgentRunner(bin), args);
      const capMsg = messages.find(
        (m) => m.type === 'assistant' && m.text?.includes('tool-call round cap'),
      );
      expect(capMsg?.text).toContain('dropping');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 20000);

  it('throws an actionable install-hint error when the hermes binary is missing (ENOENT)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-fake-hermes-'));
    try {
      const runner = new HermesAgentRunner('/nonexistent/hermes/binary/xyz');
      await expect(collect(runner, makeRunArgs(tmpDir))).rejects.toThrow(
        /HermesAgentRunner requires the Hermes CLI .* on PATH/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('tags an auth/quota stderr failure as fatal (non-retryable) instead of a generic error', async () => {
    const { bin, tmpDir } = makeFakeHermes(FAKE_HERMES_AUTH_FAIL);
    try {
      const runner = new HermesAgentRunner(bin);
      let caught: (Error & { fatal?: boolean }) | undefined;
      try {
        await collect(runner, makeRunArgs(tmpDir));
      } catch (err) {
        caught = err as Error & { fatal?: boolean };
      }
      expect(caught?.fatal).toBe(true);
      expect(caught?.message).toContain('FATAL provider error');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('abort: args.signal kills a running hermes turn and the run fails instead of orphaning the child', async () => {
    const { bin, tmpDir } = makeFakeHermes(`
      setTimeout(() => {}, 60_000);
    `);
    try {
      const abort = new AbortController();
      const runner = new HermesAgentRunner(bin);
      const gen = runner.run(makeRunArgs(tmpDir, { signal: abort.signal }))[Symbol.asyncIterator]();
      await gen.next(); // liveness
      const pending = gen.next(); // blocked waiting on the hung child
      const start = Date.now();
      abort.abort();

      const outcome = await Promise.race([
        pending.then(
          () => 'resolved',
          (e) => `rejected: ${String(e)}`,
        ),
        new Promise<string>((r) => setTimeout(() => r('hung'), 5000)),
      ]);
      expect(outcome).toMatch(/^rejected:/);
      expect(Date.now() - start).toBeLessThan(4000);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
