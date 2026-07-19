/**
 * @monoes/mcp - HTTP Transport
 *
 * HTTP/REST transport with WebSocket support
 */

import { EventEmitter } from 'events';
import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import type {
  ITransport,
  TransportType,
  MCPRequest,
  MCPResponse,
  MCPNotification,
  RequestHandler,
  NotificationHandler,
  TransportHealthStatus,
  ILogger,
  AuthConfig,
} from '../types.js';

export interface HttpTransportConfig {
  host: string;
  port: number;
  tlsEnabled?: boolean;
  tlsCert?: string;
  tlsKey?: string;
  corsEnabled?: boolean;
  corsOrigins?: string[];
  auth?: AuthConfig;
  maxRequestSize?: string;
  requestTimeout?: number;
}

export class HttpTransport extends EventEmitter implements ITransport {
  public readonly type: TransportType = 'http';

  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private app: Express;
  private server?: Server;
  private wss?: WebSocketServer;
  private running = false;
  private activeConnections = new Set<WebSocket>();

  private messagesReceived = 0;
  private messagesSent = 0;
  private errors = 0;
  private httpRequests = 0;
  private wsMessages = 0;

  constructor(
    private readonly logger: ILogger,
    private readonly config: HttpTransportConfig
  ) {
    super();
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('HTTP transport already running');
    }

    const bindHost = this.resolveBindHost();

    this.logger.info('Starting HTTP transport', {
      host: bindHost,
      port: this.config.port,
    });

    this.server = createServer(this.app);

    this.wss = new WebSocketServer({
      server: this.server,
      path: '/ws',
      // SECURITY: mirror websocket.ts's standalone server — without an
      // explicit maxPayload, `ws` defaults to 100MiB, which is 10x larger
      // than the HTTP side's maxRequestSize and lets a WS client force
      // memory allocations the HTTP body-size limit was meant to prevent.
      maxPayload: this.parseMaxRequestSizeBytes(),
    });

