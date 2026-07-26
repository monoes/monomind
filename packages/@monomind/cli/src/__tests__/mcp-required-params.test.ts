/**
 * Enforcement of the `required` contract each MCP tool advertises in its
 * inputSchema, plus the two false contracts that enforcement exposed.
 *
 * Background: 120 of ~254 tools declare `required` params, but nothing ever
 * checked them — `required` was advisory documentation shipped to clients in
 * `tools/list` and ignored at dispatch. Handlers ran with whatever arrived, so
 * a missing argument surfaced as whatever the handler happened to hit first
 * (e.g. a raw `SqliteError: NOT NULL constraint failed`).
 *
 * Enforcing it turned two previously-silent schema lies into hard failures,
 * both fixed here and pinned by the tests below.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('MCP required-parameter enforcement', () => {
  it('rejects a call missing a required parameter, naming it', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await expect(callMCPTool('agent_spawn', {})).rejects.toThrow(
      /missing required parameter: agentType/
    );
  });

  it('names every missing parameter, pluralised', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    // browser_fill declares required: ['target', 'value']
    await expect(callMCPTool('browser_fill', {})).rejects.toThrow(
      /missing required parameters: target, value/
    );
  });

  it('treats an explicit null as missing', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await expect(
      callMCPTool('agent_spawn', { agentType: null })
    ).rejects.toThrow(/missing required parameter: agentType/);
  });

  it('allows falsy-but-present values through — only missing/null is rejected', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    // session_info reads but never writes, so this asserts the guard's
    // behaviour without spawning or mutating anything. An empty string is a
    // present value: it must reach the handler, which then reports its own
    // not-found result rather than the guard's error.
    await expect(callMCPTool('session_info', { sessionId: '' })).resolves.toBeDefined();
  });

  it('does not block tools that declare no required params', async () => {
    const { callMCPTool } = await import('../mcp-client.js');
    await expect(callMCPTool('agent_list', {})).resolves.toBeDefined();
  });
});

describe('false contracts exposed by enforcement', () => {
  it('agent_pool does not declare `action` required — its handler defaults to status', async () => {
    const { agentTools } = await import('../mcp-tools/agent-tools.js');
    const pool = agentTools.find(t => t.name === 'agent_pool');
    expect(pool).toBeDefined();
    // The CLI `agent pool` command calls this tool with no `action` and relies
    // on the handler's documented default. Declaring it required broke that.
    expect(pool!.inputSchema.required ?? []).not.toContain('action');
  });

  it('session_info does not declare `sessionId` required', async () => {
    const { sessionTools } = await import('../mcp-tools/session-tools.js');
    const info = sessionTools.find(t => t.name === 'session_info');
    expect(info!.inputSchema.required ?? []).not.toContain('sessionId');
  });

  it('session_info declares includeStats, which the CLI actually passes', async () => {
    const { sessionTools } = await import('../mcp-tools/session-tools.js');
    const info = sessionTools.find(t => t.name === 'session_info');
    expect(info!.inputSchema.properties).toHaveProperty('includeStats');
  });
});

describe('session_info resolves the current session (regression: always "not found")', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    prevCwd = process.env.MONOMIND_CWD;
    dir = mkdtempSync(join(tmpdir(), 'mm-session-info-'));
    process.env.MONOMIND_CWD = dir;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a clear message when there are no sessions at all', async () => {
    const { sessionTools } = await import('../mcp-tools/session-tools.js');
    const info = sessionTools.find(t => t.name === 'session_info')!;
    const result = (await info.handler({}, undefined)) as Record<string, unknown>;
    expect(result.error).toBe('No saved sessions found');
  });

  it('falls back to the most recently saved session when no id is given', async () => {
    const { sessionTools } = await import('../mcp-tools/session-tools.js');
    const save = sessionTools.find(t => t.name === 'session_save')!;
    const info = sessionTools.find(t => t.name === 'session_info')!;

    await save.handler({ name: 'older' }, undefined);
    // savedAt has second-level granularity in the stored record; make the
    // ordering unambiguous rather than depending on tie-break behaviour.
    await new Promise(r => setTimeout(r, 1100));
    await save.handler({ name: 'newest' }, undefined);

    const result = (await info.handler({ includeStats: true }, undefined)) as Record<string, unknown>;
    // Previously this returned {error: 'Session not found'} unconditionally:
    // the undefined id reached getSessionPath(), threw on `.replace`, and was
    // swallowed by loadSession()'s catch.
    expect(result.error).toBeUndefined();
    expect(result.name).toBe('newest');
  });

  it('still honours an explicit sessionId', async () => {
    const { sessionTools } = await import('../mcp-tools/session-tools.js');
    const save = sessionTools.find(t => t.name === 'session_save')!;
    const info = sessionTools.find(t => t.name === 'session_info')!;

    const saved = (await save.handler({ name: 'explicit' }, undefined)) as Record<string, unknown>;
    await new Promise(r => setTimeout(r, 1100));
    await save.handler({ name: 'newer-but-not-asked-for' }, undefined);

    const result = (await info.handler(
      { sessionId: saved.sessionId as string },
      undefined
    )) as Record<string, unknown>;
    expect(result.name).toBe('explicit');
  });
});
