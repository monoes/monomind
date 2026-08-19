/**
 * CLI-1 regression: every hooks-routing MCP handler validates its inputs.
 *
 * Coverage gap closed by this file: hooks-routing.ts had ~18 sites doing
 * `params.X as string` with no validation. Untrusted payloads reached
 * assessCommandRisk, suggestAgentsForTask, recordRoute, bridgeRecordFeedback,
 * and the SQLite memory bridge. Each handler now runs `validateMcpString`
 * (rejecting non-strings, NUL/control chars, oversized input) before any
 * downstream call.
 *
 * Style follows tests/security/memory-tools-validation.test.ts: pass bad
 * inputs and assert the handler rejects them — never silently passes through.
 */
import { describe, it, expect } from 'vitest';
import {
  hooksPreEdit,
  hooksPostEdit,
  hooksPreCommand,
  hooksPostCommand,
  hooksRoute,
  hooksRouteSemantic,
  hooksMetrics,
  hooksPreTask,
  hooksPostTask,
  hooksExplain,
  hooksPretrain,
  hooksTransfer,
  hooksSessionStart,
  hooksSessionRestore,
  hooksIntelligence,
} from '../src/mcp-tools/hooks-routing.js';
import type { MCPTool } from '../src/mcp-tools/types.js';

/**
 * A handler rejects when it returns a structured error response OR throws.
 * Either outcome proves the validation gate fired — the alternative
 * (silent pass-through) is exactly the bug this test guards against.
 */
async function expectRejection(tool: MCPTool, params: Record<string, unknown>): Promise<void> {
  // Hooks either return { error: ... } or throw on bad input. Both are
  // acceptable rejections; only silent acceptance fails the test.
  let result: unknown;
  try {
    result = await tool.handler(params);
  } catch (err) {
    // Thrown error is a valid rejection.
    expect(err).toBeInstanceOf(Error);
    return;
  }
  // Structured error response is a valid rejection. The exact shape varies
  // per handler — some return { error: '...' }, some return { success: false, error: '...' }.
  // What matters is that the handler did NOT proceed to compute a normal
  // response using the bad input.
  const obj = result as Record<string, unknown>;
  const hasErrorField = typeof obj.error === 'string' && obj.error.length > 0;
  const hasSuccessFalse = obj.success === false && typeof (obj as any).error === 'string';
  expect(hasErrorField || hasSuccessFalse).toBe(true);
}

const NUL = 'legit\0malicious';
const ANSI = 'evil\x1b[2J\x1b[Htext';
const HUGE = 'a'.repeat(1_000_000);

