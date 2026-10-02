// Invariant: a token cap binds on the basis the org declares. By default budget_tokens counts
// uncached input plus output, so cache reads, which are most of a long session's volume, never
// move it. With run_config.budget_tokens_basis "billable" every token counts, cache reads
// included, so a cap bounds a runner that reports only tokens (codex, antigravity). The smoke
// tier uses "billable" for exactly that reason (found in the codex dry run: 11.9M tokens, 80%
// of them cache reads, against caps that counted only the 0.5M uncached).
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../../packages/@monomind/cli/src/orgrt/daemon.js';
import { projectWithOrg, scriptedSdk, waitUntil } from '../support/scripted.js';

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopAll();
  daemon = undefined;
});

/** A worker whose every turn reads 50K cached tokens and adds 100 uncached ones. */
async function run(opts: {
  basis?: 'billable';
  workerCap?: number;
  orgCap: number;
  turns: number;
}) {
  const sdk = scriptedSdk((role, turn) =>
    role === 'worker' ? { calls: [{ id: `w${turn}`, input: 100, cache_read: 50_000 }] } : {},
  );
  const { root } = projectWithOrg({
    name: 'o',
    goal: 'g',
    run_config: {
      budget_tokens: opts.orgCap,
      ...(opts.basis ? { budget_tokens_basis: opts.basis } : {}),
    },
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      {
        id: 'worker',
        title: 'W',
        type: 'specialist',
        reports_to: 'boss',
        ...(opts.workerCap ? { budget_tokens: opts.workerCap } : {}),
      },
    ],
  });
  daemon = new OrgDaemon(root, {
    queryFn: sdk.queryFn,
    forward: false,
    stopWaitMs: 100,
    crashBackoffsMs: [],
  });
  const running = await daemon.startOrg('o');
  await daemon.deliver('o', 'boss', 'worker', 't', 'one');
  const worker = running.agents.get('worker')!;
  for (let i = 1; i <= opts.turns; i++) {
    expect(
      await waitUntil(() => (sdk.turns.get('worker') ?? 0) >= i || worker.mailbox.isClosed),
    ).toBe(true);
    if (worker.mailbox.isClosed) break;
    if (i < opts.turns) await daemon.deliver('o', 'boss', 'worker', 't', `msg ${i + 1}`);
  }
  await new Promise((r) => setTimeout(r, 200));
  return { sdk, worker };
}

describe('scenario: token caps bind on the declared basis', () => {
  it('by default a role cap counts uncached tokens only: three turns of cache reads close nothing', async () => {
    const { sdk, worker } = await run({ workerCap: 1000, orgCap: 4_000_000, turns: 3 });
    expect(sdk.turns.get('worker')).toBe(3); // 300 uncached tokens against 1000
    expect(worker.mailbox.isClosed).toBe(false);
  });

  it('with the billable basis the same role cap closes the role after the turn that crosses it', async () => {
    const { sdk, worker } = await run({
      basis: 'billable',
      workerCap: 1000,
      orgCap: 40_000_000,
      turns: 3,
    });
    expect(sdk.turns.get('worker')).toBe(1); // 50,100 tokens against 1000
    expect(worker.mailbox.isClosed).toBe(true);
    expect(worker.mailbox.closeReason).toBe('token-budget');
  });

  it('with the billable basis the org-wide ceiling counts cache reads too', async () => {
    const { sdk, worker } = await run({ basis: 'billable', orgCap: 120_000, turns: 4 });
    expect(sdk.turns.get('worker')).toBeLessThan(4); // 50,100 per turn against 120,000
    expect(worker.mailbox.isClosed).toBe(true);
  });
});
