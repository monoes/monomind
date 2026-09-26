/**
 * #345: an ad-hoc `org run --task … -y` whose boss answered in seconds and
 * then called org_complete sat idle until killed. org_complete is on the
 * default human-approval list (#170) and `-y` only skips the cost prompt, so
 * the call queued an approval that nothing in the run printed or granted.
 *
 * The gate stays the default — detached `-y` runs rely on it to stop a boss
 * ending a long goal early. `org run --auto-approve org_complete` pre-approves
 * it for one run, and `org run` now prints every queued approval with the
 * command that resolves it.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approvalPendingNotice, checkApproval, parseAutoApproveFlag } from '../orgrt/approvals.js';
import { OrgDaemon } from '../orgrt/daemon.js';
import type { BusEvent } from '../orgrt/types.js';
import { ORG_DIR } from '../orgrt/types.js';

type Denial = { tool: string; message: string };

/** Stands in for the SDK's query(): every turn, the role asks canUseTool for
 *  org_complete and, when allowed, runs the real org tool handler — the same
 *  path a model's tool_use takes through the SDK. */
function completingQuery(denials: Denial[]) {
  return ({
    prompt,
    options,
  }: {
    prompt: AsyncIterable<unknown>;
    options: {
      canUseTool?: (
        name: string,
        input: Record<string, unknown>,
        opts?: unknown,
      ) => Promise<{ behavior: string; message?: string }>;
      mcpServers: {
        org: {
          instance: {
            _registeredTools: Record<string, { handler: (a: unknown, x: unknown) => unknown }>;
          };
        };
      };
    };
  }) =>
    (async function* () {
      for await (const _ of prompt) {
        const input = { outcome: 'achieved', summary: 'DRILL-OK' };
        const tool = options.mcpServers.org.instance._registeredTools.org_complete;
        if (tool) {
          const decision = await options.canUseTool?.('mcp__org__org_complete', input, {});
          if (decision?.behavior === 'allow') await tool.handler(input, {});
          else denials.push({ tool: 'org_complete', message: decision?.message ?? '' });
        }
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'DRILL-OK' }] },
        };
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();
}

const waitFor = async (cond: () => boolean, ms = 15_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe('org run --auto-approve — an ad-hoc single-role run can finish itself (#345)', () => {
  let root: string;
  let daemon: OrgDaemon;
  let denials: Denial[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'org-auto-approve-'));
    mkdirSync(join(root, ORG_DIR), { recursive: true });
    writeFileSync(
      join(root, ORG_DIR, 'drill.json'),
      JSON.stringify({
        name: 'drill',
        goal: 'g',
        roles: [{ id: 'lead', title: 'Lead', type: 'boss', reports_to: null }],
      }),
    );
    denials = [];
    daemon = new OrgDaemon(root, { queryFn: completingQuery(denials) as never, forward: false });
  });

  afterEach(async () => {
    await daemon.stopAll();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const closedBy = (): string | undefined => {
    try {
      return JSON.parse(readFileSync(join(root, ORG_DIR, 'drill', 'runtime.json'), 'utf8'))
        .closedBy;
    } catch {
      return undefined;
    }
  };

  it('terminates with outcome complete when org_complete is auto-approved for the run', async () => {
    await daemon.startOrg('drill', 'Reply immediately with exactly: DRILL-OK', {
      autoApprove: ['org_complete'],
    });
    // org run's wait loop ends once the org is gone, then reads closedBy.
    await waitFor(() => !daemon.getOrg('drill') && closedBy() === 'org-complete');
    expect(denials).toEqual([]);
    expect(daemon.approvals.get('drill') ?? []).toEqual([]);
  }, 30_000);

  it('without it, org_complete stays gated and the queued approval names how to resolve it', async () => {
    const running = await daemon.startOrg('drill', 'Reply immediately with exactly: DRILL-OK');
    const notices: string[] = [];
    running.bus.subscribe((e: BusEvent) => {
      const n = approvalPendingNotice('drill', e);
      if (n) notices.push(n);
    });
    await waitFor(() => denials.length > 0);
    expect(denials[0].message).toMatch(/pending human approval/);
    expect(daemon.getOrg('drill')).toBeDefined(); // still waiting — not silently completed
    expect(daemon.approvals.get('drill')?.[0]).toMatchObject({
      roleId: 'lead',
      action: 'org_complete',
      approved: null,
    });
    await waitFor(() => notices.length > 0);
    expect(notices[0]).toContain('monomind org approve drill lead org_complete');
    expect(notices[0]).toContain('monomind org deny drill lead org_complete');
    expect(notices[0]).toContain('--auto-approve org_complete');
  }, 30_000);

  it('refuses a tool nothing in the org gates, so a typo cannot silently leave the run waiting', async () => {
    await expect(
      daemon.startOrg('drill', undefined, { autoApprove: ['org_compelte'] }),
    ).rejects.toThrow(/--auto-approve.*org_compelte.*org_complete/);
    expect(daemon.getOrg('drill')).toBeUndefined();
  }, 30_000);

  it('a run-level auto-approve does not open other gated tools', async () => {
    await daemon.startOrg('drill', undefined, { autoApprove: ['org_complete'] });
    expect(await checkApproval(daemon, 'drill', 'lead', 'Bash', { command: 'rm -rf /' })).toBe(
      null,
    );
  }, 30_000);

  it('a boss auto-restart keeps the run-level auto-approve; the next explicit start drops it', async () => {
    await daemon.startOrg('drill', undefined, { autoApprove: ['org_complete'] });
    await daemon.stopOrg('drill');
    daemon.restarting.add('drill');
    await daemon.startOrg('drill');
    daemon.restarting.delete('drill');
    expect(await checkApproval(daemon, 'drill', 'lead', 'mcp__org__org_complete', {})).toBe(true);
    await daemon.stopOrg('drill');
    await daemon.startOrg('drill');
    expect(await checkApproval(daemon, 'drill', 'lead', 'mcp__org__org_complete', {})).toBe(null);
  }, 30_000);
});

describe('a role policy that requires approval still blocks, auto-approve or not', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'org-auto-approve-policy-'));
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('policy.approvalTools keeps a destructive provider tool pending', async () => {
    const daemon = {
      root: cwd,
      approvals: new Map(),
      approvalLocks: new Map(),
      recordDecision: () => {},
      runAutoApprove: new Map([['myorg', ['org_complete']]]),
      orgs: new Map([
        [
          'myorg',
          {
            def: { roles: [{ id: 'ops', policy: { approvalTools: ['infra__destroy'] } }] },
            bus: { emit: () => {} },
          },
        ],
      ]),
    } as unknown as OrgDaemon;
    expect(await checkApproval(daemon, 'myorg', 'ops', 'infra__destroy', { id: 'prod' })).toBe(
      null,
    );
    expect(await checkApproval(daemon, 'myorg', 'ops', 'mcp__org__org_complete', {})).toBe(true);
  });
});

describe('parseAutoApproveFlag', () => {
  it('splits, trims and normalizes a comma list', () => {
    expect(parseAutoApproveFlag('org_complete, mcp__org__org_send')).toEqual({
      tools: ['org_complete', 'org_send'],
    });
  });
  it('is empty when the flag is absent', () => {
    expect(parseAutoApproveFlag(undefined)).toEqual({ tools: [] });
  });
  it('rejects a value that is not a tool name', () => {
    expect(parseAutoApproveFlag('org_complete,rm -rf')).toMatchObject({
      error: expect.stringContaining('rm -rf'),
    });
    expect(parseAutoApproveFlag(true)).toMatchObject({ error: expect.any(String) });
  });
});
