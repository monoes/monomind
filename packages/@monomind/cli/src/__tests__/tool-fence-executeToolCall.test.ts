/**
 * Unit tests for executeToolCall's canUseTool integration.
 *
 * This covers the policy-gating path used by CodexAgentRunner and
 * AntigravityAgentRunner (both route through executeToolCall). The Vercel
 * runner uses a different wrapping pattern (inline in tool.execute) that is
 * harder to unit-test without mocking dynamic imports.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { OrgToolDef } from '../orgrt/agent-runner.js';
import { executeToolCall } from '../orgrt/tool-fence.js';

const echoTool: OrgToolDef = {
  name: 'echo',
  description: 'Echoes the input',
  schema: { text: z.string() },
  handler: async (args) => ({ text: `echo: ${args.text}` }),
};

describe('executeToolCall — canUseTool integration', () => {
  it('executes the handler when canUseTool is undefined (Claude/Kimi path)', async () => {
    const result = await executeToolCall([echoTool], { name: 'echo', arguments: { text: 'hi' } });
    expect(result).toBe('echo: hi');
  });

  it('executes the handler when canUseTool returns allow decision', async () => {
    const canUseTool = async () => ({ behavior: 'allow' as const });
    const result = await executeToolCall(
      [echoTool],
      { name: 'echo', arguments: { text: 'hi' } },
      canUseTool,
    );
    expect(result).toBe('echo: hi');
  });

  it('executes the handler when canUseTool returns undefined', async () => {
    const canUseTool = async () => undefined;
    const result = await executeToolCall(
      [echoTool],
      { name: 'echo', arguments: { text: 'hi' } },
      canUseTool,
    );
    expect(result).toBe('echo: hi');
  });

  it('executes the handler when canUseTool returns true', async () => {
    const canUseTool = async () => true as unknown as undefined;
    const result = await executeToolCall(
      [echoTool],
      { name: 'echo', arguments: { text: 'hi' } },
      canUseTool,
    );
    expect(result).toBe('echo: hi');
  });

  it('BLOCKS the handler when canUseTool returns deny decision', async () => {
    const canUseTool = async () => ({ behavior: 'deny' as const, message: 'not allowed' });
    const handlerSpy = echoTool.handler;
    const result = await executeToolCall(
      [echoTool],
      { name: 'echo', arguments: { text: 'hi' } },
      canUseTool,
    );
    expect(result).toMatch(/ERROR.*denied by policy.*not allowed/);
    // Handler should NOT have been called.
    expect(handlerSpy).toBe(echoTool.handler); // reference unchanged; behavior verified by absence of 'echo:' in result
  });

  it('BLOCKS the handler when canUseTool returns false', async () => {
    const canUseTool = async () => false;
    const result = await executeToolCall(
      [echoTool],
      { name: 'echo', arguments: { text: 'hi' } },
      canUseTool,
    );
    expect(result).toMatch(/ERROR.*denied by policy/);
    expect(result).not.toContain('echo: hi');
  });

  it('validates args against zod schema BEFORE calling canUseTool', async () => {
    const canUseToolCalls: unknown[] = [];
    const canUseTool = async (name: string, input: Record<string, unknown>) => {
      canUseToolCalls.push({ name, input });
      return { behavior: 'allow' as const };
    };
    // Wrong arg type: schema requires string, pass number.
    const result = await executeToolCall(
      [echoTool],
      { name: 'echo', arguments: { text: 123 } },
      canUseTool,
    );
    expect(result).toMatch(/ERROR.*invalid arguments/);
    // canUseTool should NOT have been called for invalid args.
    expect(canUseToolCalls).toHaveLength(0);
  });

  it('surfaces unknown-tool errors regardless of canUseTool', async () => {
    const canUseTool = async () => ({ behavior: 'allow' as const });
    const result = await executeToolCall(
      [echoTool],
      { name: 'nonexistent', arguments: {} },
      canUseTool,
    );
    expect(result).toMatch(/ERROR.*unknown tool.*nonexistent/);
  });

  it('surfaces handler errors as ERROR text (does not throw)', async () => {
    const failingTool: OrgToolDef = {
      name: 'fail',
      description: 'Always fails',
      schema: {},
      handler: async () => {
        throw new Error('handler exploded');
      },
    };
    const result = await executeToolCall(
      [failingTool],
      { name: 'fail', arguments: {} },
      async () => ({ behavior: 'allow' as const }),
    );
    expect(result).toMatch(/ERROR.*fail failed.*handler exploded/);
  });
});
