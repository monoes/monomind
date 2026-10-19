/**
 * `agent exec --attach FILE` (rev 32, capability `agent-exec-attachments`):
 * flag validation at the command layer, claude content blocks through the
 * REAL ClaudeAgentRunner (fake Agent SDK), codex `--image` argv (first exec
 * only), the "Attached files:" fallback for every other runtime, the
 * capability, and the unchanged no-attachment message. No real CLI runs.
 */

import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runExec } from '../commands/agent-exec.js';
import { type AgentExecOptions, runAgentExec } from '../orgrt/agent-exec.js';
import { ATTACH_MAX_BYTES, parseAttachFlags, withFileList } from '../orgrt/agent-exec-attach.js';
import { RESUME_PROMPT } from '../orgrt/agent-exec-retry.js';
import type { AgentMessage, AgentRunArgs, AgentRunner } from '../orgrt/agent-runner.js';
import { ClaudeAgentRunner } from '../orgrt/agent-runner.js';
import { CodexAgentRunner } from '../orgrt/codex-runner.js';
import { codexExecArgs } from '../orgrt/codex-runner-stream.js';
import { AGENT_PROTOCOL_CAPABILITIES } from '../protocol-capabilities.js';
import type { CommandContext } from '../types.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));

// A valid 1×1 PNG (header and pixel tests: agent-exec-attach-image.test.ts).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const PDF = Buffer.from('%PDF-1.7\n%fake\n');

const dir = mkdtempSync(join(tmpdir(), 'mm-attach-'));
function file(name: string, data: Buffer | string): string {
  const path = join(dir, name);
  writeFileSync(path, data);
  return path;
}
const png = file('shot.png', PNG);
const pdf = file('spec.pdf', PDF);
const txt = file('notes.txt', 'plain notes');
const fakePng = file('not-really.png', 'just text');

const SUCCESS: AgentMessage = { type: 'result', subtype: 'success', is_error: false };
const args = {
  tools: [],
  prompt: (async function* () {})(),
  systemPrompt: '',
  cwd: '/w',
  env: {},
  maxTurns: 1,
} as AgentRunArgs;

/** A runner that records its args and the one prompt message's content. */
function capture(): { runner: AgentRunner; seen: AgentRunArgs[]; content: unknown[] } {
  const seen: AgentRunArgs[] = [];
  const content: unknown[] = [];
  return {
    seen,
    content,
    runner: {
      async *run(args) {
        seen.push(args);
        for await (const m of args.prompt as AsyncIterable<{ message: { content: unknown } }>)
          content.push(m.message.content);
        yield SUCCESS;
      },
    },
  };
}

async function exec(over: Partial<AgentExecOptions>, runner?: AgentRunner) {
  const events: Record<string, unknown>[] = [];
  const cap = capture();
  const code = await runAgentExec({
    runtime: 'claude',
    prompt: 'look at this',
    maxTurns: 3,
    toolTimeoutMs: 60_000,
    ...over,
    runnerOverride: runner ?? cap.runner,
    emit: (ev) => events.push(ev),
    stdin: new PassThrough(),
  });
  return { code, events, ...cap };
}

const ctx = (flags: Record<string, unknown>): CommandContext => ({
  args: [],
  flags: { _: [], runtime: 'crush', prompt: 'hi', ...flags },
  cwd: process.cwd(),
  interactive: false,
});

describe('--attach validation (command layer)', () => {
  let stderr: string;
  beforeEach(() => {
    stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      stderr += String(s);
      return true;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['a missing file', [join(dir, 'nope.png')], /no such file/],
    ['a directory', [dir], /not a regular file/],
    ['more than 10 files', Array(11).fill(txt), /at most 10 files \(got 11\)/],
  ])('rejects %s with exit 2 and runs nothing', async (_, attach, msg) => {
    const { runner, seen } = capture();
    expect(await runExec(ctx({ attach }), { runnerOverride: runner, emit: () => {} })).toBe(2);
    expect(seen).toHaveLength(0);
    expect(stderr).toMatch(msg);
  });

  it('rejects a file over 20 MB', async () => {
    const big = file('big.bin', '');
    truncateSync(big, ATTACH_MAX_BYTES + 1);
    const { runner, seen } = capture();
    expect(await runExec(ctx({ attach: [big] }), { runnerOverride: runner, emit: () => {} })).toBe(
      2,
    );
    expect(seen).toHaveLength(0);
    expect(stderr).toMatch(/over the 20 MB limit/);
  });

  it('accepts a single value or a list and resolves them to absolute paths', () => {
    expect(parseAttachFlags(undefined)).toEqual({ paths: [] });
    expect(parseAttachFlags(png)).toEqual({ paths: [png] });
    expect(parseAttachFlags([relative(process.cwd(), png), txt])).toEqual({ paths: [png, txt] });
  });

  it('forwards valid files to the engine, which lists them for a fallback runtime', async () => {
    const { runner, content } = capture();
    const code = await runExec(ctx({ attach: [png, txt] }), {
      runnerOverride: runner,
      emit: () => {},
    });
    expect(code).toBe(0);
    expect(content[0]).toBe(`hi\n\nAttached files:\n- ${png}\n- ${txt}`);
  });
});

