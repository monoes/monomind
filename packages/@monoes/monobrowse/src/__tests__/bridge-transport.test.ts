/**
 * The bridge-backed transport: CDP over the MonoAgent extension bridge.
 *
 * The end-to-end case runs against a real loopback WebSocket server standing
 * in for the Go relay and the extension behind it — no Chrome, but real
 * framing, real sockets, real asynchrony. That is the case that proves the
 * instruments work over the bridge, so it drives console capture (one of the
 * modules this whole seam exists for) rather than a bare send().
 */
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket as WsSocket } from 'ws';
import { WebSocketServer } from 'ws';
import {
  BRIDGE_TOKEN_HEADER,
  BridgeTransport,
  bridgeSessionId,
  bridgeTargetId,
} from '../browser/bridge.js';
import { CdpClient } from '../browser/cdp.js';
import {
  getConsoleMessages,
  getPageErrors,
  setupConsoleCapture,
  teardownConsoleCapture,
} from '../browser/console-log.js';
import type { CdpTransport, CdpTransportHandlers } from '../browser/transport.js';

// --- a scripted inner pipe, for the translation unit tests -----------------

class ScriptedSocket implements CdpTransport {
  sent: unknown[] = [];
  closed = false;
  private handlers: CdpTransportHandlers | null = null;
  /** Answers each outbound envelope as the relay would. */
  autoReply: ((env: Record<string, unknown>) => unknown) | null = null;

  async open(handlers: CdpTransportHandlers): Promise<void> {
    this.handlers = handlers;
  }

  async send(frame: string): Promise<void> {
    const env = JSON.parse(frame) as Record<string, unknown>;
    this.sent.push(env);
    const reply = this.autoReply?.(env);
    if (reply !== undefined) this.push(reply);
  }

  close(): void {
    this.closed = true;
  }

  push(msg: unknown): void {
    this.handlers!.message(JSON.stringify(msg));
  }

  drop(err?: Error): void {
    this.handlers!.close(err);
  }

  /** The last envelope of a given type. */
  lastOf(type: string): Record<string, unknown> | undefined {
    return [...(this.sent as Array<Record<string, unknown>>)]
      .reverse()
      .find((e) => e.type === type);
  }
}

/** A socket whose attach and plain cdp commands always succeed. */
function okSocket(): ScriptedSocket {
  const s = new ScriptedSocket();
  s.autoReply = (env) => {
    if (env.type === 'cdp_attach' || env.type === 'cdp_detach') {
      return { id: env.id, success: true, data: {} };
    }
    if (env.type === 'cdp') {
      const params = env.params as { method: string };
      return { id: env.id, success: true, data: { result: { echoed: params.method } } };
    }
    return undefined;
  };
  return s;
}

describe('BridgeTransport framing', () => {
  it('attaches the debugger to the tab before reporting itself open', async () => {
    const socket = okSocket();
    const t = new BridgeTransport({ tabId: 42, socket });
    await t.open({ message: () => {}, close: () => {}, error: () => {} });

    const attach = socket.lastOf('cdp_attach')!;
    expect(attach.tabId).toBe(42);
  });

  it('fails open() when the tab cannot be attached, instead of half-connecting', async () => {
    const socket = new ScriptedSocket();
    socket.autoReply = (env) => ({
      id: env.id,
      success: false,
      error: 'debugger attach: Cannot access a chrome:// URL',
    });
    const t = new BridgeTransport({ tabId: 7, socket });
    await expect(t.open({ message: () => {}, close: () => {}, error: () => {} })).rejects.toThrow(
      /Cannot access a chrome:\/\/ URL/,
    );
  });

  it('wraps a CDP frame as a bridge command and unwraps the result', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    const result = await client.send('Page.navigate', { url: 'https://x.test' });
    const cmd = socket.lastOf('cdp')!;
    expect(cmd.tabId).toBe(42);
    expect(cmd.params).toEqual({ method: 'Page.navigate', params: { url: 'https://x.test' } });
    expect(result).toEqual({ echoed: 'Page.navigate' });
  });

  it('turns a bridge error into a CDP error the caller can read', async () => {
    const socket = new ScriptedSocket();
    socket.autoReply = (env) =>
      env.type === 'cdp_attach'
        ? { id: env.id, success: true, data: {} }
        : { id: env.id, success: false, error: 'Not allowed' };
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    await expect(client.send('HeapProfiler.enable')).rejects.toThrow(/Not allowed/);
  });

  it('strips the synthetic session id from commands on the tab session', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    await client.send('Runtime.enable', {}, bridgeSessionId(42));
    const cmd = socket.lastOf('cdp')!;
    // chrome.debugger's tab debuggee IS the page session; a sessionId here
    // would make it look for a child session that does not exist.
    expect(cmd.params).toEqual({ method: 'Runtime.enable', params: {} });
  });

  it('passes a real child session id through for out-of-process frames', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    await client.send('Runtime.enable', {}, 'OOPIF-SESSION-1');
    const cmd = socket.lastOf('cdp')!;
    expect(cmd.params).toEqual({
      method: 'Runtime.enable',
      params: {},
      sessionId: 'OOPIF-SESSION-1',
    });
  });

  it('answers Target.attachToTarget for the tab itself without touching the bridge', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    const before = socket.sent.length;
    const attached = await client.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId: bridgeTargetId(42),
      flatten: true,
    });
    expect(attached.sessionId).toBe(bridgeSessionId(42));
    expect(socket.sent.length).toBe(before);
  });

  it('forwards Target.attachToTarget for any other target', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    await client.send('Target.attachToTarget', { targetId: 'SOME-IFRAME', flatten: true });
    expect((socket.lastOf('cdp')!.params as { params: unknown }).params).toEqual({
      targetId: 'SOME-IFRAME',
      flatten: true,
    });
  });

  it('labels relayed events with the tab session so per-session listeners match', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    const seen: Array<string | undefined> = [];
    client.on('Network.responseReceived', (_p, sid) => void seen.push(sid));
    socket.push({
      type: 'cdp_event',
      data: { tabId: 42, method: 'Network.responseReceived', params: { requestId: 'R1' } },
    });

    expect(seen).toEqual([bridgeSessionId(42)]);
  });

  it('keeps a child session id on events that carry one', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    const seen: Array<string | undefined> = [];
    client.on('Network.responseReceived', (_p, sid) => void seen.push(sid));
    socket.push({
      type: 'cdp_event',
      data: {
        tabId: 42,
        sessionId: 'OOPIF-SESSION-1',
        method: 'Network.responseReceived',
        params: {},
      },
    });

    expect(seen).toEqual(['OOPIF-SESSION-1']);
  });

  it('ignores events for a tab this transport is not driving', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    const seen: unknown[] = [];
    client.on('Network.responseReceived', (p) => void seen.push(p));
    socket.push({
      type: 'cdp_event',
      data: { tabId: 99, method: 'Network.responseReceived', params: {} },
    });

    expect(seen).toEqual([]);
  });

  it('fails in-flight commands when the debugger is detached out from under it', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));

    socket.autoReply = null; // this one never gets answered
    const pending = client.send('Page.enable', {}, undefined, 0);
    socket.push({
      type: 'cdp_event',
      data: { tabId: 42, method: 'Inspector.detached', params: { reason: 'canceled_by_user' } },
    });

    await expect(pending).rejects.toThrow(/canceled_by_user/);
    expect(client.isConnected()).toBe(false);
  });

  it('detaches the debugger when the client closes, so the banner goes away', async () => {
    const socket = okSocket();
    const client = new CdpClient();
    await client.connectTransport(new BridgeTransport({ tabId: 42, socket }));
    client.close();

    expect(socket.lastOf('cdp_detach')).toMatchObject({ tabId: 42 });
    expect(socket.closed).toBe(true);
  });
});