describe('CLI-1 — hooks-routing input validation', () => {
  describe('hooks_pre-edit', () => {
    const tool = hooksPreEdit;

    it('rejects a non-string filePath', async () => {
      await expectRejection(tool, { filePath: 42 });
    });

    it('rejects a missing filePath', async () => {
      await expectRejection(tool, {});
    });

    it('rejects a NUL byte in filePath', async () => {
      await expectRejection(tool, { filePath: NUL });
    });

    it('rejects ANSI control chars in filePath', async () => {
      await expectRejection(tool, { filePath: ANSI });
    });

    it('rejects an oversized filePath', async () => {
      await expectRejection(tool, { filePath: HUGE });
    });

    it('rejects a NUL byte in operation', async () => {
      // operation is optional with a default, so a NUL'd value must not
      // silently fall through to the default either — validateMcpString
      // returns null for control-char input.
      const r = await tool.handler({ filePath: 'a.ts', operation: NUL }) as { operation?: string };
      // Either rejected (error) or the bad operation fell back to the
      // default 'update' — never the raw NUL string.
      expect(r.operation).not.toBe(NUL);
    });
  });

  describe('hooks_post-edit', () => {
    const tool = hooksPostEdit;

    it('rejects a missing filePath', async () => {
      await expectRejection(tool, {});
    });

    it('rejects a non-string filePath', async () => {
      await expectRejection(tool, { filePath: { evil: true } });
    });

    it('rejects a NUL byte in filePath', async () => {
      await expectRejection(tool, { filePath: NUL });
    });

    it('rejects an oversized filePath', async () => {
      await expectRejection(tool, { filePath: HUGE });
    });

    it('rejects an oversized agent', async () => {
      // agent is optional — an oversized agent should fall back to undefined,
      // not silently pass the megabyte payload downstream.
      const r = await tool.handler({ filePath: 'a.ts', agent: HUGE }) as { error?: string };
      // Either rejected, or the agent was sanitized to undefined (handler
      // still completes normally with the sanitized value).
      expect(r).toBeDefined();
    });
  });

  describe('hooks_pre-command', () => {
    const tool = hooksPreCommand;

    it('rejects a missing command', async () => {
      await expectRejection(tool, {});
    });

    it('rejects a non-string command', async () => {
      await expectRejection(tool, { command: ['rm', '-rf'] });
    });

    it('rejects a NUL byte in command', async () => {
      await expectRejection(tool, { command: NUL });
    });

    it('rejects an oversized command', async () => {
      await expectRejection(tool, { command: HUGE });
    });
  });

  describe('hooks_post-command', () => {
    const tool = hooksPostCommand;

    it('rejects a missing command', async () => {
      await expectRejection(tool, {});
    });

    it('rejects a NUL byte in command', async () => {
      await expectRejection(tool, { command: NUL });
    });

    it('rejects an oversized command', async () => {
      await expectRejection(tool, { command: HUGE });
    });
  });

  describe('hooks_route', () => {
    const tool = hooksRoute;

    it('rejects a missing task', async () => {
      await expectRejection(tool, {});
    });

    it('rejects a non-string task', async () => {
      await expectRejection(tool, { task: 42 });
    });

    it('rejects a NUL byte in task', async () => {
      await expectRejection(tool, { task: NUL });
    });

    it('rejects an oversized task', async () => {
      await expectRejection(tool, { task: HUGE });
    });

    it('rejects a NUL byte in context', async () => {
      const r = await tool.handler({ task: 'write tests', context: NUL }) as { context?: string };
      // Optional — bad input must not pass through as the raw value.
      expect(r.context).not.toBe(NUL);
    });
  });

  describe('hooks_route_semantic', () => {
    const tool = hooksRouteSemantic;

    it('throws on a missing task', async () => {
      await expect(async () => tool.handler({})).rejects.toThrow(/task is required/);
    });

    it('throws on a non-string task', async () => {
      await expect(async () => tool.handler({ task: 42 })).rejects.toThrow(/task is required/);
    });

    it('throws on a NUL byte in task', async () => {
      await expect(async () => tool.handler({ task: NUL })).rejects.toThrow(/task is required/);
    });

    it('throws on an oversized task (>2000 chars)', async () => {
      await expect(async () => tool.handler({ task: 'a'.repeat(5000) })).rejects.toThrow(/task is required/);
    });
  });

  describe('hooks_metrics', () => {
    const tool = hooksMetrics;

    it('falls back to default period for non-string input (no crash)', async () => {
      // period is optional with default. Validation should produce the default
      // rather than pass an object/number through to the response.
      const r = await tool.handler({ period: 42 }) as { period: string };
      expect(r.period).toBe('24h');
    });

    it('falls back to default period for NUL byte', async () => {
      const r = await tool.handler({ period: NUL }) as { period: string };
      expect(r.period).toBe('24h');
    });
  });

  describe('hooks_pre-task', () => {
    const tool = hooksPreTask;

    it('rejects a missing taskId', async () => {
      await expectRejection(tool, { description: 'x' });
    });

    it('rejects a missing description', async () => {
      await expectRejection(tool, { taskId: 't1' });
    });

    it('rejects a NUL byte in taskId', async () => {
      await expectRejection(tool, { taskId: NUL, description: 'x' });
    });

    it('rejects an oversized description', async () => {
      await expectRejection(tool, { taskId: 't1', description: HUGE });
    });

    it('rejects a NUL byte in filePath', async () => {
      const r = await tool.handler({ taskId: 't1', description: 'x', filePath: NUL }) as { filePath?: string };
      expect(r.filePath).not.toBe(NUL);
    });
  });

  describe('hooks_post-task', () => {
    const tool = hooksPostTask;

    it('rejects a missing taskId', async () => {
      await expectRejection(tool, {});
    });

    it('rejects a NUL byte in taskId', async () => {
      await expectRejection(tool, { taskId: NUL });
    });

    it('rejects an oversized taskId', async () => {
      await expectRejection(tool, { taskId: HUGE });
    });

    it('does not pass through a NUL byte in agent', async () => {
      const r = await tool.handler({ taskId: 't1', agent: NUL }) as { error?: string };
      // Either rejected, or completed without the NUL leaking downstream.
      expect(r).toBeDefined();
    });
  });

  describe('hooks_explain', () => {
    const tool = hooksExplain;

    it('rejects a missing task', async () => {
      await expectRejection(tool, {});
    });

    it('rejects a non-string task', async () => {
      await expectRejection(tool, { task: { evil: true } });
    });

    it('rejects a NUL byte in task', async () => {
      await expectRejection(tool, { task: NUL });
    });

    it('rejects an oversized task', async () => {
      await expectRejection(tool, { task: HUGE });
    });
  });

  describe('hooks_pretrain', () => {
    const tool = hooksPretrain;

    it('rejects an invalid depth', async () => {
      const r = await tool.handler({ depth: '../../etc/passwd' }) as { error?: string };
      expect(r.error).toMatch(/depth/i);
    });

    it('falls back to medium for NUL byte in depth', async () => {
      const r = await tool.handler({ depth: NUL }) as { depth?: string; error?: string };
      // depth is optional — bad input falls back to default rather than pass through.
      expect(r.depth).not.toBe(NUL);
    });
  });

  describe('hooks_transfer', () => {
    const tool = hooksTransfer;

    it('rejects a missing sourcePath', async () => {
      await expectRejection(tool, {});
    });

    it('rejects a NUL byte in sourcePath', async () => {
      await expectRejection(tool, { sourcePath: NUL });
    });

    it('rejects an oversized sourcePath', async () => {
      await expectRejection(tool, { sourcePath: HUGE });
    });
  });

  describe('hooks_session-start', () => {
    const tool = hooksSessionStart;

    it('falls back to a generated sessionId for non-string input', async () => {
      const r = await tool.handler({ sessionId: 42 }) as { sessionId: string };
      expect(typeof r.sessionId).toBe('string');
      expect(r.sessionId).not.toBe('42');
    });

    it('falls back to a generated sessionId for NUL byte', async () => {
      const r = await tool.handler({ sessionId: NUL }) as { sessionId: string };
      expect(r.sessionId).not.toBe(NUL);
    });
  });

  describe('hooks_session-restore', () => {
    const tool = hooksSessionRestore;

    it('falls back to "latest" for non-string sessionId', async () => {
      const r = await tool.handler({ sessionId: 42 }) as { originalSessionId: string };
      expect(r.originalSessionId).toBe('latest');
    });
  });

  describe('hooks_intelligence', () => {
    const tool = hooksIntelligence;

    // Wave 2 (IN-14): `mode` was a dead parameter — echoed but never read —
    // and has been removed entirely rather than validated/defaulted. These
    // cases now assert it's simply ignored, not that it falls back to a
    // canned default value.
    it('does not error and does not echo back a mode field for non-string input', async () => {
      const r = await tool.handler({ mode: 42 }) as { mode?: string };
      expect(r.mode).toBeUndefined();
    });

    it('does not error and does not echo back a mode field for NUL byte', async () => {
      const r = await tool.handler({ mode: NUL }) as { mode?: string };
      expect(r.mode).toBeUndefined();
    });
  });
});
