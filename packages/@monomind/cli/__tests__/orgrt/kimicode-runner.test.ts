/**
 * Unit tests for the Kimi Code stream-json parser (kimicode-runner).
 *
 * These fixtures are the REAL event shapes captured from `kimi -p
 * --output-format stream-json` on kimi 0.29.2 (see the runner's header
 * comments). If a future kimi CLI changes the wire format, these tests fail
 * in CI instead of silently starving org agents at runtime.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { KimiCodeAgentRunner, parseStreamJsonLine, parseStreamJsonLines } from '../../src/orgrt/kimicode-runner.js';
import type { AgentMessage, AgentRunArgs } from '../../src/orgrt/agent-runner.js';

// Captured verbatim from kimi 0.29.2: `kimi -p "Say the word OK and nothing
// else" --output-format stream-json`
const REAL_TURN = [
  '{"role":"assistant","content":"OK"}',
  '{"role":"meta","type":"session.resume_hint","session_id":"session_8168324e-d371-456e-b8a3-5457f710c941","command":"kimi -r session_8168324e-d371-456e-b8a3-5457f710c941","content":"To resume this session: kimi -r session_8168324e-d371-456e-b8a3-5457f710c941"}',
];

describe('parseStreamJsonLines', () => {
  it('parses the real 0.29.2 reply + resume_hint turn', () => {
    const r = parseStreamJsonLines(REAL_TURN);
    expect(r.texts).toEqual(['OK']);
    expect(r.sessionId).toBe('session_8168324e-d371-456e-b8a3-5457f710c941');
  });

  it('parses block-form assistant content', () => {
    const r = parseStreamJsonLines([
      '{"role":"assistant","content":[{"type":"text","text":"hello"},{"type":"text","text":"world"}]}',
    ]);
    expect(r.texts).toEqual(['hello\nworld']);
  });

  it('ignores tool-progress events', () => {
    const r = parseStreamJsonLines([
      '{"role":"tool","content":"Bash(ls)"}',
      '{"role":"assistant","content":"done"}',
    ]);
    expect(r.texts).toEqual(['done']);
  });

  it('ignores non-JSON lines and blank lines', () => {
    const r = parseStreamJsonLines(['', 'resuming session…', 'not json', '{"role":"assistant","content":"x"}']);
    expect(r.texts).toEqual(['x']);
  });

  it('tolerates malformed JSON lines', () => {
    const r = parseStreamJsonLines(['{"role":"assistant","content":"ok"', '{"role":"assistant","content":"good"}']);
    expect(r.texts).toEqual(['good']);
  });

  it('captures session id from camelCase variants too', () => {
    const r = parseStreamJsonLines(['{"role":"meta","sessionId":"abc"}']);
    expect(r.sessionId).toBe('abc');
  });

  it('returns no session id when no event carries one', () => {
    const r = parseStreamJsonLines(['{"role":"assistant","content":"x"}']);
    expect(r.sessionId).toBeUndefined();
  });

  it('strips tool_call fences from yielded text but keeps raw text', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{"to":"boss","subject":"s","message":"m"}}\n```';
    const r = parseStreamJsonLines([
      JSON.stringify({ role: 'assistant', content: `Sending now.\n${fence}` }),
    ]);
    expect(r.texts).toEqual(['Sending now.']);
    expect(r.rawTexts[0]).toContain('tool_call');
  });

  it('drops assistant messages whose entire content is a tool_call fence', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const r = parseStreamJsonLines([JSON.stringify({ role: 'assistant', content: fence })]);
    expect(r.texts).toEqual([]);
    expect(r.rawTexts).toHaveLength(1);
  });
});

describe('parseStreamJsonLine', () => {
  it('parses an assistant text event incrementally', () => {
    const ev = parseStreamJsonLine('{"role":"assistant","content":"hello"}');
    expect(ev).toEqual({ kind: 'assistant', rawText: 'hello', text: 'hello', sessionId: undefined });
  });

  it('parses block-form assistant content', () => {
    const ev = parseStreamJsonLine('{"role":"assistant","content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}');
    expect(ev?.kind).toBe('assistant');
    expect(ev?.text).toBe('a\nb');
    expect(ev?.rawText).toBe('a\nb');
  });

  it('strips tool_call fences from text but keeps rawText', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const ev = parseStreamJsonLine(JSON.stringify({ role: 'assistant', content: `Sending now.\n${fence}` }));
    expect(ev?.kind).toBe('assistant');
    expect(ev?.text).toBe('Sending now.');
    expect(ev?.rawText).toContain('tool_call');
  });

  it('returns undefined text (but keeps rawText) for fence-only messages', () => {
    const fence = '```tool_call\n{"name":"org_send","arguments":{}}\n```';
    const ev = parseStreamJsonLine(JSON.stringify({ role: 'assistant', content: fence }));
    expect(ev?.kind).toBe('assistant');
    expect(ev?.text).toBeUndefined();
    expect(ev?.rawText).toContain('tool_call');
  });

  it('parses tool progress events into liveness events', () => {
    const ev = parseStreamJsonLine('{"role":"tool","content":"Bash(ls)"}');
    expect(ev).toEqual({ kind: 'tool', toolName: 'Bash(ls)', sessionId: undefined });
  });

  it('falls back to name/tool_name fields for tool labels', () => {
    expect(parseStreamJsonLine('{"role":"tool","name":"WebSearch"}')?.toolName).toBe('WebSearch');
    expect(parseStreamJsonLine('{"role":"tool","tool_name":"Grep"}')?.toolName).toBe('Grep');
    expect(parseStreamJsonLine('{"role":"tool"}')?.toolName).toBe('tool activity');
  });

  it('captures session_id from any event kind', () => {
    expect(parseStreamJsonLine('{"role":"tool","content":"Bash(ls)","session_id":"s1"')?.sessionId).toBeUndefined(); // malformed → null
    expect(parseStreamJsonLine('{"role":"tool","content":"Bash(ls)","session_id":"s1"}')?.sessionId).toBe('s1');
    expect(parseStreamJsonLine('{"role":"assistant","content":"x","session_id":"s2"}')?.sessionId).toBe('s2');
  });

  it('returns a meta event for session-id-only events (resume_hint)', () => {
    const ev = parseStreamJsonLine('{"role":"meta","type":"session.resume_hint","session_id":"session_abc"}');
    expect(ev).toEqual({ kind: 'meta', sessionId: 'session_abc' });
  });

  it('returns null for blank, non-JSON, malformed, and content-free lines', () => {
    expect(parseStreamJsonLine('')).toBeNull();
    expect(parseStreamJsonLine('resuming session…')).toBeNull();
    expect(parseStreamJsonLine('{"role":"assistant","content":"ok"')).toBeNull();
    expect(parseStreamJsonLine('{"role":"meta","type":"session.resume_hint"}')).toBeNull();
  });
});

/**
 * Runner-level streaming tests, driven by a fake `kimi` binary (a node
 * script) that emits stream-json lines WITH DELAYS, so we can prove the
 * runner yields messages while the subprocess is still running — the exact
 * property the 4-minute silent-session watchdog depends on.
 */

