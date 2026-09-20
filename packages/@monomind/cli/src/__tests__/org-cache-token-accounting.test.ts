/**
 * ADR-O001 D1 regression: the org runtime's token meter counted only
 * `input_tokens + output_tokens`.
 *
 * `cache_read_input_tokens` and `cache_creation_input_tokens` are SIBLINGS of
 * `input_tokens` in the Anthropic API (verified against
 * `@anthropic-ai/sdk`'s `BetaUsage`: all three are independent fields, and
 * `input_tokens` is the uncached remainder only). Both cache fields are
 * billable (~0.1x and ~1.25x the input rate). On one measured monomind-dev
 * run, 2,765M tokens were billed and 8.1M were recorded — the meter missed
 * 99.7%, and `input_tokens` was 0.0M precisely because caching worked.
 *
 * Also: the SDK's result-level `usage` is documented "MAIN AGENT LOOP ONLY —
 * excludes Task subagent, sidechain, and auxiliary model calls... Prefer
 * `modelUsage`". `modelUsage` is `Record<string, ModelUsage>` with camelCase
 * fields (`inputTokens`, `outputTokens`, `cacheReadInputTokens`,
 * `cacheCreationInputTokens`) and — unlike `usage` — is CUMULATIVE across
 * turns in a streaming-input session, exactly like `total_cost_usd`.
 *
 * Every assertion below fails on the pre-ADR code.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AgentMessage, type AgentRunner, ClaudeAgentRunner } from '../orgrt/agent-runner.js';
import { OrgBus } from '../orgrt/bus.js';
import { mergeCheckpoint, type OrgCheckpoint } from '../orgrt/checkpoint.js';
import { Mailbox } from '../orgrt/mailbox.js';
import { PolicyEngine } from '../orgrt/policy.js';
import { runAgentSession, type SessionOpts } from '../orgrt/session.js';
import { OrgDefSchema, type OrgRole } from '../orgrt/types.js';

const ROLE = {
  id: 'coder',
  title: 'Coder',
  type: 'specialist',
  reports_to: 'boss',
} as unknown as OrgRole;

/** Run one session against a scripted runner, returning the emitted events. */
async function runScripted(
  policy: PolicyEngine,
  bus: OrgBus,
  mailbox: Mailbox,
  cwd: string,
  messages: AgentMessage[],
): Promise<void> {
  const fakeRunner: AgentRunner = {
    async *run(): AsyncIterable<AgentMessage> {
      // Close immediately so runAgentSession's outer loop terminates after
      // this single pass instead of restarting forever.
      mailbox.close();
      for (const m of messages) yield m;
    },
  };
  const opts: SessionOpts = {
    org: 'alpha',
    role: ROLE,
    bus,
    policy,
    mailbox,
    cwd,
    deliver: async () => 'ok',
    runner: fakeRunner,
    maxTurns: 5,
  };
  await runAgentSession(opts);
}

function harness(): { bus: OrgBus; mailbox: Mailbox; emitted: any[]; tmp: string } {
  const tmp = mkdtempSync(join(tmpdir(), 'org-cache-tokens-'));
  const bus = new OrgBus('alpha', 'run-1', join(tmp, 'run'));
  const emitted: any[] = [];
  bus.subscribe((e) => emitted.push(e));
  return { bus, mailbox: new Mailbox(), emitted, tmp };
}

