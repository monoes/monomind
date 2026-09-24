// packages/@monomind/cli/__tests__/orgrt/tool-round-cap.test.ts
/**
 * #326 — the fence runners' tool-call round cap is configurable
 * (`run_config.max_tool_rounds`, a role's own `max_tool_rounds`, default 10),
 * and a role that hits it is told so in its own tool results, with one
 * wrap-up round to report and ask to be continued, instead of its calls
 * vanishing with only a bus notice.
 */
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { validateAction } from '../../src/commands/org-observe.js';
import type { AgentMessage, AgentRunArgs, AgentRunner, OrgToolDef } from '../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { HermesAgentRunner } from '../../src/orgrt/hermes-runner.js';
import { type PiRpcProcess, PiRpcAgentRunner } from '../../src/orgrt/pi-rpc-runner.js';
import { MAX_TOOL_ROUNDS, roundCapResult, runToolRound } from '../../src/orgrt/tool-fence.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';
import type { CommandContext } from '../../src/types.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const mkTmp = (prefix: string): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};

function echoTool(calls: string[]): OrgToolDef {
  return {
    name: 'org_echo',
    description: 'echo text back',
    schema: { text: z.string() },
    handler: async (a) => {
      calls.push(String(a.text));
      return { text: `echo:${a.text}` };
    },
  };
}

const CALL = { name: 'org_echo', arguments: { text: 'x' } };

describe('runToolRound', () => {
  it('defaults to 10 rounds: runs rounds 0-9, answers round 10 with the cap notice, runs the wrap-up round, then drops', async () => {
    expect(MAX_TOOL_ROUNDS).toBe(10);
    const ran: string[] = [];
    const args = { tools: [echoTool(ran)] };
    for (let round = 0; round < 10; round++) {
      expect(await runToolRound(args, [CALL], round)).toEqual({ results: ['echo:x'] });
    }
    const atCap = await runToolRound(args, [CALL, CALL], 10);
    expect(atCap.results).toEqual([roundCapResult(10), roundCapResult(10)]);
    expect(atCap.note).toContain('tool-call round cap (10) reached — 2 pending tool call(s) returned unrun');
    expect(ran).toHaveLength(10); // the capped calls did not run

    expect(await runToolRound(args, [CALL], 11)).toEqual({ results: ['echo:x'] }); // wrap-up round
    const dropped = await runToolRound(args, [CALL], 12);
    expect(dropped.results).toBeUndefined();
    expect(dropped.note).toContain('dropping 1 tool call(s)');
    expect(ran).toHaveLength(11);
  });

  it('honours args.maxToolRounds', async () => {
    const ran: string[] = [];
    const args = { tools: [echoTool(ran)], maxToolRounds: 3 };
    expect((await runToolRound(args, [CALL], 2)).results).toEqual(['echo:x']);
    expect((await runToolRound(args, [CALL], 3)).results).toEqual([roundCapResult(3)]);
    expect((await runToolRound(args, [CALL], 4)).results).toEqual(['echo:x']);
    expect((await runToolRound(args, [CALL], 5)).results).toBeUndefined();
  });

  it('the cap notice tells the role why the call did not run and how to continue', () => {
    const text = roundCapResult(7);
    expect(text).toMatch(/^ERROR: not run/);
    expect(text).toContain('round cap (7 rounds)');
    expect(text).toContain('ask to be continued');
    expect(text).toContain('Re-issue the unfinished calls');
  });
});

// ── A real loop runner: hermes, driven by a fake binary ──────────────────

// Always answers with a tool call, and records every prompt it was sent.
const FAKE_HERMES = `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
const prompt = fs.readFileSync(argv[argv.indexOf('--query-file') + 1], 'utf8');
fs.appendFileSync(process.env.FAKE_HERMES_LOG, JSON.stringify(prompt) + '\\n');
console.log('\`\`\`tool_call\\n{"name":"org_echo","arguments":{"text":"x"}}\\n\`\`\`');
`;