/** Write an executable fake-kimi script into a temp dir and return its path
 *  plus the argv log file the script appends each invocation to. */
function makeFakeKimi(body: string): { bin: string; logFile: string; tmpDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-fake-kimi-'));
  const logFile = path.join(tmpDir, 'argv.log');
  const bin = path.join(tmpDir, 'fake-kimi.cjs');
  fs.writeFileSync(bin, '#!/usr/bin/env node\n' + body);
  fs.chmodSync(bin, 0o755);
  return { bin, logFile, tmpDir };
}

// Fake turn: first stdout line is delayed (model "thinking"), then a tool
// progress event, then a long tail before the final assistant line + exit —
// total runtime ~900ms, so buffered-until-exit delivery is measurably late.
const FAKE_KIMI_SCRIPT = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  require('fs').appendFileSync(process.env.FAKE_KIMI_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
  await sleep(200);
  console.log(JSON.stringify({ role: 'assistant', content: 'working on it' }));
  await sleep(200);
  console.log(JSON.stringify({ role: 'tool', content: 'Bash(ls)' }));
  await sleep(400);
  console.log(JSON.stringify({ role: 'assistant', content: 'all done' }));
  console.log(JSON.stringify({ role: 'meta', type: 'session.resume_hint', session_id: 'session_fake_1' }));
})();
`;

// Emits a tool_call fence on the first prompt, a plain reply when the prompt
// carries tool results (the fence-protocol feedback loop).
const FAKE_KIMI_FENCE_SCRIPT = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  require('fs').appendFileSync(process.env.FAKE_KIMI_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
  const prompt = process.argv[3] || '';
  await sleep(50);
  if (prompt.includes('tool_result')) {
    console.log(JSON.stringify({ role: 'assistant', content: 'final answer' }));
  } else {
    console.log(JSON.stringify({ role: 'assistant', content: 'Sending now.\\n\`\`\`tool_call\\n{"name":"org_echo","arguments":{"text":"hi"}}\\n\`\`\`' }));
  }
  console.log(JSON.stringify({ role: 'meta', type: 'session.resume_hint', session_id: 'session_fake_fence' }));
})();
`;

