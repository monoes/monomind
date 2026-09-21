import { enableSessionDomains } from './browser.js';
import { CdpClient } from './cdp.js';
import type { CdpTransport, CdpTransportHandlers } from './transport.js';
import { WebSocketTransport } from './transport.js';

/**
 * CDP over the MonoAgent extension bridge.
 *
 * The extension already holds Chrome's `debugger` permission and attaches to
 * tabs with `chrome.debugger.attach`; mono-agent's Go server already owns the
 * WebSocket to it. This transport puts CDP frames on that path — out through
 * the relay's `/monoagent/cdp` socket, into `chrome.debugger.sendCommand`,
 * and back — so a CdpClient can drive the browser the user is actually
 * signed into rather than a headless Chrome we launched. Every instrument
 * built on CdpClient (console, network, HAR, vitals, trace, CPU profiler,
 * snapshot, screenshot, emulation) comes along unchanged.
 *
 * Two mismatches have to be reconciled here, and they are the whole job:
 *
 * **Sessions.** Against a raw socket, monobrowse attaches to a target and
 * carries the resulting `sessionId` on every command and every event.
 * `chrome.debugger` has no such id for the tab: the debuggee *is* the page
 * session, and a `sessionId` on the wire means a *child* session (an
 * out-of-process iframe). So this transport mints a stable synthetic id for
 * the tab, strips it on the way out, stamps it onto relayed events on the
 * way in, and passes any other id through untouched for real child sessions.
 *
 * **Attachment.** A socket is opened; a debuggee is attached. open() does the
 * attach and fails if it cannot, rather than handing back a transport whose
 * first command would fail. close() detaches, which is what takes Chrome's
 * "…started debugging this browser" banner off the user's tab.
 *
 * Known gaps, which are Chrome's and not this file's: `chrome.debugger`
 * exposes a fixed set of domains, and `HeapProfiler` and `Browser` are not
 * among them, so heap snapshots and `Browser.close` fail over the bridge.
 */

/** Header the Go relay authenticates with; mirrors internal/extension/token.go. */
export const BRIDGE_TOKEN_HEADER = 'X-Monoagent-Extension-Token';

/** Default relay endpoint; mirrors the extension server's default port. */
export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:9222/monoagent/cdp';

/** How long the attach handshake may take before open() gives up. */
const DEFAULT_ATTACH_TIMEOUT_MS = 15_000;

/** The synthetic target id standing in for a Chrome tab. */
export function bridgeTargetId(tabId: number): string {
  return `bridge-tab-${tabId}`;
}

/** The synthetic session id standing in for a tab's page session. */
export function bridgeSessionId(tabId: number): string {
  return `bridge-session-${tabId}`;
}

/** True for ids this transport minted, as opposed to real CDP child sessions. */
export function isBridgeSessionId(sessionId: string | undefined): boolean {
  return typeof sessionId === 'string' && sessionId.startsWith('bridge-session-');
}

export interface BridgeTransportOptions {
  /**
   * The Chrome tab to drive. Omit it to drive whichever tab the user is
   * looking at: the extension resolves the active tab and reports the id
   * back on attach, which is the normal way in — the caller has no tab ids
   * to hand, only a browser with the user's session in it.
   */
  tabId?: number;
  /** Relay endpoint. Defaults to DEFAULT_BRIDGE_URL. */
  url?: string;
  /** Relay token, from ~/.monoagent (the Go side writes it). */
  token?: string;
  /** Attach-handshake budget in ms. */
  attachTimeoutMs?: number;
  /**
   * The byte pipe underneath. Defaults to a WebSocket to `url`; tests inject
   * a scripted one so they can be the relay.
   */
  socket?: CdpTransport;
}

/** One bridge-level envelope, as the Go relay and the extension speak it. */
interface BridgeEnvelope {
  id: string;
  type: 'cdp' | 'cdp_attach' | 'cdp_detach';
  /** Omitted when the extension should resolve the active tab itself. */
  tabId?: number;
  params?: Record<string, unknown>;
}

interface BridgeReply {
  id?: string;
  type?: string;
  success?: boolean;
  data?: {
    result?: unknown;
    tabId?: number;
    method?: string;
    params?: unknown;
    sessionId?: string;
  };
  error?: string;
}