describe('PolicyEngine — billable token accounting (ADR-O001 D1)', () => {
  const bus = { emit: () => {} } as unknown as OrgBus;

  it('counts cache_read and cache_creation tokens in usage, not just input+output', () => {
    const policy = new PolicyEngine('dev', {} as any, bus, '/tmp');
    policy.addTokenUsage({ input: 5, output: 3, cacheRead: 1000, cacheCreation: 200 });
    expect(policy.usage).toBe(1208);
    expect(policy.tokenUsage).toEqual({
      input: 5,
      output: 3,
      cacheRead: 1000,
      cacheCreation: 200,
    });
  });

  it('keeps the four quantities separate across many additions', () => {
    const policy = new PolicyEngine('dev', {} as any, bus, '/tmp');
    policy.addTokenUsage({ input: 1, cacheRead: 10 });
    policy.addTokenUsage({ output: 2, cacheCreation: 20 });
    expect(policy.tokenUsage).toEqual({ input: 1, output: 2, cacheRead: 10, cacheCreation: 20 });
    expect(policy.usage).toBe(33);
  });

  it('setTokenUsage restores a persisted breakdown exactly', () => {
    const policy = new PolicyEngine('dev', {} as any, bus, '/tmp');
    policy.setTokenUsage({ input: 7, output: 8, cacheRead: 900, cacheCreation: 100 });
    expect(policy.usage).toBe(1015);
    expect(policy.budgetedUsage).toBe(15);
  });
});

describe('Budget semantics — the new cache-aware volume must not brick existing budgets', () => {
  const bus = { emit: () => {} } as unknown as OrgBus;

  it('budget_tokens keeps its historical (uncached) basis by default', async () => {
    const policy = new PolicyEngine('dev', { maxTokens: 100 } as any, bus, '/tmp');
    // A near-perfect cache: ~1M billable tokens, almost none of it uncached.
    policy.addTokenUsage({ input: 3, output: 2, cacheRead: 1_000_000, cacheCreation: 5_000 });
    expect(policy.usage).toBe(1_005_005); // honest, billable meter
    expect(policy.budgetedUsage).toBe(5); // what budget_tokens was written against
    expect(policy.overBudget).toBe(false);
    const decision = await policy.decide('Read', { file_path: 'x' });
    expect(decision.behavior).toBe('allow');
  });

  it('budget_tokens still binds once the uncached basis reaches the ceiling', () => {
    const policy = new PolicyEngine('dev', { maxTokens: 100 } as any, bus, '/tmp');
    policy.addTokenUsage({ input: 60, output: 40 });
    expect(policy.overBudget).toBe(true);
  });

  it('maxTokensBasis "billable" opts a budget in to the cache-aware basis', () => {
    const policy = new PolicyEngine(
      'dev',
      { maxTokens: 100, maxTokensBasis: 'billable' } as any,
      bus,
      '/tmp',
    );
    policy.addTokenUsage({ cacheRead: 1000 });
    expect(policy.overBudget).toBe(true);
  });

  it('run_config exposes budget_tokens_basis, defaulting to the compatible basis', () => {
    expect(
      OrgDefSchema.parse({ name: 'alpha', roles: [{ id: 'boss' }] }).run_config.budget_tokens_basis,
    ).toBe('uncached');
    expect(
      OrgDefSchema.parse({
        name: 'alpha',
        roles: [{ id: 'boss' }],
        run_config: { budget_tokens_basis: 'billable' },
      }).run_config.budget_tokens_basis,
    ).toBe('billable');
  });

  it('legacy addUsage(n) still counts against the budget basis (old checkpoints)', () => {
    const policy = new PolicyEngine('dev', { maxTokens: 100 } as any, bus, '/tmp');
    policy.addUsage(100);
    expect(policy.overBudget).toBe(true);
    expect(policy.usage).toBe(100);
  });
});

