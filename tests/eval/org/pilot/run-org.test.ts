import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { projectWithOrg, scriptedSdk } from '../support/scripted.js';
import { type PilotTrial, pilotOrgDef } from './harness.js';
import { NATIVE_CHILD_TOOLS, runOrg, withoutNativeChildren } from './run-org.js';

const def = {
  name: 'pr',
  goal: 'g',
  roles: [
    { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
    { id: 'a', title: 'A', type: 'specialist', reports_to: 'boss' },
    { id: 'b', title: 'B', type: 'specialist', reports_to: 'boss' },
  ],
};
const trial = (): PilotTrial => ({
  runId: 'tok-1',
  dir: mkdtempSync(join(tmpdir(), 'pilot-run-')),
  routing: { sections: { s1: { lead: 'a', members: [] }, s2: { lead: 'b', members: [] } } },
  contracts: [
    {
      id: 'doc',
      title: 'D',
      producer: 'a',
      consumers: ['b'],
      max_attempts: 2,
      schema: { type: 'object' },
    },
  ],
});

describe('withoutNativeChildren', () => {
  it('adds the native-child tools to every call, keeping the disallowed tools already there', () => {
    const query = vi.fn(() => 'q') as never;
    withoutNativeChildren(query)({
      prompt: 'p',
      options: { disallowedTools: ['X'], model: 'm' },
    } as never);
    expect(vi.mocked(query).mock.calls[0][0]).toMatchObject({
      prompt: 'p',
      options: { model: 'm', disallowedTools: ['X', ...NATIVE_CHILD_TOOLS] },
    });
    withoutNativeChildren(query)({ prompt: 'p' } as never);
    expect((vi.mocked(query).mock.calls[1][0] as any).options.disallowedTools).toEqual(
      NATIVE_CHILD_TOOLS,
    );
  });
});

describe('runOrg', () => {
  const run = async (arm: 'baseline' | 'treatment') => {
    const t = trial();
    // boss asks a; a answers; boss completes: so the sectioned role `a` really starts
    const sdk = scriptedSdk((role, turn) =>
      role === 'boss'
        ? turn === 0
          ? { tools: [{ name: 'org_send', args: { to: 'a', subject: 'hi', message: 'start' } }] }
          : { tools: [{ name: 'org_complete', args: { outcome: 'achieved', summary: 'done' } }] }
        : role === 'a'
          ? { tools: [{ name: 'org_send', args: { to: 'boss', subject: 'ok', message: 'done' } }] }
          : {},
    );
    const { root } = projectWithOrg(arm === 'treatment' ? pilotOrgDef(def, t) : def);
    await runOrg({
      root,
      name: 'pr',
      task: 'do it',
      pilot: arm === 'treatment' ? t : undefined,
      queryFn: sdk.queryFn,
      pollMs: 50,
    });
    return sdk;
  };

  it('runs the org to its end, with native children denied to every role call', async () => {
    const sdk = await run('baseline');
    expect(sdk.turns.get('boss')).toBeGreaterThanOrEqual(1);
    for (const o of [...sdk.options.values()].flat())
      expect(o.disallowedTools).toEqual(expect.arrayContaining(NATIVE_CHILD_TOOLS));
  });

  it('gives the prototype tools to sectioned roles in the treatment arm only', async () => {
    const baseline = await run('baseline');
    const treatment = await run('treatment');
    const names = (sdk: ReturnType<typeof scriptedSdk>, role: string) =>
      Object.keys(sdk.options.get(role)?.[0]?.mcpServers?.org?.instance?._registeredTools ?? {});
    expect(names(treatment, 'a')).toEqual(
      expect.arrayContaining([
        'pilot__doc_publish',
        'pilot__doc_read',
        'pilot__doc_decide',
        'pilot__doc_list',
      ]),
    );
    expect(names(baseline, 'a').some((n) => n.startsWith('pilot__'))).toBe(false);
    expect(names(treatment, 'boss').some((n) => n.startsWith('pilot__'))).toBe(false); // the unsectioned root is untouched
  });
});
