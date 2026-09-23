// packages/@monomind/cli/__tests__/orgrt/org-harness-tools.test.ts
/**
 * Claude Code harness tools that wait on an absent human or track work
 * outside the org's task DAG (AskUserQuestion, ScheduleWakeup, Task*, Cron*,
 * plan mode) are removed from every claude-runtime org role — at every
 * policy.git level, push included — and never from non-Claude runtimes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { ORG_DISALLOWED_HARNESS_TOOLS } from '../../src/orgrt/org-harness-tools.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { resolveRoleGitEnforcement } from '../../src/orgrt/role-sandbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function scratch() {
  const base = tmp('harness-tools-');
  const repo = join(base, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  return { base, repo };
}

const enforcement = (git: string, claudeRuntime: boolean) => {
  const { base, repo } = scratch();
  return resolveRoleGitEnforcement({
    org: 'o',
    role: { id: 'r', policy: { git } } as any,
    cwd: repo,
    orgRoot: base,
    orgDir: join(base, 'org'),
    bus: new OrgBus('o', 'run', tmp('bus-')),
    claudeRuntime,
    availability: { available: false, reason: 'test' },
  });
};

describe('ORG_DISALLOWED_HARNESS_TOOLS', () => {
  it('names tools the installed Claude Agent SDK actually exposes', () => {
    const sdk = dirname(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk'));
    const types = readFileSync(join(sdk, 'sdk-tools.d.ts'), 'utf8');
    for (const name of ORG_DISALLOWED_HARNESS_TOOLS)
      expect(types, name).toMatch(new RegExp(`export interface ${name}Input\\b`));
  });

  it('covers the harness tools observed on the 2.16.0 release run and their siblings', () => {
    expect(ORG_DISALLOWED_HARNESS_TOOLS).toEqual(
      expect.arrayContaining([
        'AskUserQuestion',
        'ScheduleWakeup',
        'TaskCreate',
        'TaskUpdate',
        'TaskList',
        'TaskGet',
        'CronCreate',
        'CronDelete',
        'CronList',
        'EnterPlanMode',
        'ExitPlanMode',
      ]),
    );
  });
});

describe('resolveRoleGitEnforcement disallows the harness tools for claude roles', () => {
  it.each(['none', 'read', 'commit', 'push'])('policy.git %s', (git) => {
    expect(enforcement(git, true).claudeRestrictions?.disallowedTools).toEqual(
      expect.arrayContaining(ORG_DISALLOWED_HARNESS_TOOLS),
    );
  });

  it('push keeps no sandbox and no file-tool rules — only the harness tools', () => {
    expect(enforcement('push', true).claudeRestrictions).toEqual({
      disallowedTools: ORG_DISALLOWED_HARNESS_TOOLS,
    });
  });

  it('non-Claude runtimes get no Claude restrictions', () => {
    expect(enforcement('push', false).claudeRestrictions).toBeUndefined();
    expect(enforcement('read', false).claudeRestrictions).toBeUndefined();
  });
});

describe('session wiring', () => {
  it("a push role's query() options disallow the harness tools", async () => {
    const { base, repo } = scratch();
    const bus = new OrgBus('o', 'r', tmp('bus-'));
    const mailbox = new Mailbox();
    mailbox.push('go');
    mailbox.close();
    let seen: any = {};
    const queryFn = ({ prompt, options }: any) =>
      (async function* () {
        seen = options;
        for await (const _ of prompt) break;
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    await runAgentSession({
      org: 'o',
      role: { id: 'lead', title: 'Lead', type: 'boss', reports_to: null, responsibilities: [], policy: { git: 'push' } } as any,
      bus,
      policy: new PolicyEngine('lead', { git: 'push' }, bus, repo),
      mailbox,
      cwd: repo,
      orgRoot: base,
      orgDir: join(base, '.monomind', 'orgs', 'o'),
      deliver: async () => 'delivered',
      queryFn: queryFn as any,
    });
    expect(seen.disallowedTools).toEqual(expect.arrayContaining(ORG_DISALLOWED_HARNESS_TOOLS));
    expect(seen.sandbox).toBeUndefined();
  });
});
