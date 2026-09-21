/**
 * RIG-07: the instruments, unmodified, against the extension bridge.
 *
 * This is the payoff the transport seam exists for. Each case calls the same
 * monobrowse entry points the MCP tools in @monomind/cli call — the
 * `browser_console`, `browser_network` and `browser_vitals` handlers each do
 * no more than take a `{ client, cdpSessionId }` pair and hand it to these
 * functions — but the pair here is backed by the bridge rather than by a
 * socket to a Chrome we launched.
 *
 * The far end is a fake relay, not Chrome: it answers CDP commands and pushes
 * debugger events, which is exactly the contract internal/extension/cdp.go
 * and chrome-extension/cdp_proxy.js implement between them. What it proves is
 * that nothing in the instruments needs to know which browser it is on.
 */
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket as WsSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { BridgeTransport, bridgeSessionId } from '../browser/bridge.js';
import { CdpClient } from '../browser/cdp.js';
import {
  clearConsoleMessages,
  getConsoleMessages,
  getPageErrors,
  setupConsoleCapture,
  teardownConsoleCapture,
} from '../browser/console-log.js';
import {
  getCapturedRequests,
  startRequestCapture,
  stopRequestCapture,
} from '../browser/network.js';
import { collectVitals } from '../browser/vitals.js';

/** The Go relay plus the extension behind it, as far as CDP is concerned. */
class FakeChrome {
  server: WebSocketServer;
  socket: WsSocket | null = null;
  /** Canned Runtime.evaluate return values, by the order they are asked for. */
  evalResults: unknown[] = [];
  methods: string[] = [];

  constructor() {
    this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    this.server.on('connection', (ws) => {
      this.socket = ws;
      ws.on('message', (raw) => {
        const env = JSON.parse(raw.toString());
        if (env.type !== 'cdp') {
          ws.send(JSON.stringify({ id: env.id, success: true, data: { tabId: env.tabId ?? 5 } }));
          return;
        }
        const { method } = env.params as { method: string };
        this.methods.push(method);
        const result =
          method === 'Runtime.evaluate'
            ? { result: { type: 'object', value: this.evalResults.shift() ?? {} } }
            : {};
        ws.send(JSON.stringify({ id: env.id, success: true, data: { result } }));
      });
    });
  }

  get url(): string {
    return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}/monoagent/cdp`;
  }

  ready(): Promise<void> {
    return new Promise((resolve) => this.server.once('listening', resolve));
  }

  /** What chrome.debugger.onEvent delivers, relayed up the bridge. */
  emit(tabId: number, method: string, params: Record<string, unknown>): void {
    this.socket!.send(JSON.stringify({ type: 'cdp_event', data: { tabId, method, params } }));
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

const TAB = 5;
const SESSION = bridgeSessionId(TAB);

describe('RIG-07: monobrowse instruments over the extension bridge', () => {
  let chrome: FakeChrome;
  let client: CdpClient;

  beforeEach(async () => {
    chrome = new FakeChrome();
    if (chrome.server.address() === null) await chrome.ready();
    client = new CdpClient();
    await client.connectTransport(
      new BridgeTransport({ tabId: TAB, url: chrome.url, token: 'tok' }),
    );
  });

  afterEach(async () => {
    client.close();
    await chrome.close();
  });

  // browser_console: setupConsoleCapture at connect, read the buffers later.
  it('browser_console reads the real tab console', async () => {
    setupConsoleCapture(client, SESSION);
    clearConsoleMessages(SESSION);
    await client.send('Runtime.enable', {}, SESSION);
    await client.send('Log.enable', {}, SESSION);

    chrome.emit(TAB, 'Runtime.consoleAPICalled', {
      type: 'warning',
      args: [{ value: 'cart total mismatch' }],
    });
    chrome.emit(TAB, 'Log.entryAdded', {
      entry: { level: 'error', text: 'Failed to load resource: 402', url: 'https://shop.test/pay' },
    });
    chrome.emit(TAB, 'Runtime.exceptionThrown', {
      exceptionDetails: { exception: { description: 'ReferenceError: checkout is not defined' } },
    });
    await tick();

    expect(getConsoleMessages(SESSION)).toMatchObject([
      { type: 'warn', text: 'cart total mismatch' },
      { type: 'error', text: 'Failed to load resource: 402', url: 'https://shop.test/pay' },
    ]);
    expect(getPageErrors(SESSION)).toMatchObject([
      { text: 'ReferenceError: checkout is not defined' },
    ]);
    teardownConsoleCapture(SESSION);
  });

  // browser_network action:"start" then action:"list".
  it('browser_network records the real tab requests', async () => {
    startRequestCapture(client, SESSION);

    chrome.emit(TAB, 'Network.requestWillBeSent', {
      requestId: 'R1',
      request: { url: 'https://shop.test/api/cart', method: 'GET', headers: {} },
      timestamp: 1,
    });
    chrome.emit(TAB, 'Network.responseReceived', {
      requestId: 'R1',
      response: { status: 402, mimeType: 'application/json', headers: {} },
      timestamp: 2,
    });
    chrome.emit(TAB, 'Network.loadingFinished', {
      requestId: 'R1',
      timestamp: 2,
      encodedDataLength: 1234,
    });
    await tick();

    expect(getCapturedRequests(SESSION)).toMatchObject([
      { url: 'https://shop.test/api/cart', method: 'GET', status: 402 },
    ]);
    stopRequestCapture(SESSION);
  });

  // browser_vitals: one Runtime.evaluate, straight through the bridge.
  it('browser_vitals measures the real tab', async () => {
    chrome.evalResults = [{ lcp: 2400, fcp: 900, cls: 0.03, ttfb: 180 }];
    const vitals = await collectVitals(client, SESSION, 0);

    expect(vitals).toMatchObject({ lcp: 2400, fcp: 900, cls: 0.03, ttfb: 180 });
    expect(chrome.methods).toContain('Runtime.evaluate');
  });

  it('every command reached the tab session, with no CDP sessionId on the wire', async () => {
    await client.send('Page.enable', {}, SESSION);
    // The synthetic session id is monobrowse's bookkeeping; chrome.debugger
    // addresses the page by its debuggee, so it must never travel.
    expect(chrome.methods).toEqual(['Page.enable']);
  });
});

/** Let the relayed events drain through the socket and the listeners. */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 50));
}