describe('session.ts — per-turn accounting includes both cache fields', () => {
  it("counts cache tokens on an 'assistant' turn", async () => {
    const { bus, mailbox, emitted, tmp } = harness();
    try {
      const policy = new PolicyEngine('coder', {} as any, bus, tmp);
      await runScripted(policy, bus, mailbox, tmp, [
        {
          type: 'assistant',
          session_id: 's1',
          text: 'hi',
          input_tokens: 5,
          output_tokens: 3,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 200,
        },
        {
          type: 'result',
          session_id: 's1',
          subtype: 'success',
          input_tokens: 5,
          output_tokens: 3,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 200,
          cost_usd: 0.01,
        },
      ]);
      // 5 + 3 + 1000 + 200, counted exactly once (the result tops up only a
      // shortfall, it never re-adds what the assistant turn already counted).
      expect(policy.usage).toBe(1208);
      const usageEvent = emitted.find((e) => e.type === 'usage');
      expect(usageEvent.data.tokens).toBe(1208);
      expect(usageEvent.data.tokens_in).toBe(5);
      expect(usageEvent.data.tokens_out).toBe(3);
      expect(usageEvent.data.cache_read).toBe(1000);
      expect(usageEvent.data.cache_creation).toBe(200);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("counts cache tokens on a 'result' that no assistant turn preceded", async () => {
    const { bus, mailbox, tmp } = harness();
    try {
      const policy = new PolicyEngine('coder', {} as any, bus, tmp);
      await runScripted(policy, bus, mailbox, tmp, [
        {
          type: 'result',
          session_id: 's1',
          subtype: 'success',
          input_tokens: 5,
          output_tokens: 3,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 200,
        },
      ]);
      expect(policy.usage).toBe(1208);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('treats result-level cumulative_tokens (modelUsage) as a cumulative total, not a delta', async () => {
    const { bus, mailbox, tmp } = harness();
    try {
      const policy = new PolicyEngine('coder', {} as any, bus, tmp);
      await runScripted(policy, bus, mailbox, tmp, [
        {
          type: 'result',
          session_id: 's1',
          subtype: 'success',
          cumulative_tokens: { input: 10, output: 5, cache_read: 1000, cache_creation: 0 },
        },
        {
          type: 'result',
          session_id: 's1',
          subtype: 'success',
          cumulative_tokens: { input: 20, output: 10, cache_read: 2500, cache_creation: 0 },
        },
      ]);
      // Latest cumulative total, NOT the sum of the two results.
      expect(policy.usage).toBe(2530);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('a budget on the billable basis closes the mailbox once cache reads exhaust it', async () => {
    const { bus, mailbox, emitted, tmp } = harness();
    try {
      const policy = new PolicyEngine(
        'coder',
        { maxTokens: 500, maxTokensBasis: 'billable' } as any,
        bus,
        tmp,
      );
      await runScripted(policy, bus, mailbox, tmp, [
        {
          type: 'assistant',
          session_id: 's1',
          text: 'hi',
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 5000,
        },
      ]);
      expect(policy.overBudget).toBe(true);
      expect(emitted.some((e) => e.type === 'status' && e.reason === 'budget-exhausted')).toBe(
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('ClaudeAgentRunner — surfaces cache usage and prefers modelUsage', () => {
  it("carries the cache fields off an 'assistant' message's BetaMessage.usage", async () => {
    const mockQueryFn = () =>
      (async function* () {
        yield {
          type: 'assistant',
          session_id: 's1',
          message: {
            content: [{ type: 'text', text: 'hi' }],
            usage: {
              input_tokens: 5,
              output_tokens: 3,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 200,
            },
          },
        };
      })();
    const runner = new ClaudeAgentRunner(mockQueryFn as any);
    const out: AgentMessage[] = [];
    for await (const m of runner.run({
      tools: [],
      prompt: (async function* () {})(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    } as any))
      out.push(m);
    const assistant = out.find((m) => m.type === 'assistant');
    expect(assistant?.cache_read_input_tokens).toBe(1000);
    expect(assistant?.cache_creation_input_tokens).toBe(200);
  });

  it("sums modelUsage across every model on a 'result' (subagents included)", async () => {
    const mockQueryFn = () =>
      (async function* () {
        yield {
          type: 'result',
          session_id: 's1',
          subtype: 'success',
          is_error: false,
          // MAIN AGENT LOOP ONLY — deliberately smaller than modelUsage here.
          usage: { input_tokens: 5, output_tokens: 3 },
          modelUsage: {
            'claude-opus-5': {
              inputTokens: 10,
              outputTokens: 5,
              cacheReadInputTokens: 1000,
              cacheCreationInputTokens: 200,
            },
            'claude-haiku-5': {
              inputTokens: 2,
              outputTokens: 1,
              cacheReadInputTokens: 300,
              cacheCreationInputTokens: 0,
            },
          },
          total_cost_usd: 0.02,
        };
      })();
    const runner = new ClaudeAgentRunner(mockQueryFn as any);
    const out: AgentMessage[] = [];
    for await (const m of runner.run({
      tools: [],
      prompt: (async function* () {})(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    } as any))
      out.push(m);
    const result = out.find((m) => m.type === 'result');
    expect(result?.cumulative_tokens).toEqual({
      input: 12,
      output: 6,
      cache_read: 1300,
      cache_creation: 200,
    });
  });

  it("falls back to `usage` when a 'result' carries no modelUsage", async () => {
    const mockQueryFn = () =>
      (async function* () {
        yield {
          type: 'result',
          session_id: 's1',
          subtype: 'success',
          is_error: false,
          usage: {
            input_tokens: 5,
            output_tokens: 3,
            cache_read_input_tokens: 40,
            cache_creation_input_tokens: 7,
          },
          total_cost_usd: 0.02,
        };
      })();
    const runner = new ClaudeAgentRunner(mockQueryFn as any);
    const out: AgentMessage[] = [];
    for await (const m of runner.run({
      tools: [],
      prompt: (async function* () {})(),
      systemPrompt: '',
      cwd: '/tmp',
      env: {},
      maxTurns: 5,
    } as any))
      out.push(m);
    const result = out.find((m) => m.type === 'result');
    expect(result?.cumulative_tokens).toBeUndefined();
    expect(result?.cache_read_input_tokens).toBe(40);
    expect(result?.cache_creation_input_tokens).toBe(7);
  });
});

describe('checkpoint — the breakdown round-trips and old files still resume', () => {
  const bus = { emit: () => {} } as unknown as OrgBus;

  function fakeOrg(policy: PolicyEngine) {
    return {
      agents: new Map([
        [
          'coder',
          {
            mailbox: new Mailbox(),
            policy,
            metrics: { tokens: 0, costUsd: 0 },
            status: 'running',
          },
        ],
      ]),
    } as any;
  }

  function checkpointWith(roleState: Record<string, unknown>): OrgCheckpoint {
    return {
      version: 2,
      status: 'running',
      run: 'run-1',
      pid: 1,
      updated: new Date().toISOString(),
      roleState: { coder: roleState as any },
      pendingRoles: [],
      checksum: '',
    } as OrgCheckpoint;
  }

  it('restores the four quantities when the checkpoint carries them', () => {
    const policy = new PolicyEngine('coder', {} as any, bus, '/tmp');
    mergeCheckpoint(
      fakeOrg(policy),
      checkpointWith({
        mailboxQueue: [],
        mailboxClosed: false,
        tokensUsed: 1208,
        tokenUsage: { input: 5, output: 3, cacheRead: 1000, cacheCreation: 200 },
        costUsd: 0.01,
        status: 'running',
        generation: 0,
        respawnCount: 0,
        effectiveRoleOverrides: {},
        queuedDuringSwap: [],
        retiredUsage: { tokens: 0, costUsd: 0 },
      }),
    );
    expect(policy.usage).toBe(1208);
    expect(policy.budgetedUsage).toBe(8);
  });

  it('an old checkpoint without tokenUsage resumes without crashing, on the old basis', () => {
    const policy = new PolicyEngine('coder', {} as any, bus, '/tmp');
    mergeCheckpoint(
      fakeOrg(policy),
      checkpointWith({
        mailboxQueue: [],
        mailboxClosed: false,
        tokensUsed: 4242,
        costUsd: 0.01,
        status: 'running',
        generation: 0,
        respawnCount: 0,
        effectiveRoleOverrides: {},
        queuedDuringSwap: [],
        retiredUsage: { tokens: 0, costUsd: 0 },
      }),
    );
    expect(policy.usage).toBe(4242);
    expect(policy.budgetedUsage).toBe(4242);
  });
});
