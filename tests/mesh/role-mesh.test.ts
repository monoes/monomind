import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ManagedJoinOptions } from '../../packages/@monomind/cli/src/mesh/managed-presence.js';
import { OrgBus } from '../../packages/@monomind/cli/src/orgrt/bus.js';
import { Mailbox } from '../../packages/@monomind/cli/src/orgrt/mailbox.js';
import { PolicyEngine } from '../../packages/@monomind/cli/src/orgrt/policy.js';
import { joinRoleMesh } from '../../packages/@monomind/cli/src/orgrt/role-mesh.js';
import type { SessionOpts } from '../../packages/@monomind/cli/src/orgrt/session.js';
import { sessionRunArgs } from '../../packages/@monomind/cli/src/orgrt/session-stream.js';
import { OrgDefSchema } from '../../packages/@monomind/cli/src/orgrt/types.js';

const input = { org: 'my org', roleId: 'lead', runtime: 'claude', cwd: '/w/proj' };
const fakePresence = {
  alias: 'my-org-lead',
  addr: 'h/p/r1/lead',
  env: {},
  unreadBlock: async () => '',
  leave: async () => {},
};

describe('joinRoleMesh', () => {
  it('joins as an org-role named <org>-<role> with the role as agent id', async () => {
    const join = vi.fn(async (_o: ManagedJoinOptions) => fakePresence);
    const r = await joinRoleMesh(input, join as never, {});
    expect(join.mock.calls[0][0]).toMatchObject({
      tier: 'org-role',
      alias: 'my-org-lead',
      agentId: 'lead',
      runtime: 'claude',
      cwd: '/w/proj',
    });
    expect(r?.note).toContain('"my-org-lead"');
    expect(r?.note).toContain('org_send');
  });

  it('is off with MONOMIND_MESH_AUTOJOIN=0', async () => {
    const join = vi.fn();
    expect(
      await joinRoleMesh(input, join as never, { MONOMIND_MESH_AUTOJOIN: '0' }),
    ).toBeUndefined();
    expect(join).not.toHaveBeenCalled();
  });

  it('never joins a real hub under vitest unless a join is injected', async () => {
    expect(await joinRoleMesh(input, undefined, { VITEST: 'true' })).toBeUndefined();
  });

  it('swallows a failing or absent join', async () => {
    expect(await joinRoleMesh(input, (async () => undefined) as never, {})).toBeUndefined();
    expect(
      await joinRoleMesh(
        input,
        (async () => {
          throw new Error('offline');
        }) as never,
        {},
      ),
    ).toBeUndefined();
  });
});

describe('the mesh note reaches the role system prompt', () => {
  const root = mkdtempSync(join(tmpdir(), 'rolemesh-'));
  const opts = () => {
    const def = OrgDefSchema.parse({ name: 'o', roles: [{ id: 'w' }] });
    const bus = new OrgBus('o', 'r', root);
    return {
      org: 'o',
      role: def.roles[0],
      bus,
      policy: new PolicyEngine('w', { maxTokens: 1000 }, bus, root),
      mailbox: new Mailbox(),
      cwd: root,
      def,
      deliver: async () => 'ok',
    } as unknown as SessionOpts;
  };
  const prompt = (meshNote?: string) =>
    sessionRunArgs(opts(), {
      runner: {} as never,
      tools: [],
      streamOpts: undefined,
      gitEnforcement: { env: {} },
      model: 'm',
      tier: undefined,
      prov: { cfg: undefined } as never,
      resume: undefined,
      authorityMask: undefined,
      abort: new AbortController(),
      meshNote,
    }).systemPrompt as string;

  it('appends the note after the role prompt and leaves the prompt alone without one', () => {
    const plain = prompt();
    expect(plain).not.toContain('Monomind mesh');
    const withNote = prompt('You are also "o-w" on the Monomind mesh.');
    expect(withNote.startsWith(plain)).toBe(true);
    expect(withNote.endsWith('You are also "o-w" on the Monomind mesh.')).toBe(true);
  });
});
