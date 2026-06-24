import { WebSocket } from 'ws';
import type { CdpCommand, CdpResponse, CdpTarget } from './types.js';

export class CdpClient {
  private ws: WebSocket | null = null;
  private pendingCommands = new Map<number, { resolve: (r: CdpResponse) => void; reject: (e: Error) => void }>();
  private eventListeners = new Map<string, Set<(params: Record<string, unknown>, sessionId?: string) => void>>();
  private nextId = 1;
  private connected = false;

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this.connected = true;
        resolve();
      });

      this.ws.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        } else {
          // Post-connect: flush all pending commands — 'close' may not fire on all platforms
          this.connected = false;
          for (const { reject: r } of this.pendingCommands.values()) r(err);
          this.pendingCommands.clear();
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        for (const { reject: r } of this.pendingCommands.values()) {
          r(new Error('CDP connection closed'));
        }
        this.pendingCommands.clear();
      });

      this.ws.on('message', (data) => {
        try {
          const msg: CdpResponse = JSON.parse(data.toString());
          if (msg.id !== undefined && this.pendingCommands.has(msg.id)) {
            const handler = this.pendingCommands.get(msg.id)!;
            this.pendingCommands.delete(msg.id);
            if (msg.error) {
              handler.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
            } else {
              handler.resolve(msg);
            }
          } else if (msg.method) {
            const listeners = this.eventListeners.get(msg.method);
            if (listeners) {
              for (const fn of listeners) {
                try { fn(msg.params ?? {}, msg.sessionId); } catch { /* isolate per-listener errors */ }
              }
            }
          }
        } catch {
          // ignore malformed messages
        }
      });
    });
  }

  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.connected) {
        reject(new Error('CDP not connected'));
        return;
      }
      // Cap in-flight commands to prevent unbounded Map growth
      if (this.pendingCommands.size >= 1000) {
        reject(new Error('CDP command queue full (>1000 in-flight commands)'));
        return;
      }
      const id = this.nextId++;
      const cmd: CdpCommand = { id, method, params };
      if (sessionId) cmd.sessionId = sessionId;
      this.pendingCommands.set(id, {
        resolve: (r) => resolve((r.result ?? {}) as T),
        reject,
      });
      this.ws.send(JSON.stringify(cmd), (err) => {
        if (err) {
          this.pendingCommands.delete(id);
          reject(err);
        }
      });
    });
  }

  on(event: string, fn: (params: Record<string, unknown>, sessionId?: string) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    const listeners = this.eventListeners.get(event)!;
    // Cap listeners per event to prevent unbounded Set growth
    if (listeners.size >= 100) {
      throw new Error(`CDP event listener limit reached for event: ${event}`);
    }
    listeners.add(fn);
    return () => this.eventListeners.get(event)?.delete(fn);
  }

  once(event: string, sessionId?: string): Promise<Record<string, unknown>> {
    const [promise] = this.onceWithOff(event, sessionId);
    return promise;
  }

  onceWithOff(event: string, sessionId?: string): [Promise<Record<string, unknown>>, () => void] {
    let off: () => void = () => {};
    const promise = new Promise<Record<string, unknown>>((resolve) => {
      off = this.on(event, (params, sid) => {
        if (sessionId !== undefined && sid !== sessionId) return;
        off();
        resolve(params);
      });
    });
    return [promise, () => off()];
  }

  close(): void {
    this.connected = false;
    for (const { reject: r } of this.pendingCommands.values()) r(new Error('CDP connection closed'));
    this.pendingCommands.clear();
    this.ws?.close();
    this.ws = null;
    this.eventListeners.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }
}

const CDP_RESPONSE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

async function readCdpJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length > CDP_RESPONSE_SIZE_LIMIT) {
    throw new Error(`CDP response too large: ${text.length} bytes`);
  }
  return JSON.parse(text);
}

export async function fetchTargets(port: number): Promise<CdpTarget[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`Failed to fetch targets: ${res.statusText}`);
  return readCdpJson(res) as Promise<CdpTarget[]>;
}

export async function fetchNewTarget(port: number, url: string): Promise<CdpTarget> {
  // Chrome v92+ requires PUT for /json/new; GET returns 405. URL must be encoded.
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`Failed to create target: ${res.statusText}`);
  return readCdpJson(res) as Promise<CdpTarget>;
}

export interface BrowserPage {
  url(): Promise<string>;
  evaluate<T>(expression: string): Promise<T>;
  close(): Promise<void>;
}

export async function createBrowserPage(url: string, port = 9222): Promise<BrowserPage> {
  const target = await fetchNewTarget(port, url);
  const wsDebuggerUrl = target.webSocketDebuggerUrl;
  if (!wsDebuggerUrl) {
    throw new Error('Chrome did not return a WebSocket debugger URL. Ensure Chrome is running with --remote-debugging-port=' + port);
  }

  const client = new CdpClient();
  try {
    await client.connect(wsDebuggerUrl);

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    const loadPromise = client.once('Page.loadEventFired');
    await client.send('Page.navigate', { url });
    await Promise.race([
      loadPromise,
      new Promise<void>((_, reject) =>
        AbortSignal.timeout(30_000).addEventListener('abort', () => reject(new Error('Page load timeout after 30s')))
      ),
    ]);
  } catch (err) {
    client.close();
    throw err;
  }

  const closeTab = async (): Promise<void> => {
    try {
      await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(target.id)}`, { method: 'GET' });
    } catch {
      // best-effort: tab may already be gone
    }
  };

  return {
    url: async () => {
      const result = await client.send<{ result: { value: string } }>('Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true,
      });
      return result.result.value;
    },
    evaluate: async <T>(expression: string): Promise<T> => {
      const result = await client.send<{ result: { value: T; }; exceptionDetails?: { text: string } }>('Runtime.evaluate', {
        expression,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(`JS evaluation failed: ${result.exceptionDetails.text}`);
      }
      return result.result.value;
    },
    close: async (): Promise<void> => {
      client.close();
      await closeTab();
    },
  };
}
