// Invariants (spec 9.2, pilot): the hand-off prototype reaches only the roles
// of an authorized trial; a document that fails its contract is refused and
// counted; a version is accepted only when every consumer accepts it; and a
// cross-section org_send is refused before anything is delivered. The prototype
// lives in the harness: the org definition stays an ordinary Phase 2 one.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../../packages/@monomind/cli/src/orgrt/daemon.js';
import { attachPilot, type PilotTrial, pilotOrgDef } from '../pilot/harness.js';
import { projectWithOrg, scriptedSdk, waitUntil } from '../support/scripted.js';

const TRIAL_ID = 'pilot-trial-1';
let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopAll();
  daemon = undefined;
});

const trial = (): PilotTrial => ({
  runId: TRIAL_ID,
  dir: mkdtempSync(join(tmpdir(), 'pilot-trial-')),
  routing: {
    sections: {
      research: { lead: 'researcher', members: [] },
      content: { lead: 'writer', members: ['reviewer'] },
    },
  },
  contracts: [
    {
      id: 'brief',
      title: 'Content brief',
      producer: 'researcher',
      consumers: ['writer', 'reviewer'],
      max_attempts: 3,
      schema: {
        type: 'object',
        required: ['topic', 'claims'],
        properties: {
          topic: { type: 'string', minLength: 3 },
          claims: { type: 'array', minItems: 1, items: { type: 'string' } },
        },
      },
    },
  ],
});

