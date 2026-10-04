// P3.3: the harness entry passes the start gate for a sections definition only.
import { describe, expect, it } from 'vitest';
import { sectionsRaw } from '../../../../packages/@monomind/cli/__tests__/orgrt/support/sections-defs.js';
import { projectWithOrg, scriptedSdk } from '../support/scripted.js';
import { runOrg } from './run-org.js';

const bossCompletes = () =>
  scriptedSdk((role) =>
    role === 'boss'
      ? { tools: [{ name: 'org_complete', args: { outcome: 'achieved', summary: 'done' } }] }
      : {},
  );

describe('runOrg and the sections start gate', () => {
  it('starts a synthetic sections org (the harness passes the gate)', async () => {
    const sdk = bossCompletes();
    const { root, name } = projectWithOrg(sectionsRaw());
    await runOrg({ root, name, task: 'do it', queryFn: sdk.queryFn, pollMs: 50 });
    expect(sdk.turns.get('boss')).toBeGreaterThanOrEqual(1);
  });

  it('still starts an org without sections, with no gate option involved', async () => {
    const sdk = bossCompletes();
    const { root, name } = projectWithOrg({
      name: 'plain',
      goal: 'g',
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'a', title: 'A', type: 'specialist', reports_to: 'boss' },
      ],
    });
    await runOrg({ root, name, task: 'do it', queryFn: sdk.queryFn, pollMs: 50 });
    expect(sdk.turns.get('boss')).toBeGreaterThanOrEqual(1);
  });
});
