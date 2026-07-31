// packages/@monomind/cli/__tests__/orgrt/org-visualize.test.ts
// Tests for org flow visualization command
import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandContext } from '../../src/commands/types.js';
import { orgVisualize } from '../../src/commands/org-visualize.js';

describe('org visualize command', () => {
  const testRoot = '/tmp/org-visualize-test';
  const orgName = 'test-org';
  const runId = 'run-20250131120000-abc';

  beforeEach(() => {
    // Clean up test directory
    try { rmSync(testRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    // Create test org structure
    mkdirSync(join(testRoot, '.monomind', 'orgs', orgName, runId), { recursive: true });

    // Write sample bus events
    const events = [
      { ts: 1706712000000, org: orgName, run: runId, type: 'status', from: 'boss', msg: 'org started' },
      { ts: 1706712010000, org: orgName, run: runId, type: 'message', from: 'boss', to: 'worker', subject: 'task', msg: 'do work' },
      { ts: 1706712020000, org: orgName, run: runId, type: 'message', from: 'worker', to: 'boss', subject: 'result', msg: 'done' },
    ];
    writeFileSync(join(testRoot, '.monomind', 'orgs', orgName, runId, 'bus.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));
  });

  it('should generate Mermaid flow diagram from org events', async () => {
    const ctx: CommandContext = {
      cwd: testRoot,
      args: [orgName],
      flags: {},
    };

    const result = await orgVisualize(ctx, orgName);

    expect(result.success).toBe(true);
    expect(result.message).toContain(orgName);
    expect(result.message).toContain(runId);
  });

  it('should handle missing run gracefully', async () => {
    const ctx: CommandContext = {
      cwd: testRoot,
      args: [orgName],
      flags: { run: 'nonexistent-run' },
    };

    const result = await orgVisualize(ctx, orgName);

    expect(result.success).toBe(false);
    expect(result.message).toContain('no runs found');
  });

  it('should handle org with no events gracefully', async () => {
    // Create empty run directory
    const emptyRun = 'run-20250131130000-empty';
    mkdirSync(join(testRoot, '.monomind', 'orgs', orgName, emptyRun), { recursive: true });
    writeFileSync(join(testRoot, '.monomind', 'orgs', orgName, emptyRun, 'bus.jsonl'), '');

    const ctx: CommandContext = {
      cwd: testRoot,
      args: [orgName],
      flags: { run: emptyRun },
    };

    const result = await orgVisualize(ctx, orgName);

    expect(result.success).toBe(false);
    expect(result.message).toContain('no recorded events');
  });
});
