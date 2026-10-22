/** #677: an agent must not approve a monoagent__automation_* call (it may send a message to a person). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { approveAction, denyAction } from '../commands/org-observe.js';
import type { CommandContext } from '../types.js';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'mm677-infra-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

const ctx = (action: string): CommandContext =>
  ({
    args: ['o', 'boss', action],
    flags: {},
    cwd,
    interactive: false,
  }) as unknown as CommandContext;

describe('org approve of automation calls (#677)', () => {
  for (const marker of ['MONOMIND_AGENT_EXEC', 'CLAUDECODE', 'MONOMIND_ORG_ROLE']) {
    it(`refuses approving monoagent__automation_* when ${marker} is set`, async () => {
      vi.stubEnv(marker, '1');
      const r = await approveAction(ctx('monoagent__automation_send_email'), 'o');
      expect(r.success).toBe(false);
      expect(r.message).toMatch(/refused: agent context detected/);
    });
  }

  it('still lets an agent deny an automation call', async () => {
    vi.stubEnv('MONOMIND_AGENT_EXEC', '1');
    const r = await denyAction(ctx('monoagent__automation_send_email'), 'o');
    expect(r.message ?? '').not.toMatch(/refused: agent context/);
  });

  it('does not block approving other actions from an agent context', async () => {
    vi.stubEnv('MONOMIND_AGENT_EXEC', '1');
    const r = await approveAction(ctx('Bash'), 'o');
    expect(r.message ?? '').not.toMatch(/refused: agent context/);
  });
});
