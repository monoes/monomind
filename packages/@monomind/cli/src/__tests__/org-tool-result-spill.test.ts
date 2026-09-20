/**
 * ADR-O001 D2 — bound what enters an org role's transcript, tool results first.
 *
 * Measured on one real `monomind-dev` run: tool results are 76% of all context
 * mass (Bash 4,387 calls / 5.7M chars + Read 420 / 2.0M = 97% of tool mass),
 * inter-agent mail 0.1%. Each role holds ONE persistent SDK session for its
 * whole life with no truncation anywhere in orgrt/, so every tool result is
 * re-sent on every later turn — cost roughly quadratic in turns.
 *
 * The fix mirrors cross-org.ts's mailBody() spill-and-reference, aimed at the
 * channel that actually carries the mass: an oversized tool result is written
 * to disk IN FULL first, then replaced in the model's transcript by a bounded
 * head+tail digest plus the exact path.
 *
 * These tests assert BOTH halves of the contract, because either alone is a
 * bug: the result is bounded in context AND the full body is recoverable from
 * the referenced path.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentRunner } from '../orgrt/agent-runner.js';
import { ClaudeAgentRunner } from '../orgrt/agent-runner.js';
import { OrgBus } from '../orgrt/bus.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { runAgentSession, type SessionOpts } from '../orgrt/session.js';
import {
  spillToolResult,
  TOOL_DIGEST_CHARS,
  TOOL_RESULT_MAX,
  toolResultSpillHook,
} from '../orgrt/tool-spill.js';
import type { OrgRole } from '../orgrt/types.js';

/** Total length of every string leaf — what the transcript actually pays for. */
function stringMass(v: unknown): number {
  if (typeof v === 'string') return v.length;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + stringMass(x), 0);
  if (v && typeof v === 'object')
    return Object.values(v as Record<string, unknown>).reduce(
      (n: number, x) => n + stringMass(x),
      0,
    );
  return 0;
}

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'org-tool-spill-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('spillToolResult — bounded in context, recoverable from disk', () => {
  it('bounds a huge Bash result AND writes the full body to the referenced path', () => {
    withTmp((dir) => {
      // 60k — the measured maximum single result.
      const stdout = Array.from({ length: 2000 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join(
        '\n',
      );
      const spilled = spillToolResult(dir, 'Bash', 'toolu_abc123', { stdout, stderr: '' });
      expect(spilled).toBeDefined();

      // (1) bounded in context
      expect(stringMass(spilled!.output)).toBeLessThan(stdout.length / 10);
      expect(stringMass(spilled!.output)).toBeLessThanOrEqual(TOOL_DIGEST_CHARS + 512);

      // (2) the reference resolves and the full body is byte-identical
      expect(JSON.stringify(spilled!.output)).toContain(spilled!.file);
      expect(readFileSync(spilled!.file, 'utf8')).toBe(stdout);
    });
  });

  it('leaves a result at or under the threshold byte-identical and writes nothing', () => {
    withTmp((dir) => {
      const response = { stdout: 'y'.repeat(TOOL_RESULT_MAX), stderr: '' };
      expect(spillToolResult(dir, 'Bash', 'toolu_small', response)).toBeUndefined();
    });
  });

  it('keeps the TAIL for a Bash result (errors and exit status live at the end)', () => {
    withTmp((dir) => {
      const stdout = `${'noise\n'.repeat(3000)}FAIL: 3 tests failed\nexit status 1`;
      const spilled = spillToolResult(dir, 'Bash', 'toolu_tail', { stdout, stderr: '' });
      const text = JSON.stringify(spilled!.output);
      expect(text).toContain('FAIL: 3 tests failed');
      expect(text).toContain('exit status 1');
    });
  });

  it('keeps the HEAD for a Read result (the top of a file is what matters)', () => {
    withTmp((dir) => {
      const content = `IMPORTANT HEADER LINE\n${'body\n'.repeat(4000)}`;
      const spilled = spillToolResult(dir, 'Read', 'toolu_head', {
        type: 'text',
        file: { filePath: '/x/y.ts', content, numLines: 4001 },
      });
      const out = spilled!.output as { type: string; file: { filePath: string; content: string } };
      expect(out.type).toBe('text'); // shape preserved — only the bulk leaf is digested
      expect(out.file.filePath).toBe('/x/y.ts');
      expect(out.file.content.startsWith('IMPORTANT HEADER LINE')).toBe(true);
      expect(readFileSync(spilled!.file, 'utf8')).toContain(content);
    });
  });

  it('handles a plain-string tool response and never loses data', () => {
    withTmp((dir) => {
      const body = 'z'.repeat(50_000);
      const spilled = spillToolResult(dir, 'mcp__org__whatever', 'toolu_str', body);
      expect(typeof spilled!.output).toBe('string');
      expect((spilled!.output as string).length).toBeLessThan(body.length / 10);
      expect(readFileSync(spilled!.file, 'utf8')).toBe(body);
    });
  });

  it('delivers in full rather than losing content when the spill write fails', () => {
    // A path whose parent is a FILE, so mkdir cannot succeed — mailBody's own
    // catch-and-deliver-in-full contract, applied here.
    withTmp((dir) => {
      const blocked = join(dir, 'not-a-dir.txt', 'nested');
      writeFileSync(join(dir, 'not-a-dir.txt'), 'x');
      expect(spillToolResult(blocked, 'Bash', 'toolu_fail', { stdout: 'q'.repeat(50_000) })).toBe(
        undefined,
      );
    });
  });
});

