// packages/@monomind/cli/__tests__/orgrt/tool-fence.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildToolProtocol } from '../../src/orgrt/tool-fence.js';
import type { OrgToolDef } from '../../src/orgrt/agent-runner.js';

const tool = (name: string, schema: OrgToolDef['schema']): OrgToolDef => ({
  name, description: `${name} description`, schema,
  handler: async () => ({ text: 'ok' }),
});

describe('buildToolProtocol — describeZod rendering', () => {
  it('renders enum literals joined with | instead of a bare "value"', () => {
    const p = buildToolProtocol([tool('org_complete', { outcome: z.enum(['achieved', 'partial', 'failed']), summary: z.string() })]);
    expect(p).toContain('outcome: achieved|partial|failed');
    expect(p).toContain('summary: string');
  });

  it('renders an optional enum as "optional a|b"', () => {
    const p = buildToolProtocol([tool('org_remember', { content: z.string(), scope: z.enum(['org', 'agent']).optional() })]);
    expect(p).toContain('scope: optional org|agent');
  });

  it('unwraps and marks nullable and default wrappers', () => {
    const p = buildToolProtocol([tool('t', {
      maybe: z.string().nullable(),
      withDefault: z.number().default(3),
      maybeEnum: z.enum(['x', 'y']).nullable(),
    })]);
    expect(p).toContain('maybe: nullable string');
    expect(p).toContain('withDefault: optional number');
    expect(p).toContain('maybeEnum: nullable x|y');
  });

  it('keeps the exact fence syntax block and the wait-for-result rule', () => {
    const p = buildToolProtocol([tool('t', { q: z.string() })]);
    expect(p).toContain('```tool_call\n{"name": "<tool-name>", "arguments": { ... }}\n```');
    expect(p).toContain('```tool_result');
    expect(p).toMatch(/wait for/);
  });
});
