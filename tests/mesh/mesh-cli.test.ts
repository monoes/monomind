import { describe, expect, it, vi } from 'vitest';
import {
  type MeshCliDeps,
  meshInbox,
  meshSend,
  meshWho,
} from '../../packages/@monomind/cli/src/commands/mesh.js';
import { MeshOfflineError } from '../../packages/@monomind/cli/src/mesh/client.js';

const leave = vi.fn(async () => {});

function deps(over: Partial<MeshCliDeps> = {}): MeshCliDeps & { sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    env: {},
    call: async (r) => {
      sent.push(r);
      return { id: 'x', ok: true, seq: 7, to: 'h/p/s2', agents: [], messages: [] };
    },
    join: async (alias) => ({
      alias: alias ?? 'cli-1',
      addr: 'h/p/tmp',
      env: { MONOMIND_MESH_KEY: 'tmpkey' },
      unreadBlock: async () => '',
      leave,
    }),
    ...over,
  };
}

const identity = { MONOMIND_MESH_ADDR: 'h/p/me', MONOMIND_MESH_KEY: 'k' };

describe('mesh send', () => {
  it('uses the identity in the environment', async () => {
    const d = deps({ env: identity });
    const join = vi.spyOn(d, 'join');
    const r = await meshSend({ to: 'lead', body: 'hi', kind: 'reply', 'reply-to': 4 }, d);
    expect(r.success).toBe(true);
    expect(d.sent[0]).toMatchObject({
      op: 'send',
      addr: 'h/p/me',
      key: 'k',
      to: 'lead',
      body: 'hi',
      kind: 'reply',
      replyTo: 4,
    });
    expect(join).not.toHaveBeenCalled();
  });

  it('registers once as --from and says bye', async () => {
    leave.mockClear();
    const d = deps();
    const join = vi.spyOn(d, 'join');
    const r = await meshSend({ to: 'lead', body: 'hi', from: 'ci-bot' }, d);
    expect(r.success).toBe(true);
    expect(join).toHaveBeenCalledWith('ci-bot');
    expect(d.sent[0]).toMatchObject({ addr: 'h/p/tmp', key: 'tmpkey' });
    expect(leave).toHaveBeenCalledOnce();
  });

  it('rejects missing arguments and bad kinds without touching the hub', async () => {
    const d = deps();
    expect((await meshSend({ to: 'a' }, d)).success).toBe(false);
    expect((await meshSend({ to: 'a', body: 'b', kind: 'shout' }, d)).success).toBe(false);
    expect((await meshSend({ to: 'a', body: 'b', 'reply-to': 0 }, d)).success).toBe(false);
    expect(d.sent).toEqual([]);
  });

  it('reports an offline hub as a failure', async () => {
    const d = deps({
      env: identity,
      call: async () => {
        throw new MeshOfflineError();
      },
    });
    expect(await meshSend({ to: 'a', body: 'b' }, d)).toMatchObject({
      success: false,
      exitCode: 1,
    });
  });

  it('fails when the one-shot join does not happen', async () => {
    const d = deps({ join: async () => undefined });
    expect((await meshSend({ to: 'a', body: 'b' }, d)).success).toBe(false);
  });
});

describe('mesh inbox and who', () => {
  it('inbox needs the environment identity', async () => {
    const d = deps();
    expect((await meshInbox({}, d)).success).toBe(false);
    expect(d.sent).toEqual([]);
  });

  it('inbox reads with the identity and honours peek and limit', async () => {
    const d = deps({ env: identity });
    expect((await meshInbox({ peek: true, limit: 5 }, d)).success).toBe(true);
    expect(d.sent[0]).toMatchObject({
      op: 'inbox',
      addr: 'h/p/me',
      key: 'k',
      peek: true,
      limit: 5,
    });
    expect((await meshInbox({ limit: 500 }, d)).success).toBe(false);
  });

  it('who passes filters; --all-projects drops the project scope', async () => {
    const d = deps();
    await meshWho({ 'all-projects': true, tier: 'external' }, d);
    expect(d.sent[0]).toMatchObject({ op: 'who', tier: 'external' });
    expect(d.sent[0].project).toBeUndefined();
    await meshWho({}, d);
    expect(typeof d.sent[1].project).toBe('string');
  });
});