    this.setupWebSocketHandlers();

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, bindHost, () => {
        resolve();
      });
      this.server!.on('error', reject);
    });

    this.running = true;
    this.logger.info('HTTP transport started', {
      url: `http://${bindHost}:${this.config.port}`,
    });
  }

  /**
   * SECURITY: Refuse to bind unauthenticated servers to a non-loopback
   * interface. Without `auth` configured, `handleHttpRequest` processes
   * every request without validating credentials — that is only acceptable
   * on loopback. If the operator asked for a non-loopback host with no auth,
   * fall back to 127.0.0.1 unless they explicitly opt in via
   * MONOMIND_MCP_ALLOW_REMOTE=1 (matching the CLI's own remote-bind gate).
   */
  private resolveBindHost(): string {
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
          'to anyone who can reach this host/port.'
      );
      return configuredHost;
    }

    this.logger.warn(
      `SECURITY: refusing to bind HTTP transport to non-loopback host "${configuredHost}" with ` +
        'no "auth" configured. Falling back to 127.0.0.1. Set MONOMIND_MCP_ALLOW_REMOTE=1 to ' +
        'override (unsafe) or configure "auth" with tokens.'
    );
    return '127.0.0.1';
  }

  /**
   * SECURITY: Parses the same `maxRequestSize` string used for the HTTP
   * body-size limit (e.g. "10mb") into a byte count for the embedded
   * WebSocketServer's `maxPayload` option, so both sides of this transport
   * enforce the same ceiling.
   */
  private parseMaxRequestSizeBytes(): number {
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

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping HTTP transport');
    this.running = false;

    for (const ws of this.activeConnections) {
      try {
        ws.close(1000, 'Server shutting down');
      } catch {
        // Ignore errors
      }
    }
    this.activeConnections.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }

    this.logger.info('HTTP transport stopped');
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
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

  private setupMiddleware(): void {
    this.app.use(helmet({
      contentSecurityPolicy: false,
    }));

    if (this.config.corsEnabled !== false) {
      const allowedOrigins = this.config.corsOrigins;

      if (!allowedOrigins || allowedOrigins.length === 0) {
        this.logger.warn('CORS: No origins configured, restricting to same-origin only');
      }

      this.app.use(cors({
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
      }));
    }

    this.app.use(express.json({
      limit: this.config.maxRequestSize || '10mb',
    }));

    if (this.config.requestTimeout) {
      this.app.use((req, res, next) => {
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

  private setupRoutes(): void {
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        connections: this.activeConnections.size,
      });
    });

    this.app.post('/rpc', async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    this.app.post('/mcp', async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    this.app.get('/info', (req, res) => {
      res.json({
        name: 'Monomind MCP Server V1',
        version: '3.0.0',
        transport: 'http',
        capabilities: {
          jsonrpc: true,
          websocket: true,
        },
      });
    });

    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not found',
        path: req.path,
      });
    });

    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      this.logger.error('Express error', { error: err });
      this.errors++;
      res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal error' },
      });
    });
  }

  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    // SECURITY: Handle WebSocket authentication via upgrade request
    this.wss.on('connection', (ws, req) => {
      // Validate authentication if enabled
      if (this.config.auth?.enabled) {
        // SECURITY: prefer the Authorization header sent during the WS
        // upgrade handshake over a query-string credential — URLs land in
        // access logs and intermediate proxy logs. Only fall back to the
        // query param for clients that cannot set upgrade headers.
        const authHeader = req.headers.authorization;
        const fromHeader = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : undefined;
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const fromQuery = url.searchParams.get('token');
        const credential = fromHeader || fromQuery || undefined;

        if (!credential) {
          this.logger.warn('WebSocket connection rejected: no authentication token');
          ws.close(4001, 'Authentication required');
          return;
        }

        // SECURITY: Timing-safe token validation
        let valid = false;
        if (this.config.auth.tokens?.length) {
          for (const validToken of this.config.auth.tokens) {
            if (this.timingSafeCompare(credential, validToken)) {
              valid = true;
              break;
            }
          }
        }

        if (!valid) {
          this.logger.warn('WebSocket connection rejected: invalid token');
          ws.close(4003, 'Invalid token');
          return;
        }
      }

      this.activeConnections.add(ws);
      this.logger.info('WebSocket client connected', {
        total: this.activeConnections.size,
        authenticated: !!this.config.auth?.enabled,
      });

      ws.on('message', async (data) => {
        await this.handleWebSocketMessage(ws, data.toString());
      });

      ws.on('close', () => {
        this.activeConnections.delete(ws);
        this.logger.info('WebSocket client disconnected', {
          total: this.activeConnections.size,
        });
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error', { error });
        this.errors++;
        this.activeConnections.delete(ws);
      });
    });
  }

  private async handleHttpRequest(req: Request, res: Response): Promise<void> {
    this.httpRequests++;
    this.messagesReceived++;

    const requiresAuth = this.config.auth?.enabled !== false;

    if (requiresAuth && this.config.auth) {
      const authResult = this.validateAuth(req);
      if (!authResult.valid) {
        this.logger.warn('Authentication failed', {
          ip: req.ip,
          path: req.path,
          error: authResult.error,
        });
        res.status(401).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32001, message: 'Unauthorized' },
        });
        return;
      }
    } else if (requiresAuth && !this.config.auth) {
      // SECURITY: loud warning on every request, not an info-level note —
      // credentials are not being validated on this transport at all.
      // resolveBindHost() keeps this safe by default (loopback bind only).
      this.logger.warn(
        'SECURITY WARNING: MCP HTTP transport has no auth policy configured; ' +
          'this request is being processed without checking any credentials. ' +
          'Set an auth policy with tokens to require authentication.'
      );
    }

    try {
      const message = req.body;

      // SECURITY: express.json() only populates req.body when the request's
      // Content-Type matches its configured type (application/json). Any
      // other content type (or a missing body) leaves req.body undefined,
      // which previously crashed this handler on `message.jsonrpc` — an
      // uncaught TypeError inside an async Express route that Express 4
      // does not catch, producing an unhandled rejection that can bring
      // down the whole process. Guard explicitly before touching it.
      if (!message || typeof message !== 'object') {
        res.status(400).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32600,
            message: 'Invalid request: expected a JSON object body with Content-Type: application/json',
          },
        });
        return;
      }

      if (message.jsonrpc !== '2.0') {
        res.status(400).json({
          jsonrpc: '2.0',
          id: message.id || null,
          error: { code: -32600, message: 'Invalid JSON-RPC version' },
        });
        return;
      }

      if (!message.method) {
        res.status(400).json({
          jsonrpc: '2.0',
          id: message.id || null,
          error: { code: -32600, message: 'Missing method' },
        });
        return;
      }

      if (message.id === undefined) {
        if (this.notificationHandler) {
          await this.notificationHandler(message as MCPNotification);
        }
        res.status(204).end();
      } else {
        if (!this.requestHandler) {
          res.status(500).json({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32603, message: 'No request handler' },
          });
          return;
        }

        try {
          const response = await this.requestHandler(message as MCPRequest);
          res.json(response);
          this.messagesSent++;
        } catch (error) {
          this.errors++;
          res.status(500).json({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : 'Internal error',
            },
          });
        }
      }
    } catch (error) {
      // SECURITY: catch-all so ANY unexpected exception in this handler
      // (malformed body, unexpected shape, etc.) produces a JSON-RPC error
      // response instead of an unhandled promise rejection that can crash
      // the process under Node's default --unhandled-rejections=throw.
      this.errors++;
      this.logger.error('Unexpected error handling HTTP request', { error });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal error',
          },
        });
      }
    }
  }

  private async handleWebSocketMessage(ws: WebSocket, data: string): Promise<void> {
    this.wsMessages++;
    this.messagesReceived++;

    try {
      const message = JSON.parse(data);

      if (message.jsonrpc !== '2.0') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id || null,
          error: { code: -32600, message: 'Invalid JSON-RPC version' },
        }));
        return;
      }

      if (message.id === undefined) {
        if (this.notificationHandler) {
          await this.notificationHandler(message as MCPNotification);
        }
      } else {
        if (!this.requestHandler) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32603, message: 'No request handler' },
          }));
          return;
        }

        const response = await this.requestHandler(message as MCPRequest);
        ws.send(JSON.stringify(response));
        this.messagesSent++;
      }
    } catch (error) {
      this.errors++;
      this.logger.error('WebSocket message error', { error });

      try {
        const parsed = JSON.parse(data);
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id || null,
          error: { code: -32700, message: 'Parse error' },
        }));
      } catch {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }));
      }
    }
  }

  /**
   * SECURITY: Timing-safe token comparison to prevent timing attacks
   */
  private timingSafeCompare(a: string, b: string): boolean {
    const crypto = require('crypto');

    // Ensure both strings are the same length for timing-safe comparison
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');

    // If lengths differ, still do a comparison to prevent length-based timing
    if (bufA.length !== bufB.length) {
      // Compare against itself to maintain constant time
      crypto.timingSafeEqual(bufA, bufA);
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }

  private validateAuth(req: Request): { valid: boolean; error?: string } {
    const auth = req.headers.authorization;

    if (!auth) {
      return { valid: false, error: 'Authorization header required' };
    }

    const tokenMatch = auth.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) {
      return { valid: false, error: 'Invalid authorization format' };
    }

    const token = tokenMatch[1];

    // SECURITY: an empty/missing token list with auth.enabled=true must
    // reject every request (reject-all). The previous `if (tokens?.length)`
    // guard skipped validation entirely when the list was empty, which
    // accepted ANY bearer value as valid (accept-all).
    const configuredTokens = this.config.auth?.tokens;
    if (!configuredTokens || configuredTokens.length === 0) {
      return { valid: false, error: 'No tokens configured for authentication' };
    }

    let valid = false;
    for (const validToken of configuredTokens) {
      // SECURITY: Use timing-safe comparison to prevent timing attacks
      if (this.timingSafeCompare(token, validToken)) {
        valid = true;
        break;
      }
    }
    if (!valid) {
      return { valid: false, error: 'Invalid token' };
    }

    return { valid: true };
  }
}

export function createHttpTransport(
  logger: ILogger,
  config: HttpTransportConfig
): HttpTransport {
  return new HttpTransport(logger, config);
}
