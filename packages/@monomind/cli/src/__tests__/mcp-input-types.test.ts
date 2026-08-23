/**
 * inputSchema `type` checking at the callMCPTool choke point.
 *
 * Unlike `required` (hard-enforced — see mcp-required-params.test.ts), a
 * declared `type` is currently LOG-ONLY: a mismatch warns on stderr and the
 * call still reaches the handler. The point is to measure how many real
 * callers violate their own schemas before deciding whether hard enforcement
 * is safe. These tests pin that contract, so a future switch to throwing is a
 * deliberate change with visibly failing tests rather than a silent one.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MCP_WARN = /^\[mcp\] tool /;

function mcpWarnings(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((args) => String(args[0])).filter((msg) => MCP_WARN.test(msg));
}

describe('MCP inputSchema type checking (warn-only)', () => {
  let dir: string;
  let prevCwd: string | undefined;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    prevCwd = process.env.MONOMIND_CWD;
    dir = mkdtempSync(join(tmpdir(), 'mm-type-check-'));
    process.env.MONOMIND_CWD = dir;
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('warns on a type mismatch but still executes the tool', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    // agent_list declares status: { type: 'string' }.
    const result = await callMCPTool('agent_list', { status: 42 });

    // Executed: the handler returned, it did not throw.
    expect(result).toBeDefined();

    const warnings = mcpWarnings(errSpy);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/agent_list/);
    expect(warnings[0]).toMatch(/param 'status'/);
    expect(warnings[0]).toMatch(/declares string, got number/);
  });

  it('names every mismatching param, one warning each', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await callMCPTool('agent_list', { status: 42, includeTerminated: 'yes' });

    const warnings = mcpWarnings(errSpy);
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toMatch(/param 'status'.*declares string, got number/);
    expect(warnings.join('\n')).toMatch(/param 'includeTerminated'.*declares boolean, got string/);
  });

  it('is silent when every argument matches its declared type', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await callMCPTool('agent_list', { status: 'all', includeTerminated: true });
    expect(mcpWarnings(errSpy)).toEqual([]);
  });

  it('is silent for absent optional properties', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await callMCPTool('agent_list', {});
    expect(mcpWarnings(errSpy)).toEqual([]);
  });

  it("is silent for an explicit undefined or null (that is `required`'s job)", async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await callMCPTool('agent_list', { status: undefined, domain: null });
    expect(mcpWarnings(errSpy)).toEqual([]);
  });

  it('is silent for properties the schema does not declare at all', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await callMCPTool('agent_list', { notInSchema: { anything: [1, 2] } });
    expect(mcpWarnings(errSpy)).toEqual([]);
  });

  it('treats arrays as `array`, not `object` (JS says object; JSON Schema does not)', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await callMCPTool('agent_list', { status: ['a', 'b'] });

    const warnings = mcpWarnings(errSpy);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/declares string, got array/);
  });

  it('reports a plain object as `object`', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await callMCPTool('agent_list', { status: { eq: 'idle' } });
    expect(mcpWarnings(errSpy)[0]).toMatch(/declares string, got object/);
  });

  it('accepts an integer for a declared `number` (JSON has no separate integer type)', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    // session_list declares limit: { type: 'number' }.
    await callMCPTool('session_list', { limit: 5 });
    expect(mcpWarnings(errSpy)).toEqual([]);
  });

  it('accepts a float for a declared `number`', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await callMCPTool('session_list', { limit: 2.5 });
    expect(mcpWarnings(errSpy)).toEqual([]);
  });

  it('warns for a numeric string where a number is declared', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await callMCPTool('session_list', { limit: '5' });
    expect(mcpWarnings(errSpy)[0]).toMatch(/param 'limit'.*declares number, got string/);
  });

  it('does not turn a mismatch into a thrown error', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await expect(callMCPTool('agent_list', { status: 42 })).resolves.toBeDefined();
  });
});
