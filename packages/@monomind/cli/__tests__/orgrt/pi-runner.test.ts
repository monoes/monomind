/**
 * Unit tests for the Pi coding agent's `--mode json` event parser
 * (pi-runner), built from pi-mono's published RPC event vocabulary
 * (agent_start / message_update / message_end / tool_execution_*).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parsePiEvents, PiAgentRunner } from '../../src/orgrt/pi-runner.js';
import type { AgentRunArgs } from '../../src/orgrt/agent-runner.js';

describe('parsePiEvents', () => {
  it('extracts text from a message_end event content array', () => {
    const r = parsePiEvents([
      JSON.stringify({ type: 'agent_start' }),
      JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'final answer' }] } }),
    ]);
    expect(r.texts).toEqual(['final answer']);
  });

  it('joins multiple text blocks and ignores toolCall blocks', () => {
    const r = parsePiEvents([
      JSON.stringify({
        type: 'message_end',
        message: { content: [{ type: 'text', text: 'a' }, { type: 'toolCall', id: 'c1', name: 'bash' }, { type: 'text', text: 'b' }] },
      }),
    ]);
    expect(r.texts).toEqual(['a\nb']);
  });

  it('captures usage from message.usage using input/output field names', () => {
    const r = parsePiEvents([
      JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'x' }], usage: { input: 100, output: 42 } } }),
    ]);
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(42);
  });

  it('captures usage from a top-level usage field too', () => {
    const r = parsePiEvents([JSON.stringify({ type: 'message_update', usage: { input: 5, output: 1 } })]);
    expect(r.inputTokens).toBe(5);
    expect(r.outputTokens).toBe(1);
  });

  it('keeps the last usage value seen across multiple events', () => {
    const r = parsePiEvents([
      JSON.stringify({ type: 'message_update', usage: { input: 5, output: 1 } }),
      JSON.stringify({ type: 'message_end', message: { content: [], usage: { input: 20, output: 8 } } }),
    ]);
    expect(r.inputTokens).toBe(20);
    expect(r.outputTokens).toBe(8);
  });

  it('ignores tool_execution_* and system-ish events without throwing', () => {
    const r = parsePiEvents([
      JSON.stringify({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash' }),
      JSON.stringify({ type: 'tool_execution_end', toolCallId: 'c1', isError: false }),
      JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'ok' }] } }),
    ]);
    expect(r.texts).toEqual(['ok']);
  });

  it('ignores blank/non-JSON lines and tolerates malformed JSON', () => {
    const r = parsePiEvents(['', 'not json', '{"type":"message_end"', JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'good' }] } })]);
    expect(r.texts).toEqual(['good']);
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parsePiEvents([
      JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: `Sending.\n${fence}` }] } }),
    ]);
    expect(r.texts).toEqual(['Sending.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });
});

// Regression guard for the live bug found 2026-08-25: the installed pi CLI
// (0.73.1) has no --approve flag at all — `pi --help` lists no
// approve/trust/yolo option — so passing it made every turn fail
// immediately with "Unknown option: --approve" before pi ever ran.
describe('PiAgentRunner invocation', () => {
  it('never passes --approve to the pi binary', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-fake-pi-'));
    const logFile = path.join(tmpDir, 'argv.log');
    const bin = path.join(tmpDir, 'fake-pi.cjs');
    fs.writeFileSync(
      bin,
      '#!/usr/bin/env node\n' +
        "const fs = require('fs');\n" +
        "fs.appendFileSync(process.env.FAKE_PI_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n" +
        "console.log(JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'ok' }] } }));\n",
    );
    fs.chmodSync(bin, 0o755);
    try {
      const args: AgentRunArgs = {
        tools: [],
        prompt: (async function* () { yield 'hello'; })(),
        systemPrompt: 'test role',
        cwd: tmpDir,
        env: { FAKE_PI_LOG: logFile },
        maxTurns: 5,
      };
      const messages = [];
      for await (const m of new PiAgentRunner(bin).run(args)) messages.push(m);
      expect(messages.some((m) => m.type === 'assistant' && m.text === 'ok')).toBe(true);

      const invocations = fs
        .readFileSync(logFile, 'utf-8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as string[]);
      expect(invocations).toHaveLength(1);
      expect(invocations[0]).not.toContain('--approve');
      expect(invocations[0]).toContain('--mode');
      expect(invocations[0]).toContain('json');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});

// Regression coverage for #204: PiAgentRunner used to buffer ALL of pi's
// stdout until the subprocess exited before parsing anything, so a turn
// longer than session.ts's 4-minute silent-stream watchdog yielded zero
// messages in time. Mirrors codex-runner.test.ts's streaming describe block,
// adapted to pi's own event shape (whole message_end/tool_execution_start
// lines, not per-token deltas or codex's item.* envelope).
describe('PiAgentRunner streaming (#204)', () => {
  function writeFakePi(tmpDir: string, script: string): string {
    const bin = path.join(tmpDir, 'fake-pi.cjs');
    fs.writeFileSync(bin, `#!/usr/bin/env node\n${script}`);
    fs.chmodSync(bin, 0o755);
    return bin;
  }

  function makeArgs(cwd: string): AgentRunArgs {
    return {
      tools: [],
      prompt: (async function* () {
        yield 'do work';
      })(),
      systemPrompt: 'test role',
      cwd,
      env: {},
      maxTurns: 5,
    } as any;
  }

  it('yields a liveness message immediately, then streams messages DURING the turn (not after exit)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-fake-pi-'));
    try {
      const bin = writeFakePi(
        tmpDir,
        [
          "console.log(JSON.stringify({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash' }));",
          'setTimeout(() => {',
          "  console.log(JSON.stringify({ type: 'message_end', message: { content: [{ type: 'text', text: 'partial reply' }], usage: { input: 10, output: 5 } } }));",
          '  setTimeout(() => { process.exit(0); }, 300);',
          '}, 50);',
        ].join('\n'),
      );

      const start = Date.now();
      const messages: any[] = [];
      const times: number[] = [];
      for await (const m of new PiAgentRunner(bin).run(makeArgs(tmpDir))) {
        messages.push(m);
        times.push(Date.now());
      }
      const end = Date.now();

      // First message must be the spawn-time liveness yield — this wins
      // session.ts's first-pull watchdog race deterministically.
      expect(messages[0]).toEqual({ type: 'tool_use', text: 'turn started' });
      expect(times[0] - start).toBeLessThan(300);

      // pi's own tool_execution_start is forwarded as tool_use liveness.
      const toolMsgs = messages.filter((m) => m.type === 'tool_use');
      expect(toolMsgs.some((m) => m.text === 'bash')).toBe(true);

      const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
      expect(texts).toEqual(['partial reply']);

      // Regression guard: the assistant text must arrive well BEFORE the
      // subprocess exits (the fake pi sleeps 300ms after printing it).
      // Under the old buffered design every message arrived at process exit.
      const firstAssistantIdx = messages.findIndex((m) => m.type === 'assistant');
      expect(end - times[firstAssistantIdx]).toBeGreaterThanOrEqual(200);

      const result = messages.find((m) => m.type === 'result');
      expect(result?.subtype).toBe('success');
      expect(result?.input_tokens).toBe(10);
      expect(result?.output_tokens).toBe(5);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('classifies auth/permission stderr as FATAL (non-retryable)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-fake-pi-'));
    try {
      const bin = writeFakePi(
        tmpDir,
        ["process.stderr.write('auth_error: 401 Unauthorized\\n');", 'process.exit(1);'].join(
          '\n',
        ),
      );

      let caught: any;
      try {
        for await (const _m of new PiAgentRunner(bin).run(makeArgs(tmpDir))) {
          /* consume */
        }
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(String(caught)).toContain('FATAL');
      expect(caught.fatal).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('leaves transient failures retryable (no fatal flag)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-fake-pi-'));
    try {
      const bin = writeFakePi(
        tmpDir,
        ["process.stderr.write('connection reset by peer\\n');", 'process.exit(1);'].join('\n'),
      );

      let caught: any;
      try {
        for await (const _m of new PiAgentRunner(bin).run(makeArgs(tmpDir))) {
          /* consume */
        }
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(String(caught)).toContain('pi failed (exit 1)');
      expect(caught.fatal).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
