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
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import {
  classifiedText,
  execErrorCode,
  UNCLASSIFIED_MARKER,
} from '../../src/orgrt/agent-exec-errors.js';
import { HERMES_MAX_QUERY_ARG_BYTES, HermesAgentRunner } from '../../src/orgrt/hermes-runner.js';
import type { AgentMessage, AgentRunArgs } from '../../src/orgrt/agent-runner.js';

// Storage policy is covered by runner-inputs-599.test.ts; these runner unit
// fixtures deliberately use the test worker's isolated temporary HOME.
vi.mock('../../src/orgrt/runner-inputs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orgrt/runner-inputs.js')>();
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  return { ...actual, createRunnerInputDir: (runner: string) => fs.mkdtempSync(path.join(os.tmpdir(), `runner-fixture-${runner}-`)) };
});

/** Write an executable fake-hermes script into a temp dir and return its
 *  path plus the invocation log file the script appends each invocation to.
 *  Each log line is `{ argv, prompt }` — the prompt is read from the file
 *  named by `--query-file`, or from `--query=<text>` (see hermes-runner.ts's
 *  header). `chat --help` is answered with hermes 0.19.0's options, or with
 *  a `--query-file` build's when FAKE_HERMES_QUERY_FILE is set, and is not
 *  logged. */
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
if (argv.includes('--help')) {
  console.log('usage: hermes chat [-h] [-q QUERY] [-m MODEL] [-Q]');
  if (process.env.FAKE_HERMES_QUERY_FILE) console.log('  --query-file PATH  --oneshot');
  process.exit(0);
}
const qfIdx = argv.indexOf('--query-file');
const qArg = argv.find((a) => a.startsWith('--query='));
const prompt = qfIdx !== -1 ? fs.readFileSync(argv[qfIdx + 1], 'utf8') : qArg ? qArg.slice(8) : '';
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
  it('hermes 0.19.0 (no --query-file in `chat --help`): sends the prompt as --query=<text> -Q, without --oneshot, yields the reply, and reports zero usage', async () => {
    const { bin, logFile, tmpDir } = makeFakeHermes(FAKE_HERMES_SIMPLE);
    try {
      const { messages } = await collect(
        new HermesAgentRunner(bin),
        makeRunArgs(tmpDir, { systemPrompt: '--- starts with a dash', model: 'openrouter/x' }),
      );

      const [inv] = readInvocations(logFile);
      expect(inv.argv[0]).toBe('chat');
      // 0.19.0 rejects both flags with an argparse error.
      expect(inv.argv).not.toContain('--query-file');
      expect(inv.argv).not.toContain('--oneshot');
      expect(inv.argv).not.toContain('--usage-file');
      expect(inv.argv).toContain('-Q');
      expect(inv.argv.slice(-2)).toEqual(['-m', 'openrouter/x']);
      // One `--query=` element, so a prompt starting with `-` is not a flag.
      expect(inv.argv[1].startsWith('--query=--- starts with a dash')).toBe(true);
      expect(inv.prompt).toContain('do work');

      const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
      expect(texts).toEqual(['Hello from hermes']);
      const result = messages.find((m) => m.type === 'result');
      expect(result?.subtype).toBe('success');
      expect(result?.input_tokens).toBe(0);
      expect(result?.output_tokens).toBe(0);
      expect(result?.cost_usd).toBeUndefined(); // no cost reported: unknown, not $0 (rev 28)
      expect(result?.session_id).toBe('sess_fake_1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('a build whose `chat --help` lists --query-file gets chat --query-file <path> --oneshot -Q (no --usage-file — invalid on `chat`, confirmed live)', async () => {
    const { bin, logFile, tmpDir } = makeFakeHermes(FAKE_HERMES_SIMPLE);
    try {
      const args = makeRunArgs(tmpDir);
      args.env.FAKE_HERMES_QUERY_FILE = '1';
      const { messages } = await collect(new HermesAgentRunner(bin), args);

      const [inv] = readInvocations(logFile);
      expect(inv.argv.slice(0, 2)).toEqual(['chat', '--query-file']);
      expect(inv.argv).toContain('--oneshot');
      expect(inv.argv).toContain('-Q');
      expect(inv.argv.some((a) => a.startsWith('--query='))).toBe(false);
      expect(inv.argv).not.toContain('--usage-file');
      expect(inv.prompt).toContain('do work');
      const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
      expect(texts).toEqual(['Hello from hermes']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('probes `chat --help` once per runner, not once per turn', async () => {
    const { bin, tmpDir } = makeFakeHermes(FAKE_HERMES_SIMPLE);
    const helpLog = path.join(tmpDir, 'help.log');
    // Wrap the fake so each --help run is counted.
    const wrapper = path.join(tmpDir, 'count-help.sh');
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\ncase "$*" in *--help*) echo x >> "${helpLog}";; esac\nexec "${bin}" "$@"\n`,
    );
    fs.chmodSync(wrapper, 0o755);
    try {
      const runner = new HermesAgentRunner(wrapper);
      await collect(runner, makeRunArgs(tmpDir));
      await collect(runner, makeRunArgs(tmpDir));
      expect(fs.readFileSync(helpLog, 'utf8').trim().split('\n')).toHaveLength(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  describe('`chat --help` probe', () => {
    /** A fake hermes whose `chat --help` runs `helpBody` (with `n`, the
     *  1-based probe count, logged to help.log); any other call answers
     *  "ok" and logs its argv to FAKE_HERMES_LOG. */
    function makeProbeHermes(helpBody: string): { bin: string; tmpDir: string; probes: () => number } {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-fake-hermes-'));
      const helpLog = path.join(tmpDir, 'help.log');
      const bin = path.join(tmpDir, 'fake-hermes.cjs');
      fs.writeFileSync(
        bin,
        `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  fs.appendFileSync(${JSON.stringify(helpLog)}, 'x\\n');
  const n = fs.readFileSync(${JSON.stringify(helpLog)}, 'utf8').trim().split('\\n').length;
  ${helpBody}
} else {
  fs.appendFileSync(process.env.FAKE_HERMES_LOG, JSON.stringify({ argv }) + '\\n');
  console.log('ok');
}
`,
      );
      fs.chmodSync(bin, 0o755);
      const probes = () =>
        fs.existsSync(helpLog) ? fs.readFileSync(helpLog, 'utf8').trim().split('\n').length : 0;
      return { bin, tmpDir, probes };
    }

    it('a hung probe times out, the run falls back to --query=, and the next run probes again', async () => {
      const { bin, tmpDir, probes } = makeProbeHermes('setTimeout(() => {}, 60_000);');
      try {
        const runner = new HermesAgentRunner(bin, { helpProbeTimeoutMs: 300 });
        const { messages } = await collect(runner, makeRunArgs(tmpDir));
        expect(messages.find((m) => m.type === 'result')?.subtype).toBe('success');
        const [inv] = readInvocations(path.join(tmpDir, 'argv.log'));
        expect(inv.argv[1].startsWith('--query=')).toBe(true);
        await collect(runner, makeRunArgs(tmpDir));
        expect(probes()).toBe(2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 15000);

    it('a non-zero probe exit is not cached', async () => {
      const { bin, tmpDir, probes } = makeProbeHermes(
        "console.log('usage: hermes chat [-q QUERY]'); process.exit(1);",
      );
      try {
        const runner = new HermesAgentRunner(bin);
        await collect(runner, makeRunArgs(tmpDir));
        await collect(runner, makeRunArgs(tmpDir));
        expect(probes()).toBe(2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 15000);

    it('reads help printed on stderr', async () => {
      const { bin, tmpDir } = makeProbeHermes(
        "console.error('usage: hermes chat --query-file PATH --oneshot'); process.exit(0);",
      );
      try {
        await collect(new HermesAgentRunner(bin), makeRunArgs(tmpDir));
        const [inv] = readInvocations(path.join(tmpDir, 'argv.log'));
        expect(inv.argv.slice(0, 2)).toEqual(['chat', '--query-file']);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 15000);

    it('re-probes after a failed probe, then caches the first clean one', async () => {
      const { bin, tmpDir, probes } = makeProbeHermes(
        "if (n === 1) process.exit(3); console.log('usage: hermes chat [-q QUERY]');",
      );
      try {
        const runner = new HermesAgentRunner(bin);
        await collect(runner, makeRunArgs(tmpDir));
        await collect(runner, makeRunArgs(tmpDir));
        await collect(runner, makeRunArgs(tmpDir));
        expect(probes()).toBe(2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 15000);

    it('honours args.signal while the probe runs', async () => {
      const { bin, tmpDir } = makeProbeHermes('setTimeout(() => {}, 60_000);');
      try {
        const abort = new AbortController();
        const runner = new HermesAgentRunner(bin);
        const start = Date.now();
        setTimeout(() => abort.abort(), 200);
        await expect(
          collect(runner, makeRunArgs(tmpDir, { signal: abort.signal })),
        ).rejects.toThrow(/aborted/);
        expect(Date.now() - start).toBeLessThan(4000);
        expect(fs.existsSync(path.join(tmpDir, 'argv.log'))).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 15000);
  });

  it('fails with a clear error instead of E2BIG when a --query= prompt is over the argv limit', async () => {
    const { bin, logFile, tmpDir } = makeFakeHermes(FAKE_HERMES_SIMPLE);
    try {
      const args = makeRunArgs(tmpDir, { systemPrompt: 'x'.repeat(HERMES_MAX_QUERY_ARG_BYTES + 1) });
      await expect(collect(new HermesAgentRunner(bin), args)).rejects.toThrow(
        /over the \d+-byte limit for one command-line argument/,
      );
      expect(fs.existsSync(logFile)).toBe(false);
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
      // #326: the capped round is answered with a notice first, then the
      // wrap-up round's calls are dropped.
      const capMsgs = messages.filter(
        (m) => m.type === 'assistant' && m.text?.includes('tool-call round cap'),
      );
      expect(capMsgs[0]?.text).toContain('returned unrun');
      expect(capMsgs[1]?.text).toContain('dropping');
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

  it("a failed turn with empty stderr: hermes's own no-credentials line is classified, the rest of stdout is attached but not classified", async () => {
    const { bin, tmpDir } = makeFakeHermes(`
      console.log('');
      console.log("It looks like Hermes isn't configured yet -- no API keys or providers found.");
      console.log('');
      console.log('  Run:  hermes setup');
      process.exit(1);
    `);
    try {
      const err = await collect(new HermesAgentRunner(bin), makeRunArgs(tmpDir)).then(
        () => undefined,
        (e: Error & { fatal?: boolean }) => e,
      );
      expect(err?.message).toMatch(/exit 1\): It looks like Hermes isn't configured yet/);
      expect(err?.fatal).toBe(true);
      expect(execErrorCode(err, err?.message ?? '').code).toBe('auth');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it.each([
    "The staging database isn't configured yet -- no API keys or providers found for it.",
    'Sorry: no inference provider configured for the billing service.',
    "Here is what hermes says:\nNo inference provider configured. Run 'hermes model' to choose a provider",
  ])('model text quoting hermes-like phrases stays runner-error, not fatal: %s', async (text) => {
    const { bin, tmpDir } = makeFakeHermes(`
      console.log(${JSON.stringify(text)});
      process.exit(1);
    `);
    try {
      const err = await collect(new HermesAgentRunner(bin), makeRunArgs(tmpDir)).then(
        () => undefined,
        (e: Error & { fatal?: boolean }) => e,
      );
      expect(classifiedText(err?.message ?? '')).toBe('HermesAgentRunner: hermes chat failed (exit 1)');
      expect(execErrorCode(err, err?.message ?? '').code).toBe('runner-error');
      expect(err?.fatal).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('model text on stdout of a failed turn never feeds the error classifier', async () => {
    const { bin, tmpDir } = makeFakeHermes(`
      console.log('The API returned 401 unauthorized and quota exceeded, missing API key.');
      process.exit(1);
    `);
    try {
      const err = await collect(new HermesAgentRunner(bin), makeRunArgs(tmpDir)).then(
        () => undefined,
        (e: Error & { fatal?: boolean }) => e,
      );
      expect(err?.message).toContain(`${UNCLASSIFIED_MARKER}hermes stdout: The API returned 401`);
      expect(classifiedText(err?.message ?? '')).toBe('HermesAgentRunner: hermes chat failed (exit 1)');
      expect(execErrorCode(err, err?.message ?? '').code).toBe('runner-error');
      expect(err?.fatal).toBeUndefined();
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