// Emits NOTHING on stdout except the final reply; the session id only ever
// appears on stderr (kimi 0.33+ behaviour).
const FAKE_KIMI_STDERR_SID_SCRIPT = `
(async () => {
  require('fs').appendFileSync(process.env.FAKE_KIMI_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
  console.error(JSON.stringify({ role: 'meta', type: 'session.resume_hint', session_id: 'session_from_stderr' }));
  console.log(JSON.stringify({ role: 'assistant', content: 'quiet turn' }));
})();
`;

function makeRunArgs(bin: string, tmpDir: string, overrides?: Partial<AgentRunArgs>): AgentRunArgs {
  return {
    tools: [],
    prompt: (async function* () { yield 'do work'; })(),
    systemPrompt: 'test role',
    cwd: tmpDir,
    env: {
      // Keep usage accounting away from the real ~/.kimi-code and pass the
      // argv-log location to the fake binary.
      KIMI_CODE_HOME: path.join(tmpDir, 'kimi-home'),
      FAKE_KIMI_LOG: path.join(tmpDir, 'argv.log'),
    },
    maxTurns: 5,
    ...overrides,
  };
}

async function collect(runner: KimiCodeAgentRunner, args: AgentRunArgs): Promise<{ messages: AgentMessage[]; times: number[] }> {
  const messages: AgentMessage[] = [];
  const times: number[] = [];
  for await (const m of runner.run(args)) {
    messages.push(m);
    times.push(Date.now());
  }
  return { messages, times };
}

