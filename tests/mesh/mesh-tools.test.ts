import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callWithHub, join, leave } = vi.hoisted(() => ({
  callWithHub: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
}));
vi.mock('../../packages/@monomind/cli/src/mesh/client.js', async (orig) => ({
  ...(await orig<typeof import('../../packages/@monomind/cli/src/mesh/client.js')>()),
  callWithHub,
}));
vi.mock('../../packages/@monomind/cli/src/mesh/session-presence.js', () => ({
  sessionPresence: { join, leave, addr: () => undefined },
}));

import { meshTools } from '../../packages/@monomind/cli/src/mcp-tools/mesh-tools.js';
import { MeshOfflineError } from '../../packages/@monomind/cli/src/mesh/client.js';

const tool = (name: string) => meshTools.find((t) => t.name === name)!;

beforeEach(() => {
  callWithHub.mockReset();
  join.mockReset();
  leave.mockReset();
});

describe('mesh tools', () => {
  it('exposes who, join and leave', () => {
    expect(meshTools.map((t) => t.name).sort()).toEqual(['mesh_join', 'mesh_leave', 'mesh_who']);
  });

  it('mesh_who forwards filters and returns the agents', async () => {
    callWithHub.mockResolvedValue({ id: 'x', ok: true, agents: [{ addr: 'h/p/s' }] });
    const out = await tool('mesh_who').handler({ project: 'p1', status: 'active' });
    expect(callWithHub.mock.calls[0][0]).toMatchObject({
      op: 'who',
      project: 'p1',
      status: 'active',
    });
    expect(out).toEqual({ agents: [{ addr: 'h/p/s' }] });
  });

  it('mesh_who degrades to offline instead of throwing', async () => {
    callWithHub.mockRejectedValue(new MeshOfflineError());
    expect(await tool('mesh_who').handler({})).toEqual({ offline: true, agents: [] });
  });

  it('mesh_who rejects an invalid filter', async () => {
    const out = (await tool('mesh_who').handler({ tier: 'wizard' })) as { isError?: boolean };
    expect(out.isError).toBe(true);
    expect(callWithHub).not.toHaveBeenCalled();
  });

  it('mesh_join registers this session with project defaults', async () => {
    join.mockResolvedValue('h/proj/s123');
    const out = await tool('mesh_join').handler({
      alias: 'lead',
      task: 'design mesh',
      capabilities: ['plan'],
    });
    const arg = join.mock.calls[0][0];
    expect(arg).toMatchObject({
      runtime: 'claude-code',
      alias: 'lead',
      task: 'design mesh',
      capabilities: ['plan'],
      pid: process.pid,
    });
    expect(arg.sessionId).toMatch(/^s\d+$/);
    expect(arg.project).toMatch(/-[0-9a-f]{16}$/);
    expect(out).toEqual({ addr: 'h/proj/s123' });
  });

  it('mesh_join reports the hub refusal (alias taken) as an error result', async () => {
    join.mockRejectedValue(new Error('alias_taken'));
    const out = (await tool('mesh_join').handler({ alias: 'lead' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('alias_taken');
  });

  it('mesh_join and mesh_leave report offline when the hub is unreachable', async () => {
    join.mockRejectedValue(new MeshOfflineError());
    expect(await tool('mesh_join').handler({})).toEqual({ offline: true });
    leave.mockRejectedValue(new MeshOfflineError());
    expect(await tool('mesh_leave').handler({})).toEqual({ offline: true });
  });

  it('mesh_leave leaves', async () => {
    leave.mockResolvedValue(undefined);
    expect(await tool('mesh_leave').handler({})).toEqual({ left: true });
  });
});
