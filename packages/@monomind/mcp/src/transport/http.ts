/**
 * @monoes/mcp - HTTP Transport
 *
 * HTTP/REST transport with WebSocket support
 */

import { createServer } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { type WebSocket, WebSocketServer } from 'ws';
import { validateCredential } from '../auth.js';
import { HEADER_MISMATCH, validateModernHeaders } from '../modern.js';
import type { ILogger, ITransport, MCPNotification, MCPRequest } from '../types.js';
import { HttpTransportBase, type HttpTransportConfig } from './http-base.js';

export type { HttpTransportConfig } from './http-base.js';

export class HttpTransport extends HttpTransportBase implements ITransport {
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
      this.server?.listen(this.config.port, bindHost, () => {
        resolve();
      });
      this.server?.on('error', reject);
    });

    this.running = true;
    this.logger.info('HTTP transport started', {
      url: `http://${bindHost}:${this.config.port}`,
    });
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
        this.server?.close(() => resolve());
      });
      this.server = undefined;
    }

    this.logger.info('HTTP transport stopped');
  }

  protected setupRoutes(): void {
    this.app.get('/health', (_req, res) => {
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

    this.app.get('/info', (_req, res) => {
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

    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
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
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        const fromQuery = url.searchParams.get('token');
        const apiKeyHeader = req.headers['x-api-key'] as string | undefined;
        // #110-review: the PRE-existing inline check's `.replace(/^Bearer\s+/i, '')`
        // was a no-op for a bare (non-'Bearer'-prefixed) Authorization header,
        // so a client sending the raw token value with no prefix authenticated
        // successfully — that behavior must not regress just because this now
        // routes through validateCredential(), whose 'token' branch requires a
        // literal 'Bearer ' prefix to match. Synthesize one when the header is
        // present but doesn't already carry it, same as the query-fallback case
        // right below already does.
        const authHeaderWithScheme = authHeader
          ? /^Bearer\s+/i.test(authHeader)
            ? authHeader
            : `Bearer ${authHeader}`
          : undefined;
        // synthesize a Bearer header from the query fallback so this goes
        // through the SAME validateCredential() the HTTP path uses — the
        // previous inline loop only ever checked `auth.tokens`, so an
        // `api-key`-configured server silently rejected every WS client.
        const effectiveAuthHeader =
          authHeaderWithScheme ?? (fromQuery ? `Bearer ${fromQuery}` : undefined);

        const authResult = validateCredential(this.config.auth, effectiveAuthHeader, apiKeyHeader);
        if (!authResult.valid) {
          const noCredentialOffered = !effectiveAuthHeader && !apiKeyHeader;
          this.logger.warn('WebSocket connection rejected', { error: authResult.error });
          ws.close(noCredentialOffered ? 4001 : 4003, authResult.error ?? 'Unauthorized');
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
        const connId = this.wsConnectionIds.get(ws);
        this.wsConnectionIds.delete(ws);
        if (connId) {
          this.connectionCloseHandler?.(connId);
        }
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error', { error });
        this.errors++;
        this.activeConnections.delete(ws);
        const connId = this.wsConnectionIds.get(ws);
        this.wsConnectionIds.delete(ws);
        if (connId) {
          this.connectionCloseHandler?.(connId);
        }
      });
    });
  }

  private async handleHttpRequest(req: Request, res: Response): Promise<void> {
    this.httpRequests++;
    this.messagesReceived++;

    const connectionId = this.getOrCreateHttpConnectionId(req.socket);

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
          'Set an auth policy with tokens to require authentication.',
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
            message:
              'Invalid request: expected a JSON object body with Content-Type: application/json',
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

      const headerError = validateModernHeaders(req.headers, message);
      if (headerError) {
        res.status(400).json({
          jsonrpc: '2.0',
          id: message.id ?? null,
          error: { code: HEADER_MISMATCH, message: headerError },
        });
        return;
      }

      if (message.id === undefined) {
        if (this.notificationHandler) {
          await this.notificationHandler(message as MCPNotification, connectionId);
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
          const response = await this.requestHandler(message as MCPRequest, connectionId);
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

    const connectionId = this.getOrCreateWsConnectionId(ws);

    try {
      const message = JSON.parse(data);

      if (message.jsonrpc !== '2.0') {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id || null,
            error: { code: -32600, message: 'Invalid JSON-RPC version' },
          }),
        );
        return;
      }

      if (message.id === undefined) {
        if (this.notificationHandler) {
          await this.notificationHandler(message as MCPNotification, connectionId);
        }
      } else {
        if (!this.requestHandler) {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32603, message: 'No request handler' },
            }),
          );
          return;
        }

        const response = await this.requestHandler(message as MCPRequest, connectionId);
        ws.send(JSON.stringify(response));
        this.messagesSent++;
      }
    } catch (error) {
      this.errors++;
      this.logger.error('WebSocket message error', { error });

      try {
        const parsed = JSON.parse(data);
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id || null,
            error: { code: -32700, message: 'Parse error' },
          }),
        );
      } catch {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          }),
        );
      }
    }
  }
}

export function createHttpTransport(logger: ILogger, config: HttpTransportConfig): HttpTransport {
  return new HttpTransport(logger, config);
}