/** The real ClaudeAgentRunner over a fake SDK whose query() records the prompt stream. */
function claudeRunner(received: unknown[]): ClaudeAgentRunner {
  const query = ((params: { prompt: AsyncIterable<unknown> }) =>
    (async function* () {
      for await (const m of params.prompt) received.push(m);
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 's1',
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
      };
    })()) as never;
  const sdk = { createSdkMcpServer: () => ({}), query, tool: () => ({}) };
  return new ClaudeAgentRunner(query, async () => sdk as never);
}

describe('claude: content blocks', () => {
  it('sends images and PDFs as base64 blocks, then the text listing the rest', async () => {
    const received: unknown[] = [];
    const { code } = await exec({ attachments: [png, pdf, txt, fakePng] }, claudeRunner(received));
    expect(code).toBe(0);
    expect(received).toEqual([
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') },
            },
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: PDF.toString('base64'),
              },
            },
            { type: 'text', text: `look at this\n\nAttached files:\n- ${txt}\n- ${fakePng}` },
          ],
        },
        parent_tool_use_id: null,
        session_id: undefined,
      },
    ]);
  });

  it('lists an image over the API 5 MB limit instead of sending it', async () => {
    const huge = file('huge.png', PNG);
    truncateSync(huge, 5 * 1024 * 1024 + 1);
    const received: unknown[] = [];
    await exec({ attachments: [huge, png] }, claudeRunner(received));
    const content = (received[0] as { message: { content: Record<string, unknown>[] } }).message
      .content;
    expect(content.map((b) => b.type)).toEqual(['image', 'text']);
    expect(content[1].text).toBe(`look at this\n\nAttached files:\n- ${huge}`);
  });

  it('keeps the blocks of one message under 20 MB in all', async () => {
    const pdfs = [1, 2, 3, 4, 5].map((n) => {
      const p = file(`part${n}.pdf`, PDF);
      truncateSync(p, 4.5 * 1024 * 1024);
      return p;
    });
    const received: unknown[] = [];
    await exec({ attachments: pdfs }, claudeRunner(received));
    const content = (received[0] as { message: { content: Record<string, unknown>[] } }).message
      .content;
    expect(content.filter((b) => b.type === 'document')).toHaveLength(4);
    expect(content.at(-1)?.text).toBe(`look at this\n\nAttached files:\n- ${pdfs[4]}`);
  });

  it('without --attach the message is the prompt string, byte for byte as before', async () => {
    const received: unknown[] = [];
    await exec({}, claudeRunner(received));
    expect(received).toEqual([
      {
        type: 'user',
        message: { role: 'user', content: 'look at this' },
        parent_tool_use_id: null,
        session_id: undefined,
      },
    ]);
    const { seen } = await exec({ attachments: [] });
    expect('images' in seen[0]).toBe(false);
  });

  it('keeps blocks with --resume (the SDK resumes; the message still carries them)', async () => {
    const received: unknown[] = [];
    await exec({ attachments: [png], resume: 'sess-1' }, claudeRunner(received));
    const content = (received[0] as { message: { content: Record<string, unknown>[] } }).message
      .content;
    expect(content.map((b) => b.type)).toEqual(['image', 'text']);
  });
});

describe('codex: --image', () => {
  it('engine: images go to AgentRunArgs.images, other files are listed', async () => {
    const { seen, content } = await exec({ runtime: 'codex', attachments: [png, txt, fakePng] });
    expect(seen[0].images).toEqual([png]);
    expect(content[0]).toBe(`look at this\n\nAttached files:\n- ${txt}\n- ${fakePng}`);
  });

  it('engine: no images → no images field and the prompt unchanged', async () => {
    const { seen, content } = await exec({ runtime: 'codex' });
    expect('images' in seen[0]).toBe(false);
    expect(content[0]).toBe('look at this');
  });

  it('argv: --image per file right before `-- -`; none = unchanged', () => {
    const argv = codexExecArgs(args, undefined, [png, '/w/b.jpg']);
    expect(argv.slice(-6)).toEqual(['--image', png, '--image', '/w/b.jpg', '--', '-']);
    expect(codexExecArgs(args, undefined, [])).toEqual(codexExecArgs(args, undefined));
    expect(codexExecArgs(args, undefined)).not.toContain('--image');
  });

  it('argv: a resumed turn puts --image after `resume <id>` (exec resume has its own)', () => {
    const argv = codexExecArgs(args, 't1', [png]);
    expect(argv.slice(-6)).toEqual(['resume', 't1', '--image', png, '--', '-']);
  });
});

