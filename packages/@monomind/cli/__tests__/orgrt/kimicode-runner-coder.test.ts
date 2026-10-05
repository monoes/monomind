/**
 * Coder mode on kimicode: full access drops the org-role agent file (and its
 * `tools:` allowlist) and the empty --skills-dir so the user's own kimi agent
 * and skills load; `--settings` alone keeps the user's skills. kimi's tool
 * calls and results (kimi-code 2.x PromptJsonWriter shapes) become matched
 * tool_use/tool_result pairs. Driven through a fake `kimi` script — no real
 * CLI call.
 */
import * as fs from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentRunArgs } from '../../src/orgrt/agent-runner.js';
import { KimiCodeAgentRunner } from '../../src/orgrt/kimicode-runner.js';
import {
  callerFence,
  expectAllCallsBeforeResults,
  expectCallerRoundTrip,
  rosterResult,
  runFullAccessToolTurn,
} from '../../src/__tests__/caller-tool-turn.js';

// Storage policy is covered by runner-inputs-599.test.ts; these runner unit
// fixtures deliberately use the test worker's isolated temporary HOME.
vi.mock('../../src/orgrt/runner-inputs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orgrt/runner-inputs.js')>();
  const { mkdtempSync } = await import('../../src/__tests__/tmp-track.js');
  const os = await import('node:os');
  const path = await import('node:path');
  return { ...actual, createRunnerInputDir: (runner: string) => mkdtempSync(path.join(os.tmpdir(), `runner-fixture-${runner}-`)) };
});

const SCRIPT = `#!/usr/bin/env node
const fs = require('fs');
const prompt = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.FAKE_KIMI_LOG, JSON.stringify({ argv: process.argv.slice(2), prompt }) + '\\n');
const out = (o) => console.log(JSON.stringify(o));
out({ role: 'assistant', content: 'Listing.', tool_calls: [
  { type: 'function', id: 'tc_1', function: { name: 'Bash', arguments: '{"command":"ls"}' } },
] });
out({ role: 'tool', tool_call_id: 'tc_1', content: 'a.txt' });
out({ role: 'assistant', tool_calls: [
  { type: 'function', id: 'tc_2', function: { name: 'Edit', arguments: '{"path":"a.txt","old_string":"a","new_string":"b"}' } },
] });
out({ role: 'tool', tool_call_id: 'tc_2', content: 'ok' });
out({ role: 'assistant', content: 'done' });
out({ role: 'meta', type: 'session.resume_hint', session_id: 'session_c1' });
`;

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'monomind-kimi-coder-'));
  const bin = path.join(dir, 'kimi.cjs');
  fs.writeFileSync(bin, SCRIPT);
  fs.chmodSync(bin, 0o755);
  return { dir, bin, log: path.join(dir, 'argv.log') };
}

async function run(extra: Partial<AgentRunArgs>) {
  const { dir, bin, log } = setup();
  const messages: AgentMessage[] = [];
  const args: AgentRunArgs = {
    tools: [],
    prompt: (async function* () {
      yield 'do work';
    })(),
    systemPrompt: 'CODER SYSTEM PROMPT',
    cwd: dir,
    env: { KIMI_CODE_HOME: path.join(dir, 'home'), FAKE_KIMI_LOG: log },
    maxTurns: 5,
    ...extra,
  };
  for await (const m of new KimiCodeAgentRunner(bin).run(args)) messages.push(m);
  const calls = fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { argv: string[]; prompt: string });
  return { messages, calls };
}