/** A CDP frame on its way out of CdpClient. */
interface OutboundCdp {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export class BridgeTransport implements CdpTransport {
  /** 0 until the extension resolves the active tab (see open()). */
  private tabId: number;
  private readonly socket: CdpTransport;
  private readonly attachTimeoutMs: number;
  private handlers: CdpTransportHandlers | null = null;
  private nextEnvelopeId = 1;
  private readonly pending = new Map<string, (reply: BridgeReply) => void>();
  private closed = false;

  constructor(opts: BridgeTransportOptions) {
    this.tabId = opts.tabId ?? 0;
    this.attachTimeoutMs = opts.attachTimeoutMs ?? DEFAULT_ATTACH_TIMEOUT_MS;
    this.socket =
      opts.socket ??
      new WebSocketTransport(
        opts.url ?? DEFAULT_BRIDGE_URL,
        opts.token ? { [BRIDGE_TOKEN_HEADER]: opts.token } : undefined,
      );
  }

  async open(handlers: CdpTransportHandlers): Promise<void> {
    this.handlers = handlers;
    await this.socket.open({
      message: (data) => this.onBridgeMessage(data),
      close: (err) => this.onGone(err ?? new Error('extension bridge closed')),
      error: (err) => this.onGone(err),
    });
    const reply = await this.command('cdp_attach', undefined, this.attachTimeoutMs);
    if (reply.success === false) {
      this.socket.close();
      const where = this.tabId ? `tab ${this.tabId}` : 'the active tab';
      throw new Error(`bridge attach to ${where} failed: ${reply.error ?? 'unknown'}`);
    }
    // The extension answers with the tab it actually attached to, which is
    // the only way to learn the id when we asked for "whatever is active".
    if (typeof reply.data?.tabId === 'number') this.tabId = reply.data.tabId;
    if (!this.tabId) {
      this.socket.close();
      throw new Error('bridge attach did not report a tab id');
    }
  }

  /** The tab this transport is driving; valid once open() has resolved. */
  get attachedTabId(): number {
    return this.tabId;
  }

  /** The session id every instrument should use against this transport. */
  get sessionId(): string {
    return bridgeSessionId(this.tabId);
  }

  async send(frame: string): Promise<void> {
    const cdp = JSON.parse(frame) as OutboundCdp;
    if (this.answerLocally(cdp)) return;

    const params: Record<string, unknown> = {
      method: cdp.method,
      params: cdp.params ?? {},
    };
    // A synthetic id means "the tab itself", which chrome.debugger addresses
    // by its debuggee alone. Anything else is a real child session id and
    // has to travel, or the command lands in the wrong frame.
    if (cdp.sessionId !== undefined && !isBridgeSessionId(cdp.sessionId)) {
      params.sessionId = cdp.sessionId;
    }

    const reply = await this.command('cdp', params);
    if (reply.success === false) {
      this.deliver({
        id: cdp.id,
        // -32000 is CDP's own "server error" code; the bridge has no richer
        // one to offer, and the message is what a caller actually reads.
        error: { code: -32000, message: reply.error ?? 'bridge command failed' },
      });
      return;
    }
    this.deliver({ id: cdp.id, result: reply.data?.result ?? {} });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Best effort, and deliberately not awaited: leaving the debugger
    // attached leaves Chrome's debugging banner on the user's tab. The
    // extension's idle sweep would eventually detach anyway.
    void this.command('cdp_detach').catch(() => {});
    this.socket.close();
    this.failPending(new Error('extension bridge closed'));
  }

  // --- internals -----------------------------------------------------------

  /**
   * Commands this transport answers itself. `Target.attachToTarget` against
   * the tab is the one that matters: monobrowse's connect path asks for a
   * session, and over the bridge there is nothing to ask — the debuggee is
   * already the session. Any *other* target id is a genuine child target and
   * goes to Chrome.
   */
  private answerLocally(cdp: OutboundCdp): boolean {
    const targetId = cdp.params?.targetId;
    if (cdp.method === 'Target.attachToTarget' && targetId === bridgeTargetId(this.tabId)) {
      this.deliver({ id: cdp.id, result: { sessionId: bridgeSessionId(this.tabId) } });
      return true;
    }
    if (
      cdp.method === 'Target.detachFromTarget' &&
      isBridgeSessionId(cdp.params?.sessionId as string | undefined)
    ) {
      this.deliver({ id: cdp.id, result: {} });
      return true;
    }
    return false;
  }