// --- end to end over a real socket -----------------------------------------

/**
 * Stands in for `/monoagent/cdp` plus the extension behind it: answers the
 * bridge envelopes and can push unsolicited events, exactly as the Go relay
 * fans out `chrome.debugger.onEvent`.
 */
class FakeBridge {
  server: WebSocketServer;
  socket: WsSocket | null = null;
  tokens: Array<string | undefined> = [];
  commands: Array<{ method: string; params: unknown }> = [];

  constructor() {
    this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    this.server.on('connection', (ws, req) => {
      this.socket = ws;
      this.tokens.push(req.headers[BRIDGE_TOKEN_HEADER.toLowerCase()] as string | undefined);
      ws.on('message', (raw) => {
        const env = JSON.parse(raw.toString());
        if (env.type === 'cdp_attach' || env.type === 'cdp_detach') {
          ws.send(JSON.stringify({ id: env.id, success: true, data: {} }));
          return;
        }
        if (env.type === 'cdp') {
          this.commands.push(env.params);
          ws.send(JSON.stringify({ id: env.id, success: true, data: { result: {} } }));
        }
      });
    });
  }

  get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `ws://127.0.0.1:${port}/monoagent/cdp`;
  }

  ready(): Promise<void> {
    return new Promise((resolve) => this.server.once('listening', resolve));
  }

  /** Push an event up as the extension's chrome.debugger.onEvent would. */
  emit(tabId: number, method: string, params: Record<string, unknown>): void {
    this.socket!.send(JSON.stringify({ type: 'cdp_event', data: { tabId, method, params } }));
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

describe('BridgeTransport end to end over a real socket', () => {
  let bridge: FakeBridge;

  beforeEach(async () => {
    bridge = new FakeBridge();
    if (bridge.server.address() === null) await bridge.ready();
  });

  afterEach(async () => {
    await bridge.close();
  });

  it('carries console capture — an unmodified instrument — over the bridge', async () => {
    const client = new CdpClient();
    const transport = new BridgeTransport({ tabId: 5, url: bridge.url, token: 'tok-123' });
    await client.connectTransport(transport);

    const sessionId = bridgeSessionId(5);
    setupConsoleCapture(client, sessionId);
    // console-log.ts, untouched: it enables the domains it needs...
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Log.enable', {}, sessionId);

    // ...and the page's console output arrives as a relayed debugger event.
    bridge.emit(5, 'Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ value: 'checkout failed' }],
    });
    bridge.emit(5, 'Runtime.exceptionThrown', {
      exceptionDetails: { exception: { description: 'TypeError: x is not a function' } },
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(getConsoleMessages(sessionId)).toMatchObject([
      { type: 'error', text: 'checkout failed' },
    ]);
    expect(getPageErrors(sessionId)).toMatchObject([{ text: 'TypeError: x is not a function' }]);
    expect(bridge.commands.map((c) => c.method)).toEqual(['Runtime.enable', 'Log.enable']);
    expect(bridge.tokens).toEqual(['tok-123']);

    teardownConsoleCapture(sessionId);
    client.close();
  });

  it('reports a dropped bridge to in-flight callers', async () => {
    const client = new CdpClient();
    await client.connectTransport(
      new BridgeTransport({ tabId: 5, url: bridge.url, token: 'tok-123' }),
    );
    const pending = client.send('Page.captureScreenshot', {}, undefined, 0);
    bridge.socket!.close();
    await expect(pending).rejects.toThrow(/closed|bridge/i);
  });
});
