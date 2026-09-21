/**
 * The transport seam under CdpClient.
 *
 * Two halves: WebSocketTransport must behave exactly as the inlined `ws`
 * handling it replaced (that is what keeps the 474 existing tests honest),
 * and CdpClient must drive *any* transport — the whole point of the seam,
 * since the bridge-backed one is not a socket to a local Chrome at all.
 */
import { describe, expect, it, vi } from 'vitest';

// --- fake `ws` -------------------------------------------------------------
let lastSocket: FakeWs | null = null;

class FakeWs {
  handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  sent: string[] = [];
  closed = false;
  sendError: Error | null = null;

  constructor(public url: string) {
    lastSocket = this;
  }

  on(event: string, fn: (...a: unknown[]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(fn);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(...args);
  }

  send(data: string, cb?: (err?: Error) => void): void {
    this.sent.push(data);
    cb?.(this.sendError ?? undefined);
  }

  close(): void {
    this.closed = true;
  }
}

vi.mock('ws', () => ({ WebSocket: FakeWs }));

const { WebSocketTransport } = await import('../browser/transport.js');
const { CdpClient } = await import('../browser/cdp.js');

import type { CdpTransport, CdpTransportHandlers } from '../browser/transport.js';

/** Collects what a transport hands back up to its owner. */
function recorder(): CdpTransportHandlers & {
  messages: string[];
  closes: Array<Error | undefined>;
} {
  const messages: string[] = [];
  const closes: Array<Error | undefined> = [];
  const errors: Error[] = [];
  return {
    messages,
    closes,
    message: (d: string) => void messages.push(d),
    close: (e?: Error) => void closes.push(e),
    error: (e: Error) => void errors.push(e),
  };
}

describe('WebSocketTransport', () => {
  it('opens on the socket "open" event and reports the url it dialed', async () => {
    const t = new WebSocketTransport('ws://127.0.0.1:9222/devtools/page/ABC');
    const p = t.open(recorder());
    lastSocket!.emit('open');
    await p;
    expect(lastSocket!.url).toBe('ws://127.0.0.1:9222/devtools/page/ABC');
  });

  it('rejects open() when the socket errors before it ever opened', async () => {
    const t = new WebSocketTransport('ws://127.0.0.1:1/devtools');
    const p = t.open(recorder());
    lastSocket!.emit('error', new Error('ECONNREFUSED'));
    await expect(p).rejects.toThrow('ECONNREFUSED');
  });

  it('routes a post-open error to error(), not to a rejected open()', async () => {
    const h = recorder();
    const errors: Error[] = [];
    h.error = (e: Error) => void errors.push(e);
    const t = new WebSocketTransport('ws://x');
    const p = t.open(h);
    lastSocket!.emit('open');
    await p;
    lastSocket!.emit('error', new Error('EPIPE'));
    expect(errors.map((e) => e.message)).toEqual(['EPIPE']);
  });

  it('delivers messages as strings and reports close', async () => {
    const h = recorder();
    const t = new WebSocketTransport('ws://x');
    const p = t.open(h);
    lastSocket!.emit('open');
    await p;
    lastSocket!.emit('message', Buffer.from('{"id":1}'));
    expect(h.messages).toEqual(['{"id":1}']);
    lastSocket!.emit('close');
    expect(h.closes).toHaveLength(1);
  });

  it('rejects send() with the socket error and closes the socket on close()', async () => {
    const t = new WebSocketTransport('ws://x');
    const p = t.open(recorder());
    lastSocket!.emit('open');
    await p;
    await expect(t.send('{"id":1}')).resolves.toBeUndefined();
    expect(lastSocket!.sent).toEqual(['{"id":1}']);
    lastSocket!.sendError = new Error('socket gone');
    await expect(t.send('{"id":2}')).rejects.toThrow('socket gone');
    t.close();
    expect(lastSocket!.closed).toBe(true);
  });
});

// --- CdpClient over an arbitrary transport ---------------------------------

/** A transport with no socket at all: the test *is* the other end. */
class ScriptedTransport implements CdpTransport {
  sent: string[] = [];
  closed = false;
  private handlers: CdpTransportHandlers | null = null;

  async open(handlers: CdpTransportHandlers): Promise<void> {
    this.handlers = handlers;
  }

  async send(frame: string): Promise<void> {
    this.sent.push(frame);
  }

  close(): void {
    this.closed = true;
  }

  /** Push a frame up as if it had arrived from the other side. */
  deliver(msg: unknown): void {
    this.handlers!.message(JSON.stringify(msg));
  }

  drop(err?: Error): void {
    this.handlers!.close(err);
  }
}

describe('CdpClient.connectTransport', () => {
  it('round-trips a command through a transport that is not a socket', async () => {
    const t = new ScriptedTransport();
    const client = new CdpClient();
    await client.connectTransport(t);
    expect(client.isConnected()).toBe(true);

    const pending = client.send<{ frameId: string }>('Page.navigate', { url: 'https://x.test' });
    const sent = JSON.parse(t.sent[0]);
    expect(sent.method).toBe('Page.navigate');
    expect(sent.params).toEqual({ url: 'https://x.test' });

    t.deliver({ id: sent.id, result: { frameId: 'F1' } });
    expect(await pending).toEqual({ frameId: 'F1' });
  });

  it('dispatches events with their sessionId to listeners', async () => {
    const t = new ScriptedTransport();
    const client = new CdpClient();
    await client.connectTransport(t);

    const seen: Array<[Record<string, unknown>, string | undefined]> = [];
    client.on('Network.responseReceived', (params, sid) => void seen.push([params, sid]));
    t.deliver({ method: 'Network.responseReceived', params: { requestId: 'R1' }, sessionId: 'S1' });

    expect(seen).toEqual([[{ requestId: 'R1' }, 'S1']]);
  });

  it('flushes in-flight commands when the transport drops', async () => {
    const t = new ScriptedTransport();
    const client = new CdpClient();
    await client.connectTransport(t);

    const pending = client.send('Page.enable');
    t.drop(new Error('bridge disconnected'));
    await expect(pending).rejects.toThrow('bridge disconnected');
    expect(client.isConnected()).toBe(false);
  });

  it('closes the transport when the client closes', async () => {
    const t = new ScriptedTransport();
    const client = new CdpClient();
    await client.connectTransport(t);
    client.close();
    expect(t.closed).toBe(true);
    await expect(client.send('Page.enable')).rejects.toThrow('CDP not connected');
  });
});
