import { describe, it, expect, afterEach } from 'vitest';
import { startDashboard, getDashboard } from '../browser/dashboard/server.js';
import type { StepEvent, RunRecord } from '../browser/workflow/types.js';

const PORT = 14242; // Use non-conflicting test port

afterEach(() => {
  getDashboard()?.close();
});

function makeEvent(overrides: Partial<StepEvent> = {}): StepEvent {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    workflowName: 'Test WF',
    nodeId: 'node-1',
    nodeName: 'Test Node',
    eventType: 'step_completed',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('startDashboard', () => {
  it('returns a dashboard server instance', async () => {
    const dash = startDashboard(PORT);
    expect(dash).toBeDefined();
    expect(dash.port).toBe(PORT);
  });

  it('returns the same instance on repeated calls', async () => {
    const a = startDashboard(PORT);
    const b = startDashboard(PORT);
    expect(a).toBe(b);
  });

  it('serves HTML at GET /', async () => {
    startDashboard(PORT);
    const res = await fetch(`http://localhost:${PORT}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('monobrowse');
  });

  it('GET /runs returns JSON array', async () => {
    const dash = startDashboard(PORT);
    const run: RunRecord = { id: 'r1', workflowId: 'wf', workflowName: 'WF', status: 'completed', startedAt: Date.now(), itemsProcessed: 1, itemsTotal: 1 };
    dash.addRunRecord(run);
    const res = await fetch(`http://localhost:${PORT}/runs`);
    expect(res.status).toBe(200);
    const body = await res.json() as RunRecord[];
    expect(body.some(r => r.id === 'r1')).toBe(true);
  });

  it('POST /stop/:runId marks run as stop-requested', async () => {
    const dash = startDashboard(PORT);
    const res = await fetch(`http://localhost:${PORT}/stop/run-abc`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(dash.isStopRequested('run-abc')).toBe(true);
  });

  it('isStopRequested returns false for unknown runId', () => {
    const dash = startDashboard(PORT);
    expect(dash.isStopRequested('nonexistent')).toBe(false);
  });
});
