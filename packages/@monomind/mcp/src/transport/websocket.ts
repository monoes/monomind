/**
 * @monoes/mcp - WebSocket Transport
 *
 * Standalone WebSocket transport with heartbeat
 */

import { createServer } from 'node:http';
import { type RawData, WebSocketServer } from 'ws';
import { validateCredential } from '../auth.js';
import type { ILogger, ITransport, MCPNotification, MCPRequest, MCPResponse } from '../types.js';
import { isAllowedHost, isAllowedOrigin } from './origin-guard.js';
import {
  type ClientConnection,
  WebSocketTransportBase,
  type WebSocketTransportConfig,
} from './websocket-base.js';

export type { WebSocketTransportConfig } from './websocket-base.js';

export class WebSocketTransport extends WebSocketTransportBase implements ITransport {
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('WebSocket transport already running');
    }

    const bindHost = this.resolveBindHost();

    this.logger.info('Starting WebSocket transport', {
      host: bindHost,
      port: this.config.port,
      path: this.config.path || '/ws',
    });

    this.server = createServer((_req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('Upgrade Required - WebSocket connection expected');
    });

    this.wss = new WebSocketServer({
      server: this.server,
      path: this.config.path || '/ws',
      maxPayload: this.config.maxMessageSize || 10 * 1024 * 1024,
      perMessageDeflate: true,
      // SECURITY: refuse cross-origin browser upgrades and rebound Host names.
      verifyClient: (info, done) => {
        const { host, origin } = info.req.headers;
        const ok =
          isAllowedHost(host, [...(this.config.allowedHosts ?? []), this.config.host]) &&
          isAllowedOrigin(info.origin || origin, [
            ...(this.config.allowedOrigins ?? []),
            ...(this.config.corsOrigins ?? []),
          ]);
        if (!ok) {
          this.logger.warn('WebSocket upgrade rejected: Origin/Host not allowed', { origin, host });
        }
        done(ok, 403, 'Forbidden');
      },
    });

    this.setupWebSocketHandlers();
    this.startHeartbeat();

    await new Promise<void>((resolve, reject) => {
      this.server?.listen(this.config.port, bindHost, () => {
        resolve();
      });
      this.server?.on('error', reject);
    });

    this.running = true;
    this.logger.info('WebSocket transport started', {
      url: `ws://${bindHost}:${this.config.port}${this.config.path || '/ws'}`,
    });
  }

  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws) => {
      if (this.config.maxConnections && this.clients.size >= this.config.maxConnections) {
        this.logger.warn('Max connections reached, rejecting client');
        ws.close(1013, 'Server at capacity');
        return;
      }

      const clientId = `client-${++this.connectionCounter}`;
      const client: ClientConnection = {
        id: clientId,
        ws,
        createdAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        isAlive: true,
        isAuthenticated: !this.config.auth?.enabled,
      };

      this.clients.set(clientId, client);
      this.totalConnections++;

      this.logger.info('Client connected', {
        id: clientId,
        total: this.clients.size,
      });

      ws.on('message', async (data) => {
        await this.handleMessage(client, data);
      });

      ws.on('pong', () => {
        client.isAlive = true;
      });

      ws.on('close', (code, reason) => {
        this.clients.delete(clientId);
        this.logger.info('Client disconnected', {
          id: clientId,
          code,
          reason: reason.toString(),
          total: this.clients.size,
        });
        this.emit('client:disconnected', clientId);
        this.connectionCloseHandler?.(clientId);
      });

      ws.on('error', (error) => {
        this.logger.error('Client error', { id: clientId, error });
        this.errors++;
        this.clients.delete(clientId);
        this.connectionCloseHandler?.(clientId);
      });

      this.emit('client:connected', clientId);
    });
  }

  private async handleMessage(client: ClientConnection, data: RawData): Promise<void> {
    client.lastActivity = new Date();
    client.messageCount++;
    this.messagesReceived++;

    try {
      const message = this.parseMessage(data);

      if (!client.isAuthenticated && this.config.auth?.enabled) {
        if (message.method === 'authenticate') {
          // SECURITY: this is the ONLY path that may set isAuthenticated.
          // The previous version accepted this branch and fell through to
          // dispatch the 'authenticate' message itself to the request
          // handler without ever validating the token or flipping the flag —
          // a permanent lockout for legit clients plus an auth-check bypass
          // for the message that was supposed to perform the check.
          this.handleAuthenticate(client, message);
          return;
        }

        client.ws.send(
          this.serializeMessage({
            jsonrpc: '2.0',
            id: message.id || null,
            error: { code: -32001, message: 'Authentication required' },
          } as MCPResponse),
        );
        return;
      }

      if (message.jsonrpc !== '2.0') {
        client.ws.send(
          this.serializeMessage({
            jsonrpc: '2.0',
            id: message.id || null,
            error: { code: -32600, message: 'Invalid JSON-RPC version' },
          } as MCPResponse),
        );
        return;
      }

      if (message.id === undefined) {
        if (this.notificationHandler) {
          await this.notificationHandler(message as MCPNotification, client.id);
        }
      } else {
        if (!this.requestHandler) {
          client.ws.send(
            this.serializeMessage({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32603, message: 'No request handler' },
            } as MCPResponse),
          );
          return;
        }

        const startTime = performance.now();
        const response = await this.requestHandler(message as MCPRequest, client.id);
        const duration = performance.now() - startTime;

        this.logger.debug('Request processed', {
          clientId: client.id,
          method: message.method,
          duration: `${duration.toFixed(2)}ms`,
        });

        client.ws.send(this.serializeMessage(response));
        this.messagesSent++;
      }
    } catch (error) {
      this.errors++;
      this.logger.error('Message handling error', { clientId: client.id, error });

      try {
        client.ws.send(
          this.serializeMessage({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          } as MCPResponse),
        );
      } catch {
        // Ignore send errors
      }
    }
  }

  /**
   * SECURITY: Real `authenticate` handler. Routes through the SAME
   * validateCredential() the HTTP transport uses instead of a private
   * comparison against only `config.auth.tokens` — previously this always
   * failed for a server configured with the api-key method, silently
   * ignoring `method`/`apiKeys` entirely. The credential field is
   * synthesized into a Bearer authorization value so the previously
   * supported flow behaves exactly as it did before. Only sets
   * `client.isAuthenticated = true` on success. The `authenticate` message
   * itself is never forwarded to `requestHandler` — a response is sent
   * directly here regardless of outcome.
   */
  private handleAuthenticate(client: ClientConnection, message: any): void {
    const params = (message?.params ?? {}) as Record<string, unknown>;
    const result = this.resolveAuthResult(params);

    if (result.valid) {
      client.isAuthenticated = true;
      this.logger.info('WebSocket client authenticated', { clientId: client.id });
      client.ws.send(
        this.serializeMessage({
          jsonrpc: '2.0',
          id: message?.id ?? null,
          result: { authenticated: true },
        } as MCPResponse),
      );
    } else {
      this.logger.warn('WebSocket authenticate failed', {
        clientId: client.id,
        error: result.error,
      });
      client.ws.send(
        this.serializeMessage({
          jsonrpc: '2.0',
          id: message?.id ?? null,
          error: { code: -32001, message: 'Authentication failed' },
        } as MCPResponse),
      );
    }
  }

  private resolveAuthResult(params: Record<string, unknown>): { valid: boolean; error?: string } {
    const authConfig = this.config.auth;
    if (!authConfig) return { valid: false, error: 'No auth config' };

    let authHeader: string | undefined;
    const field1 = params.token;
    if (typeof field1 === 'string') authHeader = `Bearer ${field1}`;

    let keyHeader: string | undefined;
    const field2 = params.apiKey;
    if (typeof field2 === 'string') keyHeader = field2;

    return validateCredential(authConfig, authHeader, keyHeader);
  }
}

export function createWebSocketTransport(
  logger: ILogger,
  config: WebSocketTransportConfig,
): WebSocketTransport {
  return new WebSocketTransport(logger, config);
}
