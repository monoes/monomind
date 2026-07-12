// packages/@monomind/cli/__tests__/orgrt/e2e.test.ts
import { describe, it, expect } from 'vitest';
import { runTestLoop } from '../../src/orgrt/test-loop.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('org e2e verification', () => {
  it('one iteration verifies chats, comms, tools, assets, inter-org, and ws delivery', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-'));
    const report = await runTestLoop(root, 1);
    expect(report.failed).toBe(0);
    expect(report.iterations[0].checks).toMatchObject({
      chat: true, message: true, tool: true, asset: true, xorg: true, wsDelivery: true,
    });
  });

  it('loop runs N times and aggregates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e2-'));
    const report = await runTestLoop(root, 3);
    expect(report.iterations).toHaveLength(3);
    expect(report.summary).toMatch(/3\/3 passed/);
  });
});