async function runHermes(maxToolRounds?: number) {
  const tmpDir = mkTmp('round-cap-hermes-');
  const bin = path.join(tmpDir, 'fake-hermes.cjs');
  fs.writeFileSync(bin, FAKE_HERMES);
  fs.chmodSync(bin, 0o755);
  const logFile = path.join(tmpDir, 'prompts.log');
  const ran: string[] = [];
  const args: AgentRunArgs = {
    tools: [echoTool(ran)],
    prompt: (async function* () {
      yield 'do work';
    })(),
    systemPrompt: 'test role',
    cwd: tmpDir,
    env: { FAKE_HERMES_LOG: logFile },
    maxTurns: 5,
    ...(maxToolRounds !== undefined ? { maxToolRounds } : {}),
  };
  const messages: AgentMessage[] = [];
  for await (const m of new HermesAgentRunner(bin).run(args)) messages.push(m);
  const prompts = fs
    .readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as string);
  const notes = messages.filter((m) => m.type === 'assistant' && m.text?.includes('round cap')).map((m) => m.text);
  return { ran, prompts, notes };
}

describe('fence runner (hermes) round cap', () => {
  it('maxToolRounds 2: two rounds run, the role sees the cap notice, its wrap-up round runs, the rest is dropped', async () => {
    const { ran, prompts, notes } = await runHermes(2);
    expect(ran).toHaveLength(3); // 2 rounds + the wrap-up round
    expect(prompts).toHaveLength(5);
    expect(prompts[2]).not.toContain('round cap');
    // the fourth model turn sees its third round's call answered with the cap notice
    expect(prompts[3]).toContain(JSON.stringify(roundCapResult(2)).slice(1, -1));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('returned unrun');
    expect(notes[1]).toContain('dropping 1 tool call(s)');
  }, 30_000);

  it('unset: the default cap of 10 applies', async () => {
    const { ran, prompts } = await runHermes();
    expect(ran).toHaveLength(11);
    expect(prompts[10]).not.toContain('round cap (10 rounds)');
    expect(prompts[11]).toContain('round cap (10 rounds)');
  }, 60_000);
});

// ── An RPC runner: pi-rpc, whose round counter advances after each round ──

function fakePi(): PiRpcProcess & { written: string[]; emitStdout: (l: string) => void; emitClose: (c: number) => void } {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const written: string[] = [];
  return {
    stdin: { write: (d: string) => void written.push(d), on: () => {} },
    stdout: { on: (e, cb) => void stdout.on(e, cb) },
    stderr: { on: () => {} },
    on: (e: string, cb: (...a: unknown[]) => void) => void emitter.on(e, cb),
    kill: vi.fn(),
    written,
    emitStdout: (l: string) => stdout.emit('data', Buffer.from(l)),
    emitClose: (c: number) => emitter.emit('close', c),
  } as never;
}

describe('rpc runner (pi-rpc) round cap', () => {
  it('maxToolRounds 1: one round runs, the next gets the cap notice, the wrap-up runs, then calls drop', async () => {
    const proc = fakePi();
    const ran: string[] = [];
    const runner = new PiRpcAgentRunner('pi', () => proc);
    const messages: AgentMessage[] = [];
    const done = (async () => {
      for await (const m of runner.run({
        tools: [echoTool(ran)],
        prompt: (async function* () {
          yield 'hello';
        })(),
        systemPrompt: 'sys',
        cwd: '/tmp/x',
        env: {},
        maxTurns: 10,
        maxToolRounds: 1,
      }))
        messages.push(m);
    })();
    const fence = '```tool_call\n{"name":"org_echo","arguments":{"text":"x"}}\n```';
    const turn = JSON.stringify({
      type: 'agent_end',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: fence }], usage: { input: 1, output: 1 } }],
    });
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 10));
      proc.emitStdout(`${turn}\n`);
    }
    await new Promise((r) => setTimeout(r, 10));
    proc.emitClose(0);
    await done;

    expect(ran).toHaveLength(2); // round 0 + the wrap-up round
    const prompts = proc.written.filter((w) => w.includes('"type":"prompt"'));
    expect(prompts).toHaveLength(4);
    expect(prompts[2]).toContain('round cap (1 rounds)');
    expect(prompts[3]).not.toContain('round cap');
    const notes = messages.filter((m) => m.type === 'assistant' && m.text?.includes('round cap')).map((m) => m.text);
    expect(notes[0]).toContain('returned unrun');
    expect(notes[1]).toContain('dropping 1 tool call(s)');
  });
});

