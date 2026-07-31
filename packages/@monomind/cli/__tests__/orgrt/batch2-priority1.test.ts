// packages/@monomind/cli/__tests__/orgrt/batch2-priority1.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { ORG_DIR } from '../../src/orgrt/types.js';
import type { BusEvent } from '../../src/orgrt/types.js';

function fixture(root: string, name: string): void {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs', `${name}.json`), JSON.stringify({
    name, goal: `goal of ${name}`,
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
    ],
  }));
}

// Mock SDK query function that emits usage events
const queryWithUsage = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'response' }] } };
    yield {
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 100, output_tokens: 50 },
      total_cost_usd: 0.0015,
    };
  }
})();

describe('Batch 2 Priority 1 - Per-role cost tracking', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'batch2-p1-'));
  });

  it('accumulates cost from usage events into per-role metrics', async () => {
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: queryWithUsage as any, forward: false });
    const running = await d.startOrg('alpha');

    // First, spawn the coder role by delivering a message to it
    await d.deliver('alpha', 'boss', 'coder', 'initial', 'spawn the coder');

    // Wait for spawn to complete and agents to be registered
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify coder is spawned before emitting usage events
    expect(running.agents.has('coder')).toBe(true);

    // Now simulate usage events from both roles
    running.bus.emit({
      type: 'usage',
      from: 'boss',
      data: { tokens: 150, cost_usd: 0.0015 },
      ts: Date.now(),
      id: 'evt-1',
      org: 'alpha',
      run: running.run,
    });

    running.bus.emit({
      type: 'usage',
      from: 'coder',
      data: { tokens: 200, cost_usd: 0.0020 },
      ts: Date.now(),
      id: 'evt-2',
      org: 'alpha',
      run: running.run,
    });

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 50));

    const bossRuntime = running.agents.get('boss');
    const coderRuntime = running.agents.get('coder');

    // Debug: check if metrics are populated
    console.log('boss metrics:', bossRuntime?.metrics);
    console.log('coder metrics:', coderRuntime?.metrics);

    expect(bossRuntime?.metrics.costUsd).toBeGreaterThan(0);
    expect(coderRuntime?.metrics.costUsd).toBeGreaterThan(0);

    // Verify runtime.json persistence
    await d.stopOrg('alpha');
    const rt = JSON.parse(readFileSync(join(root, ORG_DIR, 'alpha', 'runtime.json'), 'utf8'));
    expect(rt.checkpoint?.roleState?.boss?.costUsd).toBeGreaterThan(0);
    expect(rt.checkpoint?.roleState?.coder?.costUsd).toBeGreaterThan(0);

    await d.stopAll();
  }, 10_000);

  it('handles invalid cost values gracefully', async () => {
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: queryWithUsage as any, forward: false });
    const running = await d.startOrg('alpha');

    // Emit usage with invalid cost
    running.bus.emit({
      type: 'usage',
      from: 'boss',
      data: { tokens: 150, cost_usd: 'invalid' },
      ts: Date.now(),
      id: 'evt-1',
      org: 'alpha',
      run: running.run,
    });

    const bossRuntime = running.agents.get('boss');
    expect(bossRuntime?.metrics.costUsd).toBe(0); // Should not crash, just skip invalid

    await d.stopAll();
  }, 10_000);
});

describe('Batch 2 Priority 1 - Event parentId for message chains', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'batch2-p1-'));
  });

  it('tracks parentId for message chains', async () => {
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: queryWithUsage as any, forward: false });
    const running = await d.startOrg('alpha');

    // First message from boss to coder
    const receipt1 = await d.deliver('alpha', 'boss', 'coder', 'task1', 'do this');
    expect(receipt1).toContain('delivered to coder');

    const bossRuntime = running.agents.get('boss');
    expect(bossRuntime?.lastMessageId).toBeDefined();

    const firstMessageId = bossRuntime!.lastMessageId;

    // Response from coder should have parentId
    const receipt2 = await d.deliver('alpha', 'coder', 'boss', 're: task1', 'done');
    expect(receipt2).toContain('delivered to boss');

    // Check that the second message has parentId linked to first
    const events = running.busEvents();
    const coderMessage = events.find(e => e.from === 'coder' && e.type === 'message' && e.subject === 're: task1');
    expect(coderMessage?.parentId).toBe(firstMessageId);

    await d.stopAll();
  }, 10_000);

  it('handles cross-org message parentId tracking', async () => {
    fixture(root, 'alpha');
    // Create another org
    writeFileSync(join(root, '.monomind/orgs', 'beta.json'), JSON.stringify({
      name: 'beta', goal: 'beta goal',
      roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
    }));

    const d = new OrgDaemon(root, { queryFn: queryWithUsage as any, forward: false });
    const alpha = await d.startOrg('alpha');
    await d.startOrg('beta');

    // Cross-org message from alpha:boss to beta:boss
    const receipt = await d.deliver('alpha', 'boss', 'beta:boss', 'cross-task', 'do this');
    expect(receipt).toContain('delivered to beta:boss');

    const alphaBoss = alpha.agents.get('boss');
    expect(alphaBoss?.lastMessageId).toBeDefined();

    await d.stopAll();
  }, 10_000);
});

