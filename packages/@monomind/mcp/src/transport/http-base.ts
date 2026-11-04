/**
 * @monoes/mcp - HTTP Transport (base)
 *
 * Connection state, Express middleware, bind-host policy, request-size
 * parsing, connection ids and auth validation shared by HttpTransport
 * (http.ts).
 */

import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import { WebSocket, type WebSocketServer } from 'ws';
import { type AuthValidationResult, validateCredential } from '../auth.js';
import type {
  AuthConfig,
  ConnectionCloseHandler,
  ILogger,
  MCPNotification,
  NotificationHandler,
  RequestHandler,
  TransportHealthStatus,
  TransportType,
} from '../types.js';
import { isAllowedHost, isAllowedOrigin } from './origin-guard.js';

export interface HttpTransportConfig {
  host: string;
  port: number;
  tlsEnabled?: boolean;
  tlsCert?: string;
  tlsKey?: string;
  corsEnabled?: boolean;
  corsOrigins?: string[];
  auth?: AuthConfig;
  /** Extra Host header names accepted besides loopback (and the bind host). */
  allowedHosts?: string[];
  /** Extra Origins accepted on WebSocket upgrade besides loopback ones. */
  allowedOrigins?: string[];
  maxRequestSize?: string;
  requestTimeout?: number;
}

export abstract class HttpTransportBase extends EventEmitter {
  public readonly type: TransportType = 'http';

  protected requestHandler?: RequestHandler;
  protected notificationHandler?: NotificationHandler;
  protected connectionCloseHandler?: ConnectionCloseHandler;
  protected app: Express;
  protected server?: Server;
  protected wss?: WebSocketServer;
  protected running = false;
  protected activeConnections = new Set<WebSocket>();
  // Per-connection identity, so each WebSocket or keep-alive HTTP TCP socket
  // maps to a stable connectionId for the lifetime of that connection —
  // this is what lets MCPServer keep sessions isolated per client instead of
  // sharing one singleton session across every connected client.
  protected wsConnectionIds = new WeakMap<WebSocket, string>();
  private httpConnectionIds = new WeakMap<Socket, string>();
  private connectionIdCounter = 0;

  protected messagesReceived = 0;
  protected messagesSent = 0;
  protected errors = 0;
  protected httpRequests = 0;
  protected wsMessages = 0;

  constructor(
    protected readonly logger: ILogger,
    protected readonly config: HttpTransportConfig,
  ) {
    super();
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * SECURITY: Refuse to bind unauthenticated servers to a non-loopback
   * interface. Without `auth` configured, `handleHttpRequest` processes
   * every request without validating credentials — that is only acceptable
   * on loopback. If the operator asked for a non-loopback host with no auth,
   * fall back to 127.0.0.1 unless they explicitly opt in via
   * MONOMIND_MCP_ALLOW_REMOTE=1 (matching the CLI's own remote-bind gate).
   */
  protected resolveBindHost(): string {
    const configuredHost = this.config.host;

    if (this.config.auth) {
      // Auth is explicitly configured — respect the requested host. Binding
      // safety in this case is the operator's informed decision.
      return configuredHost;
    }

    const isLoopback =
      configuredHost === 'localhost' ||
      configuredHost === '127.0.0.1' ||
      configuredHost === '::1' ||
      configuredHost === '::ffff:127.0.0.1';

    if (isLoopback) {
      return configuredHost;
    }

    if (process.env.MONOMIND_MCP_ALLOW_REMOTE === '1') {
      this.logger.warn(
        `SECURITY WARNING: HTTP transport is binding to non-loopback host "${configuredHost}" ` +
          'with NO authentication configured. MONOMIND_MCP_ALLOW_REMOTE=1 opt-in detected — ' +
          'every request will be processed unauthenticated. This exposes every registered tool ' +
          'to anyone who can reach this host/port.',
      );
      return configuredHost;
    }

    this.logger.warn(
      `SECURITY: refusing to bind HTTP transport to non-loopback host "${configuredHost}" with ` +
        'no "auth" configured. Falling back to 127.0.0.1. Set MONOMIND_MCP_ALLOW_REMOTE=1 to ' +
        'override (unsafe) or configure "auth" with tokens.',
    );
    return '127.0.0.1';
  }

  /**
   * SECURITY: Parses the same `maxRequestSize` string used for the HTTP
   * body-size limit (e.g. "10mb") into a byte count for the embedded
   * WebSocketServer's `maxPayload` option, so both sides of this transport
   * enforce the same ceiling.
   */
  protected parseMaxRequestSizeBytes(): number {
    const raw = this.config.maxRequestSize || '10mb';
    if (typeof raw === 'number') {
      return raw;
    }
    const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(raw.trim());
    if (!match) {
      return 10 * 1024 * 1024;
    }
    const value = parseFloat(match[1]);
    const unit = (match[2] || 'b').toLowerCase();
    const multipliers: Record<string, number> = {
      b: 1,
      kb: 1024,
      mb: 1024 * 1024,
      gb: 1024 * 1024 * 1024,
    };
    return Math.round(value * (multipliers[unit] ?? 1));
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  onConnectionClose(handler: ConnectionCloseHandler): void {
    this.connectionCloseHandler = handler;
  }

  /**
   * Resolve (creating if needed) the stable connectionId for the TCP socket
   * underlying an HTTP request. Node reuses the same `net.Socket` across
   * every keep-alive request on a connection, so this id stays stable for
   * the connection's lifetime and lets per-connection sessions survive
   * multiple `/rpc` calls from the same client without colliding with other
   * clients' sessions. Cleaned up once, on socket close.
   */
  protected getOrCreateHttpConnectionId(socket: Socket): string {
    let id = this.httpConnectionIds.get(socket);
    if (id) {
      return id;
    }

    id = `http-conn-${++this.connectionIdCounter}-${Date.now()}`;
    this.httpConnectionIds.set(socket, id);

    const finalize = () => {
      this.httpConnectionIds.delete(socket);
      this.connectionCloseHandler?.(id!);
    };
    socket.once('close', finalize);

    return id;
  }

  protected getOrCreateWsConnectionId(ws: WebSocket): string {
    let id = this.wsConnectionIds.get(ws);
    if (!id) {
      id = `http-ws-conn-${++this.connectionIdCounter}-${Date.now()}`;
      this.wsConnectionIds.set(ws, id);
    }
    return id;
  }

  async getHealthStatus(): Promise<TransportHealthStatus> {
    return {
      healthy: this.running,
      metrics: {
        messagesReceived: this.messagesReceived,
        messagesSent: this.messagesSent,
        errors: this.errors,
        httpRequests: this.httpRequests,
        wsMessages: this.wsMessages,
        activeConnections: this.activeConnections.size,
      },
    };
  }

  async sendNotification(notification: MCPNotification): Promise<void> {
    const message = JSON.stringify(notification);

    for (const ws of this.activeConnections) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
          this.messagesSent++;
        }
      } catch (error) {
        this.logger.error('Failed to send notification', { error });
        this.errors++;
      }
    }
  }