// ── Config: schema, org validate, and what a role session is given ───────

const baseDef = (extra: { run_config?: Record<string, unknown>; lead?: Record<string, unknown> } = {}) => ({
  name: 'caps',
  goal: 'g',
  run_config: extra.run_config ?? {},
  roles: [
    { id: 'lead', title: 'Lead', type: 'boss', reports_to: null, ...(extra.lead ?? {}) },
    { id: 'dev', title: 'Dev', reports_to: 'lead' },
  ],
});

describe('max_tool_rounds config', () => {
  it('accepts a positive integer up to 200 at org and role level, unset by default', () => {
    const def = OrgDefSchema.parse(baseDef({ run_config: { max_tool_rounds: 25 }, lead: { max_tool_rounds: 200 } }));
    expect(def.run_config.max_tool_rounds).toBe(25);
    expect(def.roles[0].max_tool_rounds).toBe(200);
    const plain = OrgDefSchema.parse(baseDef());
    expect(plain.run_config.max_tool_rounds).toBeUndefined();
    expect(plain.roles[0].max_tool_rounds).toBeUndefined();
  });

  it.each([0, -1, 1.5, 201, '10'])('rejects %p', (bad) => {
    expect(OrgDefSchema.safeParse(baseDef({ run_config: { max_tool_rounds: bad } })).success).toBe(false);
    expect(OrgDefSchema.safeParse(baseDef({ lead: { max_tool_rounds: bad } })).success).toBe(false);
  });

  it('org validate fails an out-of-range value', async () => {
    const root = mkTmp('round-cap-validate-');
    fs.mkdirSync(path.join(root, '.monomind/orgs'), { recursive: true });
    const file = path.join(root, '.monomind/orgs/caps.json');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const ctx = { args: ['caps'], flags: { _: [] }, cwd: root, interactive: false } as CommandContext;
      fs.writeFileSync(file, JSON.stringify(baseDef({ run_config: { max_tool_rounds: 500 } })));
      expect((await validateAction(ctx)).success).toBe(false);
      fs.writeFileSync(file, JSON.stringify(baseDef({ run_config: { max_tool_rounds: 50 } })));
      expect((await validateAction(ctx)).success).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  /** Records the maxToolRounds each role's session was started with. */
  class CaptureRunner implements AgentRunner {
    seen = new Map<string, number | undefined>();
    async *run(args: AgentRunArgs): AsyncIterable<AgentMessage> {
      this.seen.set(args.env.MONOMIND_ROLE_ID, args.maxToolRounds);
      for await (const _ of args.prompt) {
        yield { type: 'result', subtype: 'success', input_tokens: 1, output_tokens: 1, session_id: 's' };
      }
    }
  }

  async function sessionCaps(def: ReturnType<typeof baseDef>): Promise<Map<string, number | undefined>> {
    const root = mkTmp('round-cap-org-');
    fs.mkdirSync(path.join(root, '.monomind/orgs'), { recursive: true });
    fs.writeFileSync(path.join(root, '.monomind/orgs/caps.json'), JSON.stringify(def));
    const runner = new CaptureRunner();
    const daemon = new OrgDaemon(root, { runner, forward: false });
    try {
      await daemon.startOrg('caps');
      for (const role of ['lead', 'dev']) await daemon.deliver('caps', 'human', role, 'go', 'go');
      const start = Date.now();
      while (runner.seen.size < 2) {
        if (Date.now() - start > 10_000) throw new Error('sessions did not start');
        await new Promise((r) => setTimeout(r, 25));
      }
      return runner.seen;
    } finally {
      await daemon.stopAll();
    }
  }

  it('a session gets the role override, else run_config, else nothing (the runner default)', async () => {
    const both = await sessionCaps(baseDef({ run_config: { max_tool_rounds: 25 }, lead: { max_tool_rounds: 40 } }));
    expect(both.get('lead')).toBe(40);
    expect(both.get('dev')).toBe(25);
    const none = await sessionCaps(baseDef());
    expect(none.get('lead')).toBeUndefined();
    expect(none.get('dev')).toBeUndefined();
  }, 30_000);
});