const baseDef = {
  name: 'pilot',
  goal: 'g',
  roles: [
    { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
    { id: 'researcher', title: 'R', type: 'specialist', reports_to: 'boss' },
    { id: 'writer', title: 'W', type: 'specialist', reports_to: 'boss' },
    { id: 'reviewer', title: 'V', type: 'specialist', reports_to: 'boss' },
  ],
};

const toolNames = (sdk: ReturnType<typeof scriptedSdk>, role: string): string[] =>
  Object.keys(sdk.options.get(role)?.[0]?.mcpServers?.org?.instance?._registeredTools ?? {});

describe('scenario: pilot document hand-off', () => {
  it('hands a document from producer to both consumers, refusing a bad document and a cross-section send', async () => {
    const t = trial();
    const sdk = scriptedSdk((role, _turn, message) => {
      if (!message.includes('GO')) return {};
      if (role === 'researcher')
        return {
          tools: [
            { name: 'pilot__doc_publish', args: { doc_id: 'brief', content: { topic: 'x' } } },
            {
              name: 'pilot__doc_publish',
              args: {
                doc_id: 'brief',
                content: { topic: 'Pricing', claims: ['v2.22 ships sections'] },
              },
            },
            {
              name: 'org_send',
              args: { to: 'writer', subject: 'psst', message: 'here is the brief' },
            },
          ],
        };
      if (role === 'writer')
        return {
          tools: [
            { name: 'pilot__doc_read', args: { doc_id: 'brief' } },
            {
              name: 'pilot__doc_decide',
              args: { doc_id: 'brief', version: 1, decision: 'accept' },
            },
          ],
        };
      if (role === 'reviewer')
        return {
          tools: [
            {
              name: 'pilot__doc_decide',
              args: { doc_id: 'brief', version: 1, decision: 'accept' },
            },
          ],
        };
      return {};
    });
    const { root } = projectWithOrg(pilotOrgDef(baseDef, t));
    daemon = new OrgDaemon(root, {
      queryFn: sdk.queryFn,
      forward: false,
      stopWaitMs: 100,
      crashBackoffsMs: [],
    });
    const store = attachPilot(daemon, t, TRIAL_ID);
    await daemon.startOrg('pilot');
    const poke = (to: string) => daemon!.deliver('pilot', 'owner', to, 'GO', 'GO');

    await poke('researcher');
    expect(
      await waitUntil(() => sdk.toolResults.filter((r) => r.role === 'researcher').length === 3),
    ).toBe(true);
    const [bad, good, send] = sdk.toolResults.filter((r) => r.role === 'researcher');
    expect(bad.json).toMatchObject({ ok: false });
    expect(bad.json.problems).toContain('$.claims: required');
    expect(good.json).toEqual({ ok: true, version: 1, status: 'pending' });
    expect(send.text).toMatch(
      /^Refused: researcher \(section research\) cannot message writer \(section content\)/,
    );

    await poke('writer');
    await poke('reviewer');
    expect(await waitUntil(() => sdk.toolResults.some((r) => r.role === 'reviewer'))).toBe(true);
    const writerRead = sdk.toolResults.find(
      (r) => r.role === 'writer' && r.name === 'pilot__doc_read',
    )!;
    expect(writerRead.json.doc.content.topic).toBe('Pricing');
    const decisions = sdk.toolResults
      .filter((r) => r.name === 'pilot__doc_decide')
      .map((r) => r.json);
    expect(decisions[0]).toMatchObject({ ok: true, waiting_on: ['reviewer'] });
    expect(decisions[1]).toMatchObject({ ok: true, status: 'accepted', waiting_on: [] });

    // The refused send was never queued: the writer's only mail is the harness poke.
    expect(
      (sdk.messages.get('writer') ?? []).filter((m) => m.includes('here is the brief')),
    ).toHaveLength(0);
    expect(store.events().map((e) => `${e.kind}:${e.ok}`)).toEqual(
      expect.arrayContaining([
        'publish:false',
        'publish:true',
        'send-refused:false',
        'read:true',
        'decide:true',
      ]),
    );
  });

  it('gives the prototype tools to sectioned roles only, and attaches only to the trial that owns the token', async () => {
    const t = trial();
    const sdk = scriptedSdk(() => ({}));
    const { root } = projectWithOrg(pilotOrgDef(baseDef, t));
    daemon = new OrgDaemon(root, {
      queryFn: sdk.queryFn,
      forward: false,
      stopWaitMs: 100,
      crashBackoffsMs: [],
    });
    expect(() => attachPilot(daemon!, t, 'another-trial')).toThrow(/run token/);
    attachPilot(daemon, t, TRIAL_ID);
    await daemon.startOrg('pilot');
    for (const to of ['boss', 'researcher']) await daemon.deliver('pilot', 'owner', to, 'hi', 'hi');
    expect(await waitUntil(() => sdk.options.has('boss') && sdk.options.has('researcher'))).toBe(
      true,
    );
    expect(toolNames(sdk, 'researcher')).toEqual(
      expect.arrayContaining([
        'pilot__doc_publish',
        'pilot__doc_read',
        'pilot__doc_decide',
        'pilot__doc_list',
      ]),
    );
    expect(toolNames(sdk, 'boss').some((n) => n.startsWith('pilot__'))).toBe(false);
  });

  it('tells each sectioned role, in its own responsibilities, what it produces, what it consumes and that cross-section mail is refused', () => {
    const t = trial();
    const def = pilotOrgDef(baseDef, t);
    const text = (id: string) =>
      (def.roles.find((r: any) => r.id === id) as any).responsibilities?.join('\n') ?? '';
    expect(text('researcher')).toMatch(/produce.*brief/is);
    expect(text('researcher')).toMatch(/pilot__doc_publish/);
    expect(text('writer')).toMatch(/consume.*brief/is);
    expect(text('writer')).toMatch(/pilot__doc_decide/);
    expect(text('researcher')).toMatch(/other section.*refused/is);
    expect(text('boss')).not.toMatch(/pilot__/); // an unsectioned role is not told about it
  });

  it('refuses an org definition that carries sections or the experimental flag', () => {
    const t = trial();
    expect(() => pilotOrgDef({ ...baseDef, sections: {} } as never, t)).toThrow(/sections/);
    expect(() =>
      pilotOrgDef({ ...baseDef, run_config: { experimental: 'eval' } } as never, t),
    ).toThrow(/experimental/);
  });

  it('leaves a role with no pilot attached unable to reach the store', async () => {
    const t = trial();
    const store = (await import('../pilot/store.js')).HandoffStore;
    const s = new store(t.dir, t.contracts);
    expect(s.read('boss', 'brief')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not a producer or consumer/),
    });
  });
});