  /**
   * Single auth predicate shared by the HTTP and WebSocket paths: auth is
   * enforced whenever a policy exists and `enabled` is not explicitly false.
   */
  protected authRequired(): boolean {
    return !!this.config.auth && this.config.auth.enabled !== false;
  }

  /** SECURITY: Host allow-list (DNS-rebinding defence). */
  protected hostAllowed(hostHeader: string | undefined): boolean {
    return isAllowedHost(hostHeader, [...(this.config.allowedHosts ?? []), this.config.host]);
  }

  /** SECURITY: Origin allow-list for WebSocket upgrades (cross-site WS hijacking defence). */
  protected originAllowed(origin: string | undefined): boolean {
    return isAllowedOrigin(origin, [
      ...(this.config.allowedOrigins ?? []),
      ...(this.config.corsOrigins ?? []),
    ]);
  }

  private setupMiddleware(): void {
    this.app.use((req, res, next) => {
      if (!this.hostAllowed(req.headers.host)) {
        this.logger.warn('Request rejected: Host not allowed', { host: req.headers.host });
        res.status(403).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Forbidden: Host not allowed' },
        });
        return;
      }
      next();
    });

    this.app.use(
      helmet({
        contentSecurityPolicy: false,
      }),
    );

    if (this.config.corsEnabled !== false) {
      const allowedOrigins = this.config.corsOrigins;

      if (!allowedOrigins || allowedOrigins.length === 0) {
        this.logger.warn('CORS: No origins configured, restricting to same-origin only');
      }

      this.app.use(
        cors({
          origin: (origin, callback) => {
            if (!origin) {
              callback(null, true);
              return;
            }

            if (allowedOrigins && allowedOrigins.length > 0) {
              if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
                callback(null, true);
              } else {
                callback(new Error(`CORS: Origin '${origin}' not allowed`));
              }
            } else {
              callback(new Error('CORS: Cross-origin requests not allowed'));
            }
          },
          credentials: true,
          maxAge: 86400,
          methods: ['GET', 'POST', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
        }),
      );
    }

    this.app.use(
      express.json({
        limit: this.config.maxRequestSize || '10mb',
      }),
    );

    if (this.config.requestTimeout) {
      this.app.use((_req, res, next) => {
        res.setTimeout(this.config.requestTimeout!, () => {
          res.status(408).json({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32000, message: 'Request timeout' },
          });
        });
        next();
      });
    }

    this.app.use((req, res, next) => {
      const startTime = performance.now();
      res.on('finish', () => {
        const duration = performance.now() - startTime;
        this.logger.debug('HTTP request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration: `${duration.toFixed(2)}ms`,
        });
      });
      next();
    });
  }

  /** Registers the Express routes; implemented by HttpTransport (http.ts). */
  protected abstract setupRoutes(): void;

  protected validateAuth(req: Request): AuthValidationResult {
    return validateCredential(
      { ...this.config.auth!, enabled: true },
      req.headers.authorization,
      req.headers['x-api-key'] as string | undefined,
    );
  }
}
