import { WebSocket } from 'ws';

/**
 * The seam between CdpClient and whatever carries its frames.
 *
 * CdpClient used to own a `ws` socket outright, which meant "CDP" and "a
 * WebSocket to a Chrome we launched" were the same thing. They are not: the
 * MonoAgent browser extension already holds the `debugger` permission and
 * speaks CDP to the user's real, logged-in Chrome — it just reaches it
 * through `chrome.debugger.sendCommand` over the extension bridge instead of
 * a socket. Everything monobrowse instruments (console, network, HAR,
 * vitals, trace, profiler, snapshot, screenshot, emulation) goes through
 * CdpClient, so moving the socket behind this interface is what lets all of
 * them point at that browser without being ported one at a time.
 *
 * A transport deals in whole, already-serialized CDP frames. Framing,
 * request ids, timeouts and event dispatch stay in CdpClient, so a transport
 * has nothing to get subtly wrong about the protocol.
 */
export interface CdpTransportHandlers {
  /** One inbound frame: a command response or an event. */
  message(data: string): void;
  /**
   * The transport is gone and nothing more will arrive. `err` explains why
   * when the transport knows; CdpClient supplies a default when it doesn't.
   */
  close(err?: Error): void;
  /**
   * A failure *after* open() resolved. A failure before it instead rejects
   * open() — the caller is still waiting on that promise, and a connect
   * that fails should look like a failed connect, not a live-then-broken
   * connection.
   */
  error(err: Error): void;
}

export interface CdpTransport {
  /** Establish the connection. Resolves once frames can flow. */
  open(handlers: CdpTransportHandlers): Promise<void>;
  /** Send one serialized CDP frame; rejects if it could not be written. */
  send(frame: string): Promise<void>;
  /** Tear it down. Safe to call more than once. */
  close(): void;
}

/**
 * The original transport: a WebSocket to a Chrome DevTools endpoint, either
 * a page's `webSocketDebuggerUrl` or the browser-level one. This is the code
 * that used to live inline in CdpClient.connect(), moved wholesale so the
 * local path keeps behaving exactly as it did.
 */
export class WebSocketTransport implements CdpTransport {
  private ws: WebSocket | null = null;
  private opened = false;

  /**
   * `headers` is only ever used by the bridge transport, whose relay
   * endpoint is token-authenticated; a DevTools endpoint wants none.
   */
  constructor(
    private readonly url: string,
    private readonly headers?: Record<string, string>,
  ) {}

  open(handlers: CdpTransportHandlers): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.headers
        ? new WebSocket(this.url, { headers: this.headers })
        : new WebSocket(this.url);
      this.ws = ws;

      ws.on('open', () => {
        this.opened = true;
        resolve();
      });

      ws.on('error', (err) => {
        const e = err instanceof Error ? err : new Error(String(err));
        if (!this.opened) {
          reject(e);
        } else {
          // Post-connect: 'close' may not fire on all platforms, so this is
          // the only notice the owner gets that its commands are stranded.
          handlers.error(e);
        }
      });

      ws.on('close', () => handlers.close());

      ws.on('message', (data) => handlers.message(data.toString()));
    });
  }

  send(frame: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('CDP transport not open'));
        return;
      }
      this.ws.send(frame, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
