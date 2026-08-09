/**
 * `POST /api/mastermind/event` on the monobrowse workflow dashboard used to
 * accept and broadcast ANY parseable JSON verbatim to every connected
 * WebSocket client, no auth, no schema, no Origin check. ui.html then wrote
 * several of those attacker-controlled fields into innerHTML unescaped —
 * including one spliced into a single-quoted JS string inside an inline
 * onclick handler, which is a JS-string breakout, not just HTML injection.
 *
 * These tests exercise the server-side half of the fix: a same-origin-only
 * check (browsers always set Origin on a cross-origin POST) and strict
 * schema validation before anything is broadcast.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDashboardServer } from '../browser/dashboard/server.js';

describe('POST /api/mastermind/event', () => {
  let base: string;
  let close: () => void;

  const validEvent = {
    runId: 'run-1', workflowId: 'wf-1', workflowName: 'Build and publish',
    nodeId: 'node-1', nodeName: 'fetch', eventType: 'step_started', timestamp: 1,
  };

  beforeAll(async () => {
    const server = getDashboardServer(0);
    // The server binds synchronously inside getDashboardServer; give the event
    // loop a tick so httpServer.address() reflects the real ephemeral port.
    await new Promise((r) => setTimeout(r, 20));
    const addr = server.address();
    if (!addr) throw new Error('dashboard server did not bind');
    base = `http://127.0.0.1:${addr.port}`;
    close = server.close;
  });

  afterAll(() => {
    close();
  });

  it('accepts a well-formed StepEvent with no Origin header (the legitimate cross-process forwarder case)', async () => {
    const res = await fetch(`${base}/api/mastermind/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validEvent),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('accepts a same-origin POST (Origin host matches Host)', async () => {
    const res = await fetch(`${base}/api/mastermind/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify(validEvent),
    });
    expect(res.status).toBe(200);
  });

  it('rejects a cross-origin POST before even looking at the body', async () => {
    const res = await fetch(`${base}/api/mastermind/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example.com' },
      body: JSON.stringify(validEvent),
    });
    expect(res.status).toBe(403);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(false);
  });

  it('rejects a payload with fields outside the StepEvent schema', async () => {
    const res = await fetch(`${base}/api/mastermind/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validEvent, workflowName: { toString: () => 'not a plain string' } }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(false);
  });

  it('rejects an unrecognized eventType', async () => {
    const res = await fetch(`${base}/api/mastermind/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validEvent, eventType: 'not_a_real_event_type' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await fetch(`${base}/api/mastermind/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('broadcasts only the schema-validated event, not the raw attacker-supplied body', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`${base.replace('http', 'ws')}/`);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });

    const received: unknown[] = [];
    ws.on('message', (data: Buffer) => received.push(JSON.parse(data.toString())));

    // Extra, non-schema field that a naive verbatim-relay would have broadcast unchanged.
    const withExtra = { ...validEvent, runId: 'run-2', evil: '<img src=x onerror=alert(1)>' };
    const res = await fetch(`${base}/api/mastermind/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withExtra),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));
    ws.close();

    const relayed = received.find((m): m is Record<string, unknown> =>
      typeof m === 'object' && m !== null && (m as Record<string, unknown>).runId === 'run-2');
    expect(relayed).toBeDefined();
    expect(relayed).not.toHaveProperty('evil');
  });
});
