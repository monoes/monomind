// packages/@monomind/cli/__tests__/orgrt/status-snapshot-budget.test.ts
/**
 * The daemon's status snapshot (served at /api/status, read by the dashboard's
 * Runtime tab) reports what the policy engines ENFORCE — per role and
 * org-wide, on the budget's basis — and the definition the run loaded, so a
 * saved config edit can be shown as pending until the next run.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../src/orgrt/daemon.js';

const quiet = ({ prompt }: any) =>
  (async function* () {
    for await (const _m of prompt) {
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

const daemons: OrgDaemon[] = [];
afterEach(async () => {
  for (const d of daemons.splice(0)) await d.stopAll().catch(() => {});
});

describe('status snapshot', () => {
  it('reports enforced usage per role and org-wide, and the loaded definition', async () => {
    const root = mkdtempSync(join(tmpdir(), 'snap-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(
      join(root, '.monomind/orgs/acme.json'),
      JSON.stringify({
        name: 'acme',
        goal: 'ship',
        run_config: { budget_tokens: 1000, max_evidence_attempts: 5 },
        roles: [
          { id: 'boss', type: 'boss', reports_to: null },
          { id: 'dev', reports_to: 'boss' },
        ],
      }),
    );
    const daemon = new OrgDaemon(root, { queryFn: quiet as any, forward: false });
    daemons.push(daemon);
    const running = await daemon.startOrg('acme');
    // A metered turn (cache tokens too) that never produced a usage event.
    running.agents.get('boss')!.policy.addTokenUsage({ input: 30, output: 10, cacheRead: 500 });

    const org = (daemon.getStatusSnapshot!() as any).orgs[0];
    const boss = org.roles.find((r: any) => r.id === 'boss');
    expect(boss.usage).toMatchObject({ budgeted: 40, billable: 540, maxTokens: 500 });
    // uncached basis (default): cache reads don't count toward the ceiling
    expect(org.budget).toMatchObject({ tokens: 1000, basis: 'uncached' });
    expect(org.budget.used).toBeGreaterThanOrEqual(40);
    expect(org.loaded).toMatchObject({ goal: 'ship', run_config: { max_evidence_attempts: 5 } });
  });
});