describe('KimiCodeAgentRunner streaming', () => {
  it('yields a liveness message immediately, then streams messages DURING the turn (not after exit)', async () => {
    const { bin, tmpDir } = makeFakeKimi(FAKE_KIMI_SCRIPT);
    try {
      const start = Date.now();
      const { messages, times } = await collect(new KimiCodeAgentRunner(bin), makeRunArgs(bin, tmpDir));
      const end = Date.now();

      // First message must be the spawn-time liveness yield — this is what
      // deterministically wins session.ts's first-pull watchdog race.
      expect(messages[0]).toEqual({ type: 'tool_use', session_id: undefined, text: 'turn started' });
      expect(times[0] - start).toBeLessThan(300);

      const types = messages.map((m) => m.type);
      expect(types).toContain('assistant');
      // Tool progress events arrive as tool_use liveness messages.
      const toolMsgs = messages.filter((m) => m.type === 'tool_use');
      expect(toolMsgs.some((m) => m.text === 'Bash(ls)')).toBe(true);

      const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
      expect(texts).toEqual(['working on it', 'all done']);

      // THE regression guard: the first assistant text must arrive well
      // BEFORE the subprocess exits (the fake sleeps 400ms after the tool
      // event before printing the final line). Under the old buffered
      // design every message arrived at process exit.
      const firstAssistantIdx = messages.findIndex((m) => m.type === 'assistant');
      expect(end - times[firstAssistantIdx]).toBeGreaterThanOrEqual(350);

      // Session id captured from the stdout resume_hint reaches messages
      // emitted after it — and the synthesized result carries it.
      const result = messages.find((m) => m.type === 'result');
      expect(result?.subtype).toBe('success');
      expect(result?.session_id).toBe('session_fake_1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('fence protocol: executes tool_call fences and feeds results back into the SAME session', async () => {
    const { bin, logFile, tmpDir } = makeFakeKimi(FAKE_KIMI_FENCE_SCRIPT);
    try {
      const handled: string[] = [];
      const args = makeRunArgs(bin, tmpDir, {
        tools: [{
          name: 'org_echo',
          description: 'echo text back',
          schema: { text: z.string() },
          handler: async (a) => { handled.push(String(a.text)); return { text: `echo:${a.text}` }; },
        }],
      });
      const { messages } = await collect(new KimiCodeAgentRunner(bin), args);

      // The OrgToolDef handler ran in-process with the fence's arguments…
      expect(handled).toEqual(['hi']);
      // …and the model's post-result reply was yielded.
      const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
      expect(texts).toContain('Sending now.'); // fence stripped from prose
      expect(texts).toContain('final answer');
      expect(texts.every((t) => !t?.includes('tool_call'))).toBe(true);

      // Two CLI invocations: first with --agent-file (fresh session), second
      // with --session <id> (resume) and the tool_result fence as prompt.
      const invocations = fs.readFileSync(logFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
      expect(invocations).toHaveLength(2);
      expect(invocations[0]).toContain('--agent-file');
      expect(invocations[0]).not.toContain('--session');
      expect(invocations[1]).toContain('--session');
      expect(invocations[1][invocations[1].indexOf('--session') + 1]).toBe('session_fake_fence');
      expect(invocations[1][1]).toContain('tool_result');
      expect(invocations[1][1]).toContain('echo:hi');

      // One synthesized result per mailbox prompt, carrying the session id.
      const results = messages.filter((m) => m.type === 'result');
      expect(results).toHaveLength(1);
      expect(results[0].session_id).toBe('session_fake_fence');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('threads canUseTool through to executeToolCall — a deny decision blocks the real handler', async () => {
    const { bin, logFile, tmpDir } = makeFakeKimi(FAKE_KIMI_FENCE_SCRIPT);
    try {
      const handled: string[] = [];
      const canUseToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
      const args = makeRunArgs(bin, tmpDir, {
        tools: [{
          name: 'org_echo',
          description: 'echo text back',
          schema: { text: z.string() },
          handler: async (a) => { handled.push(String(a.text)); return { text: `echo:${a.text}` }; },
        }],
        canUseTool: async (name, input) => {
          canUseToolCalls.push({ name, input });
          return { behavior: 'deny', message: 'blocked by policy' };
        },
      });
      await collect(new KimiCodeAgentRunner(bin), args);

      // canUseTool was consulted with the parsed tool call's name + args…
      expect(canUseToolCalls).toEqual([{ name: 'org_echo', input: { text: 'hi' } }]);
      // …and its deny decision short-circuited BEFORE the real handler ran.
      expect(handled).toEqual([]);

      // The denial (not the handler's echo result) is what got fed back as
      // the next prompt.
      const invocations = fs.readFileSync(logFile, 'utf-8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
      expect(invocations[1][1]).toContain('denied by policy');
      expect(invocations[1][1]).not.toContain('echo:hi');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  it('captures the session id from stderr when stdout never carries one', async () => {
    const { bin, tmpDir } = makeFakeKimi(FAKE_KIMI_STDERR_SID_SCRIPT);
    try {
      const { messages } = await collect(new KimiCodeAgentRunner(bin), makeRunArgs(bin, tmpDir));
      const result = messages.find((m) => m.type === 'result');
      expect(result?.session_id).toBe('session_from_stderr');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  // Regression guard for the live bug found 2026-08-25: kimi rejects an
  // --agent-file whose body (everything after the '---' frontmatter) is
  // empty with "Missing prompt body". args.systemPrompt is legitimately ''
  // for bare `agent exec` calls with no --system-file (agent.ask, `chat`
  // without --canvas, `agent test`), and with no tools the tool-protocol
  // suffix is also '' — so without a fallback, the file body was empty.
  it('never writes an --agent-file with an empty body, even with no systemPrompt and no tools', async () => {
    const { bin, tmpDir } = makeFakeKimi(`
      const fs = require('fs');
      const argv = process.argv.slice(2);
      fs.appendFileSync(process.env.FAKE_KIMI_LOG, JSON.stringify(argv) + '\\n');
      const agentFilePath = argv[argv.indexOf('--agent-file') + 1];
      const contents = fs.readFileSync(agentFilePath, 'utf-8');
      const body = contents.replace(/^---[\\s\\S]*?---\\n\\n/, '').trim();
      console.log(JSON.stringify({ role: 'assistant', content: 'body-length:' + body.length }));
    `);
    try {
      const args = makeRunArgs(bin, tmpDir, { systemPrompt: '', tools: [] });
      const { messages } = await collect(new KimiCodeAgentRunner(bin), args);
      const text = messages.find((m) => m.type === 'assistant')?.text ?? '';
      const match = /body-length:(\d+)/.exec(text);
      expect(match).not.toBeNull();
      expect(Number(match?.[1])).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