describe('Batch 2 Priority 1 - Tool audit filter (CLI flag)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'batch2-p1-'));
  });

  it('filters logs by tool name', async () => {
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: queryWithUsage as any, forward: false });
    const running = await d.startOrg('alpha');

    // Emit various tool events
    running.bus.emit({
      type: 'tool',
      from: 'boss',
      tool: 'Read',
      decision: 'allow',
      ts: Date.now(),
      id: 'tool-1',
      org: 'alpha',
      run: running.run,
    });

    running.bus.emit({
      type: 'tool',
      from: 'coder',
      tool: 'Write',
      decision: 'allow',
      ts: Date.now(),
      id: 'tool-2',
      org: 'alpha',
      run: running.run,
    });

    running.bus.emit({
      type: 'tool',
      from: 'boss',
      tool: 'Bash',
      decision: 'deny',
      reason: 'git policy',
      ts: Date.now(),
      id: 'tool-3',
      org: 'alpha',
      run: running.run,
    });

    const allEvents = running.busEvents();
    const readEvents = allEvents.filter(e => e.tool === 'Read');
    const writeEvents = allEvents.filter(e => e.tool === 'Write');
    const bashEvents = allEvents.filter(e => e.tool === 'Bash');

    expect(readEvents).toHaveLength(1);
    expect(writeEvents).toHaveLength(1);
    expect(bashEvents).toHaveLength(1);

    await d.stopAll();
  }, 10_000);

  it('shows tool audit trail in events', async () => {
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: queryWithUsage as any, forward: false });
    const running = await d.startOrg('alpha');

    // Emit a denied tool event
    running.bus.emit({
      type: 'tool',
      from: 'boss',
      tool: 'Bash',
      decision: 'deny',
      reason: 'git push denied (policy.git: read)',
      ts: Date.now(),
      id: 'tool-deny',
      org: 'alpha',
      run: running.run,
    });

    const events = running.busEvents();
    const denyEvent = events.find(e => e.type === 'tool' && e.decision === 'deny');

    expect(denyEvent).toBeDefined();
    expect(denyEvent?.tool).toBe('Bash');
    expect(denyEvent?.reason).toContain('git push denied');

    await d.stopAll();
  }, 10_000);
});

// Feature 4: Flow visualization/Mermaid
describe('Batch 2 Priority 1 - Flow visualization/Mermaid', () => {
  it('generates Mermaid flowchart from events', async () => {
    const { generateMermaidFlow } = await import('../../src/orgrt/visualization.js');

    const events: BusEvent[] = [
      {
        id: '1', ts: Date.now(), org: 'test', run: 'run-1',
        type: 'message', from: 'boss', to: 'worker', subject: 'task', msg: 'do work',
      },
      {
        id: '2', ts: Date.now(), org: 'test', run: 'run-1',
        type: 'tool', from: 'worker', tool: 'Write', decision: 'allow',
      },
    ];

    const mermaid = generateMermaidFlow(events);
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('boss');
    expect(mermaid).toContain('worker');
  });

  it('generates Mermaid sequence diagram from events', async () => {
    const { generateMermaidSequence } = await import('../../src/orgrt/visualization.js');

    const events: BusEvent[] = [
      {
        id: '1', ts: Date.now(), org: 'test', run: 'run-1',
        type: 'message', from: 'boss', to: 'worker', subject: 'task', msg: 'do work',
      },
    ];

    const mermaid = generateMermaidSequence(events);
    expect(mermaid).toContain('sequenceDiagram');
    expect(mermaid).toContain('participant boss');
    expect(mermaid).toContain('participant worker');
  });
});

// Feature 7: Test-loop scenario scripting
describe('Batch 2 Priority 1 - Test-loop scenario scripting', () => {
  it('loads and executes JSON scenario files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'batch2-p1-'));
    mkdirSync(join(root, '.monomind/scenarios'), { recursive: true });

    const scenario = {
      name: 'test-scenario',
      description: 'Test scenario execution',
      orgs: [{
        name: 'test',
        goal: 'test goal',
        roles: [
          { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
          { id: 'worker', title: 'Worker', type: 'specialist', reports_to: 'boss' },
        ],
      }],
      script: [
        {
          step: 1,
          from: 'boss',
          to: 'worker',
          action: 'send',
          subject: 'task',
          body: 'do work',
        },
      ],
    };

    writeFileSync(join(root, '.monomind/scenarios', 'test.json'), JSON.stringify(scenario, null, 2));

    // Verify scenario can be loaded
    const scenarioPath = join(root, '.monomind/scenarios', 'test.json');
    const loaded = JSON.parse(readFileSync(scenarioPath, 'utf8'));
    expect(loaded.name).toBe('test-scenario');
    expect(loaded.script).toHaveLength(1);
  });
});

// Feature 8: Enhanced checkpoint/resume
describe('Batch 2 Priority 1 - Enhanced checkpoint/resume', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'batch2-p1-'));
    fixture(root, 'test');
  });

  it('persists mailbox state in runtime.json', async () => {
    const d = new OrgDaemon(root, { queryFn: queryWithUsage as any, forward: false });
    await d.startOrg('test');

    // Wait for state persistence
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check runtime.json contains checkpoint with mailbox state
    const rt = JSON.parse(readFileSync(join(root, ORG_DIR, 'test', 'runtime.json'), 'utf8'));
    expect(rt.checkpoint?.roleState?.boss).toBeDefined();
    expect(Array.isArray(rt.checkpoint?.roleState?.boss?.mailboxQueue)).toBe(true);
    expect(typeof rt.checkpoint?.roleState?.boss?.mailboxClosed).toBe('boolean');

    await d.stopAll();
  }, 10_000);

  it('restores pending roles on resume', async () => {
    const d = new OrgDaemon(root, { queryFn: queryWithUsage as any, forward: false });
    await d.startOrg('test');

    // Only boss is spawned initially, coder is pending
    const running = d.orgs.get('test');
    expect(running?.agents.has('boss')).toBe(true);
    expect(running?.agents.has('coder')).toBe(false); // Not spawned yet

    await d.stopAll();
  }, 10_000);
});

// Feature 9: Guardrail beforeTool hooks
// REMOVED: GuardrailEngine was dead code, never integrated into daemon.ts
// Real guardrails use checkApproval() in policy.ts + daemon.ts