  private command(
    type: BridgeEnvelope['type'],
    params?: Record<string, unknown>,
    timeoutMs = 0,
  ): Promise<BridgeReply> {
    const id = `cdp-${this.nextEnvelopeId++}`;
    const envelope: BridgeEnvelope = { id, type, params };
    if (this.tabId) envelope.tabId = this.tabId;
    return new Promise<BridgeReply>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`bridge ${type} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
      }
      this.pending.set(id, (reply) => {
        if (timer) clearTimeout(timer);
        resolve(reply);
      });
      this.socket.send(JSON.stringify(envelope)).catch((err) => {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private onBridgeMessage(data: string): void {
    let msg: BridgeReply;
    try {
      msg = JSON.parse(data) as BridgeReply;
    } catch {
      return; // malformed frames are ignored, as on a raw CDP socket
    }

    if (msg.type === 'cdp_event') {
      this.relayEvent(msg);
      return;
    }
    if (msg.id !== undefined) {
      const settle = this.pending.get(msg.id);
      if (settle) {
        this.pending.delete(msg.id);
        settle(msg);
      }
    }
  }

  private relayEvent(msg: BridgeReply): void {
    const ev = msg.data;
    if (!ev?.method) return;
    // One relay socket can carry several tabs; take only our own.
    if (ev.tabId !== undefined && ev.tabId !== this.tabId) return;

    // The debugger went away — the user hit Cancel on the banner, DevTools
    // opened on the tab, or the tab closed. Nothing else will arrive, and a
    // caller waiting on a command should hear that now rather than time out.
    if (ev.method === 'Inspector.detached') {
      const reason = (ev.params as { reason?: string } | undefined)?.reason ?? 'unknown';
      this.onGone(new Error(`extension bridge detached from tab ${this.tabId}: ${reason}`));
      return;
    }

    this.deliver({
      method: ev.method,
      params: (ev.params as Record<string, unknown>) ?? {},
      // A real child session id wins; otherwise this is the tab's own
      // session, which every instrument filters its events by.
      sessionId: ev.sessionId ?? bridgeSessionId(this.tabId),
    });
  }

  private deliver(frame: Record<string, unknown>): void {
    this.handlers?.message(JSON.stringify(frame));
  }

  private onGone(err: Error): void {
    this.failPending(err);
    this.handlers?.close(err);
  }

  private failPending(err: Error): void {
    for (const settle of this.pending.values()) {
      settle({ success: false, error: err.message });
    }
    this.pending.clear();
  }
}

/** What a bridge connection hands back: the same shape connectToTarget gives. */
export interface BridgeConnection {
  client: CdpClient;
  sessionId: string;
  tabId: number;
  transport: BridgeTransport;
}

/**
 * Connect a CdpClient to the user's real Chrome through the extension
 * bridge, with the same domains enabled that a local session gets. This is
 * the whole of the "point the instruments at the logged-in browser" story
 * at the call site:
 *
 *     const { client, sessionId } = await connectBridge({ token });
 *     const vitals = await collectVitals(client, sessionId);
 *
 * `enableDomains` is on by default for parity with connectToTarget. Turn it
 * off for a caller that wants to choose its own domains (a bridge attach is
 * visible to the user, so a lighter footprint is sometimes the point).
 */
export async function connectBridge(
  opts: BridgeTransportOptions & { enableDomains?: boolean } = {},
): Promise<BridgeConnection> {
  const transport = new BridgeTransport(opts);
  const client = new CdpClient();
  await client.connectTransport(transport);
  const sessionId = transport.sessionId;
  if (opts.enableDomains !== false) {
    await enableSessionDomains(client, sessionId);
  }
  return { client, sessionId, tabId: transport.attachedTabId, transport };
}