/** A fake `codex exec` child that prints the given JSONL lines, then exits 0. */
function codexChild(lines: Record<string, unknown>[]): cp.ChildProcess {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stdout[Symbol.asyncIterator] = async function* () {
    for (const l of lines) yield Buffer.from(`${JSON.stringify(l)}\n`);
  };
  child.stderr = new EventEmitter();
  child.stdin = { on: vi.fn(), end: vi.fn(), write: vi.fn() };
  child.kill = vi.fn();
  setTimeout(() => child.emit('close', 0), 5);
  return child as cp.ChildProcess;
}

describe('CodexAgentRunner: images ride on the first exec only', () => {
  beforeEach(() => vi.mocked(cp.spawn).mockReset());

  it('a tool round re-spawns codex without --image', async () => {
    const started = { type: 'session_configured', session_id: 't1', thread_id: 't1' };
    vi.mocked(cp.spawn)
      .mockReturnValueOnce(
        codexChild([
          started,
          {
            type: 'agent_message',
            message: 'Checking.\n```tool_call\n{"name": "nope", "arguments": {}}\n```',
          },
        ]),
      )
      .mockReturnValueOnce(codexChild([started, { type: 'agent_message', message: 'Done.' }]));

    const runner = new CodexAgentRunner('/usr/bin/codex');
    for await (const _ of runner.run({
      ...args,
      prompt: (async function* () {
        yield 'hello';
      })(),
      images: [png],
    })) {
      /* drain */
    }
    const argvs = vi.mocked(cp.spawn).mock.calls.map((c) => c[1] as string[]);
    expect(argvs).toHaveLength(2);
    expect(argvs[0].slice(-4)).toEqual(['--image', png, '--', '-']);
    expect(argvs[1]).not.toContain('--image');
    expect(argvs[1]).toContain('resume');
  }, 15_000);
});

describe('other runtimes: "Attached files:" block', () => {
  it.each(['crush', 'opencode', 'kimicode', 'pi'])(
    '%s gets absolute paths after the prompt',
    async (runtime) => {
      const { seen, content } = await exec({ runtime, attachments: [png, pdf] });
      expect(content[0]).toBe(`look at this\n\nAttached files:\n- ${png}\n- ${pdf}`);
      expect('images' in seen[0]).toBe(false);
    },
  );

  it('withFileList leaves the prompt alone when there is nothing to list', () => {
    expect(withFileList('p', [])).toBe('p');
  });
});

describe('rate-limit retry with attachments', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** n-th run(): plays plans[n]; records resume + prompt content. */
  function planned(plans: Array<{ yield?: AgentMessage[]; throw?: Error }>) {
    const calls: Array<{ resume?: string; content: unknown }> = [];
    const runner: AgentRunner = {
      async *run(a) {
        let content: unknown;
        for await (const m of a.prompt as AsyncIterable<{ message: { content: unknown } }>)
          content = m.message.content;
        calls.push({ resume: a.resume, content });
        const plan = plans[calls.length - 1];
        for (const m of plan.yield ?? []) yield m;
        if (plan.throw) throw plan.throw;
      },
    };
    return { runner, calls };
  }
  // The shape agent-exec-retry.test.ts uses for a transient 429.
  const RATE_LIMITED = new Error(
    '429: {"message":"Provider returned error","code":429,"metadata":{"raw":"m:free is temporarily rate-limited upstream. Please retry shortly"}}',
  );

  it('a retry from scratch sends the files again', async () => {
    const { runner, calls } = planned([{ throw: RATE_LIMITED }, { yield: [SUCCESS] }]);
    const p = exec({ runtime: 'claude', attachments: [png] }, runner);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await p).code).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect((calls[1].content as Record<string, unknown>[])[0].type).toBe('image');
  });

  it('a resumed retry sends only the continue prompt (the session has the files)', async () => {
    const tool = { type: 'tool_use', session_id: 's1', tool_use_id: 't', tool: 'Bash' };
    const { runner, calls } = planned([
      { yield: [tool as AgentMessage], throw: RATE_LIMITED },
      { yield: [SUCCESS] },
    ]);
    const p = exec({ runtime: 'claude', attachments: [png] }, runner);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await p).code).toBe(0);
    expect(Array.isArray(calls[0].content)).toBe(true);
    expect(calls[1]).toEqual({ resume: 's1', content: RESUME_PROMPT });
  });
});

describe('capability', () => {
  it('advertises agent-exec-attachments', () => {
    expect(AGENT_PROTOCOL_CAPABILITIES).toContain('agent-exec-attachments');
  });
});