describe('KimiCodeAgentRunner coder mode', () => {
  it('full access: no agent file, no empty skills dir, system prompt carried on the first prompt', async () => {
    const { calls } = await run({ access: 'full' });
    expect(calls[0].argv).not.toContain('--agent-file');
    expect(calls[0].argv).not.toContain('--skills-dir');
    expect(calls[0].prompt.startsWith('CODER SYSTEM PROMPT')).toBe(true);
    expect(calls[0].prompt.endsWith('do work')).toBe(true);
  });

  it('--settings alone keeps the org agent file but loads the user’s skills', async () => {
    const { calls } = await run({ settingSources: ['user', 'project'] });
    expect(calls[0].argv).toContain('--agent-file');
    expect(calls[0].argv).not.toContain('--skills-dir');
    expect(calls[0].prompt).toBe('do work');
  });

  it('default (org role): agent file + empty skills dir, unchanged', async () => {
    const { calls } = await run({});
    expect(calls[0].argv).toContain('--agent-file');
    expect(calls[0].argv).toContain('--skills-dir');
  });

  it('pairs kimi tool_calls with their role:"tool" results by call id, canonical inputs', async () => {
    const { messages } = await run({ access: 'full' });
    const starts = messages.filter((m) => m.type === 'tool_use' && m.tool_use_id);
    const ends = messages.filter((m) => m.type === 'tool_result');
    expect(starts.map((m) => [m.tool_use_id, m.tool, (m as { kind?: string }).kind])).toEqual([
      ['tc_1', 'Bash', 'shell'],
      ['tc_2', 'Edit', 'edit'],
    ]);
    expect(starts[0].input).toEqual({ command: 'ls' });
    expect(starts[1].input).toEqual({ file_path: 'a.txt', old_string: 'a', new_string: 'b' });
    expect(ends.map((m) => [m.tool_use_id, m.text])).toEqual([
      ['tc_1', 'a.txt'],
      ['tc_2', 'ok'],
    ]);
    const texts = messages.filter((m) => m.type === 'assistant').map((m) => m.text);
    expect(texts).toEqual(['Listing.', 'done']);
  });
});

/** A fake `kimi` whose first invocation replies `first`, every later one `done`. */
function callerKimi(first: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'monomind-kimi-389-'));
  const bin = path.join(dir, 'kimi.cjs');
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs');
const log = ${JSON.stringify(log)};
const prompt = fs.readFileSync(0, 'utf8');
const n = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0;
fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2), prompt }) + '\\n');
console.log(JSON.stringify({ role: 'assistant', content: n === 0 ? ${JSON.stringify(first)} : 'done' }));
console.log(JSON.stringify({ role: 'meta', type: 'session.resume_hint', session_id: 'session_389' }));
`,
  );
  fs.chmodSync(bin, 0o755);
  const calls = () =>
    fs
      .readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { argv: string[]; prompt: string });
  return { runner: new KimiCodeAgentRunner(bin), calls };
}

describe('#389 kimicode: full access + stdio caller tools', () => {
  it('a full-access turn calls a stdio tool and gets the result back', async () => {
    const kimi = callerKimi(`Checking.\n${callerFence('core')}`);
    const turn = await runFullAccessToolTurn('kimicode', kimi.runner);
    expectCallerRoundTrip(turn, ['core']);
    const calls = kimi.calls();
    expect(calls).toHaveLength(2);
    // Full access: the user's own kimi agent, not the org-role agent file.
    expect(calls[0].argv).not.toContain('--agent-file');
    // Tool protocol in the first prompt, the caller's answer in the resumed one.
    expect(calls[0].prompt).toContain('org_roster');
    expect(calls[1].prompt).toContain(rosterResult('core'));
    expect(calls[1].argv[calls[1].argv.indexOf('--session') + 1]).toBe('session_389');
  });

  it('two parallel caller calls: both tool_call frames before either tool_result', async () => {
    const kimi = callerKimi(`${callerFence('core')}\n${callerFence('qa')}`);
    const turn = await runFullAccessToolTurn('kimicode', kimi.runner, { expectCalls: 2 });
    expectCallerRoundTrip(turn, ['core', 'qa']);
    expectAllCallsBeforeResults(turn, 2);
    const second = kimi.calls()[1].prompt;
    expect(second).toContain(rosterResult('core'));
    expect(second).toContain(rosterResult('qa'));
  });
});
