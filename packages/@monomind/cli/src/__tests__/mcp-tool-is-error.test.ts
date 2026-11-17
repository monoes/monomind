/**
 * #790: a tool that fails by returning `{ isError: true }` (not by throwing)
 * must reach the client flagged as an error and be counted as a failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const callMCPTool = vi.fn();

vi.mock('@monoes/monograph', () => ({
  buildAsync: vi.fn().mockRejectedValue(new Error('boom')),
}));

vi.mock('../mcp-client.js', () => ({
  listMCPTools: vi.fn().mockReturnValue([]),
  hasTool: vi.fn().mockResolvedValue(true),
  callMCPTool: (...args: unknown[]) => callMCPTool(...args),
}));

import { handleMCPMessage } from '../mcp-stdio-handler.js';
import { monographBuildTool } from '../mcp-tools/monograph/build-tools.js';
import { getRequestCounts, resetRequestCounts } from '../mcp-tools/request-tracker.js';

describe('monograph_build failure', () => {
  it('returns isError with the explained message', async () => {
    const result = (await monographBuildTool.handler({ path: '/nonexistent-repo' }, undefined)) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Monograph build failed for /nonexistent-repo');
    expect(result.content[0].text).toContain('boom');
  });
});

describe('stdio handler request tracking', () => {
  beforeEach(() => {
    resetRequestCounts();
    callMCPTool.mockReset();
  });

  const call = () =>
    handleMCPMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'some_tool', arguments: {} } },
      'session-1',
    );

  it('counts an isError result as a failure and passes it through', async () => {
    const failed = { content: [{ type: 'text', text: 'nope' }], isError: true };
    callMCPTool.mockResolvedValue(failed);
    const res = await call();
    expect(res?.result).toEqual(failed);
    expect(getRequestCounts()).toMatchObject({ total: 1, success: 0, errors: 1 });
  });

  it('counts a normal result as a success', async () => {
    callMCPTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    await call();
    expect(getRequestCounts()).toMatchObject({ total: 1, success: 1, errors: 0 });
  });
});