describe('toolResultSpillHook — the PostToolUse contract', () => {
  it('returns updatedToolOutput for an oversized result and {} for a small one', async () => {
    await withTmp(async (dir) => {
      const hook = toolResultSpillHook(dir);
      const big = await hook({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' },
        tool_response: { stdout: 'b'.repeat(40_000), stderr: '' },
        tool_use_id: 'toolu_hook_big',
      });
      const updated = (big as any).hookSpecificOutput?.updatedToolOutput;
      expect(updated).toBeDefined();
      expect(stringMass(updated)).toBeLessThan(40_000 / 10);

      const small = await hook({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
        tool_response: { stdout: 'hi', stderr: '' },
        tool_use_id: 'toolu_hook_small',
      });
      expect((small as any).hookSpecificOutput).toBeUndefined();
    });
  });
});

describe('wiring — the hook reaches the SDK and session.ts supplies the directory', () => {
  it('ClaudeAgentRunner installs a PostToolUse hook only when toolSpillDir is set', async () => {
    const captured: any[] = [];
    const mockQueryFn = (a: any) => {
      captured.push(a.options);
      return (async function* () {
        yield { type: 'result', subtype: 'success', usage: {}, session_id: 's' };
      })();
    };
    const base = {
      tools: [],
      prompt: (async function* () {
        yield { type: 'user', message: { role: 'user', content: 'hi' } };
      })(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 1,
    };
    const runner = new ClaudeAgentRunner(mockQueryFn as any);
    for await (const _ of runner.run({ ...base, toolSpillDir: '/tmp/spill' } as any));
    expect(captured[0].hooks?.PostToolUse?.[0]?.hooks?.length).toBe(1);

    const runner2 = new ClaudeAgentRunner(mockQueryFn as any);
    for await (const _ of runner2.run({
      ...base,
      prompt: (async function* () {
        yield { type: 'user', message: { role: 'user', content: 'hi' } };
      })(),
    } as any));
    expect(captured[1].hooks).toBeUndefined();
  });

  it('runAgentSession passes a toolSpillDir under the org state dir', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'org-spill-session-'));
    try {
      const bus = new OrgBus('alpha', 'run-1', join(tmp, 'run'));
      const mailbox = new Mailbox();
      const policy = new PolicyEngine('coder', {} as any, bus, tmp);
      let seen: string | undefined;
      // The fake runner never drives the mailbox stream, so close it as the
      // turn starts or runAgentSession's outer loop restarts forever.
      const fakeRunner: AgentRunner = {
        async *run(args): AsyncIterable<AgentMessage> {
          seen = (args as { toolSpillDir?: string }).toolSpillDir;
          mailbox.close();
          yield { type: 'result', subtype: 'success', input_tokens: 1, output_tokens: 1 };
        },
      };
      const opts: SessionOpts = {
        org: 'alpha',
        role: { id: 'coder', title: 'Coder', type: 'specialist' } as unknown as OrgRole,
        bus,
        policy,
        mailbox,
        cwd: tmp,
        orgDir: join(tmp, 'orgstate'),
        deliver: async () => 'ok',
        runner: fakeRunner,
        maxTurns: 1,
      };
      await runAgentSession(opts);
      expect(seen).toBe(join(tmp, 'orgstate', 'tool-results', 'coder'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
