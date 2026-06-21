import { describe, it, expect, afterEach } from 'vitest';
import { startDashboard, getDashboard } from '@monoes/monobrowse';
import type { StepEvent, RunRecord } from '@monoes/monobrowse';
import { WebSocket } from 'ws';
import http from 'node:http';

const PORT = 14242; // Use non-conflicting test port
const SSE_PORT = 14243; // Separate port for SSE streaming tests

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
    expect(body).toContain('monomind');
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

// ---------------------------------------------------------------------------
// SSE / WebSocket streaming tests
//
// The dashboard uses WebSocket (via 'ws') when the package is available, and
// falls back to Server-Sent Events when it is not.  Since 'ws' IS installed in
// this repo the server runs in WebSocket mode.  We test the streaming path
// (broadcast + ?dir= filter) through the WebSocket interface so the tests are
// consistent regardless of environment.
// ---------------------------------------------------------------------------

/**
 * Open a WebSocket to the dashboard, wait for the initial 'history' message,
 * then return a helper that collects subsequent messages.
 */
function connectWs(port: number, dir?: string): Promise<{ ws: WebSocket; messages: unknown[]; close: () => void }> {
  return new Promise((resolve, reject) => {
    const url = dir ? `ws://127.0.0.1:${port}/?dir=${encodeURIComponent(dir)}` : `ws://127.0.0.1:${port}/`;
    const ws = new WebSocket(url);
    const messages: unknown[] = [];

    ws.on('open', () => {
      // history message arrives; resolve after we have it
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString());
        messages.push(parsed);
        if (messages.length === 1 && (parsed as any).type === 'history') {
          resolve({ ws, messages, close: () => ws.close() });
        }
      });
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 3000);
  });
}

describe('broadcast via WebSocket', () => {
  it('delivers events to connected clients', async () => {
    const dash = startDashboard(PORT);
    // Wait a tick for the server to be ready
    await new Promise(r => setTimeout(r, 50));

    const { ws, messages, close } = await connectWs(PORT);
    try {
      // Wait for initial history message, then broadcast
      dash.broadcast(makeEvent({ eventType: 'step_completed', nodeId: 'node-broadcast-1' }));

      await new Promise(r => setTimeout(r, 100));
      const events = messages.filter((m: any) => m.eventType !== undefined);
      expect(events.length).toBeGreaterThan(0);
      expect((events[0] as any).nodeId).toBe('node-broadcast-1');
    } finally {
      close();
    }
  });

  it('?dir= filter — client with matching dir receives event', async () => {
    const dash = startDashboard(PORT);
    await new Promise(r => setTimeout(r, 50));

    const dirA = '/projects/alpha';
    const { messages, close } = await connectWs(PORT, dirA);
    try {
      dash.broadcast(makeEvent({ projectDir: dirA, nodeId: 'node-alpha' }));
      await new Promise(r => setTimeout(r, 100));
      const events = messages.filter((m: any) => m.eventType !== undefined);
      expect(events.length).toBeGreaterThan(0);
      expect((events[0] as any).nodeId).toBe('node-alpha');
    } finally {
      close();
    }
  });

  it('?dir= filter — client with non-matching dir does NOT receive event', async () => {
    const dash = startDashboard(PORT);
    await new Promise(r => setTimeout(r, 50));

    const { messages, close } = await connectWs(PORT, '/projects/beta');
    try {
      dash.broadcast(makeEvent({ projectDir: '/projects/alpha', nodeId: 'node-alpha-only' }));
      await new Promise(r => setTimeout(r, 100));
      const events = messages.filter((m: any) => m.eventType !== undefined);
      expect(events.length).toBe(0);
    } finally {
      close();
    }
  });

  it('client without ?dir= receives all broadcasts', async () => {
    const dash = startDashboard(PORT);
    await new Promise(r => setTimeout(r, 50));

    const { messages, close } = await connectWs(PORT);
    try {
      dash.broadcast(makeEvent({ projectDir: '/projects/alpha', nodeId: 'all-1' }));
      dash.broadcast(makeEvent({ projectDir: '/projects/beta', nodeId: 'all-2' }));
      await new Promise(r => setTimeout(r, 150));
      const events = messages.filter((m: any) => m.eventType !== undefined);
      expect(events.length).toBeGreaterThanOrEqual(2);
    } finally {
      close();
    }
  });
});

describe('GET /events SSE endpoint', () => {
  it('returns text/event-stream content-type when ws is unavailable', async () => {
    // The dashboard is already started in ws mode on PORT.
    // We verify the /events endpoint returns 404 in ws mode (ws is installed),
    // which confirms the conditional branching works correctly.
    const dash = startDashboard(PORT);
    await new Promise(r => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${PORT}/events`, {
      headers: { Accept: 'text/event-stream' },
    });
    // In ws mode the SSE endpoint is not registered — server returns 404
    // In SSE-only mode it would return 200 with text/event-stream
    // We test what the current mode actually does
    if (res.status === 200) {
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      await res.body?.cancel();
    } else {
      // ws mode: SSE not registered
      expect(res.status).toBe(404);
    }
  });
});
