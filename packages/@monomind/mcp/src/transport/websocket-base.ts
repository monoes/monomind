/**
 * @monoes/mcp - WebSocket Transport (base)
 *
 * Connection state, bind-host policy, client bookkeeping, heartbeat and
 * message (de)serialization shared by WebSocketTransport (websocket.ts).
 */

import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { type RawData, WebSocket, type WebSocketServer } from 'ws';
import type {
  AuthConfig,
  ConnectionCloseHandler,
  ILogger,
  MCPNotification,
  MCPResponse,
  NotificationHandler,
  RequestHandler,
  TransportHealthStatus,
  TransportType,
} from '../types.js';

export interface WebSocketTransportConfig {
  host: string;
  port: number;
  path?: string;
  maxConnections?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  maxMessageSize?: number;
  auth?: AuthConfig;
  enableBinaryMode?: boolean;
  /** Extra upgrade Origins besides loopback ('*' allows all). */
  allowedOrigins?: string[];
  corsOrigins?: string[];
  /** Extra Host names besides loopback and `host`. */
  allowedHosts?: string[];
}

export interface ClientConnection {
  id: string;
  ws: WebSocket;
  createdAt: Date;
  lastActivity: Date;
  messageCount: number;
  isAlive: boolean;
  isAuthenticated: boolean;
}

export abstract class WebSocketTransportBase extends EventEmitter {
  public readonly type: TransportType = 'websocket';

  protected requestHandler?: RequestHandler;
  protected notificationHandler?: NotificationHandler;
  protected connectionCloseHandler?: ConnectionCloseHandler;
  protected server?: Server;
  protected wss?: WebSocketServer;
  protected clients: Map<string, ClientConnection> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;
  protected running = false;
  protected connectionCounter = 0;

  protected messagesReceived = 0;
  protected messagesSent = 0;
  protected errors = 0;
  protected totalConnections = 0;

  constructor(
    protected readonly logger: ILogger,
    protected readonly config: WebSocketTransportConfig,
  ) {
    super();
  }

  /**
   * SECURITY: Refuse to bind unauthenticated servers to a non-loopback
   * interface. Without `auth` configured, every connecting client is marked
   * `isAuthenticated: true` (see setupWebSocketHandlers) — that is only
   * acceptable on loopback. Mirrors http.ts's resolveBindHost().
   */
  protected resolveBindHost(): string {
    const configuredHost = this.config.host;

    if (this.config.auth) {
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
        `SECURITY WARNING: WebSocket transport is binding to non-loopback host "${configuredHost}" ` +
          'with NO authentication configured. MONOMIND_MCP_ALLOW_REMOTE=1 opt-in detected — ' +
          'every client will be treated as authenticated. This exposes every registered tool ' +
          'to anyone who can reach this host/port.',
      );
      return configuredHost;
    }

    this.logger.warn(
      `SECURITY: refusing to bind WebSocket transport to non-loopback host "${configuredHost}" with ` +
        'no "auth" configured. Falling back to 127.0.0.1. Set MONOMIND_MCP_ALLOW_REMOTE=1 to ' +
        'override (unsafe) or configure "auth" with tokens.',
    );
    return '127.0.0.1';
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping WebSocket transport');
    this.running = false;

    this.stopHeartbeat();

    for (const client of this.clients.values()) {
      try {
        client.ws.close(1000, 'Server shutting down');
      } catch {
        // Ignore errors
      }
    }
    this.clients.clear();

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

    this.logger.info('WebSocket transport stopped');
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

  async getHealthStatus(): Promise<TransportHealthStatus> {
    return {
      healthy: this.running,
      metrics: {
        messagesReceived: this.messagesReceived,
        messagesSent: this.messagesSent,
        errors: this.errors,
        activeConnections: this.clients.size,
        totalConnections: this.totalConnections,
      },
    };
  }

  async sendNotification(notification: MCPNotification): Promise<void> {
    const message = this.serializeMessage(notification);

    for (const client of this.clients.values()) {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(message);
          this.messagesSent++;
        }
      } catch (error) {
        this.logger.error('Failed to send notification', { clientId: client.id, error });
        this.errors++;
      }
    }
  }

  async sendToClient(clientId: string, notification: MCPNotification): Promise<boolean> {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      client.ws.send(this.serializeMessage(notification));
      this.messagesSent++;
      return true;
    } catch (error) {
      this.logger.error('Failed to send to client', { clientId, error });
      this.errors++;
      return false;
    }
  }

  getClients(): string[] {
    return Array.from(this.clients.keys());
  }

  getClientInfo(clientId: string): ClientConnection | undefined {
    return this.clients.get(clientId);
  }

  disconnectClient(clientId: string, reason = 'Disconnected by server'): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    try {
      client.ws.close(1000, reason);
      return true;
    } catch {
      return false;
    }
  }

  protected parseMessage(data: RawData): any {
    if (this.config.enableBinaryMode && Buffer.isBuffer(data)) {
      return JSON.parse(data.toString());
    }
    return JSON.parse(data.toString());
  }

  protected serializeMessage(message: MCPResponse | MCPNotification): string | Buffer {
    if (this.config.enableBinaryMode) {
      return JSON.stringify(message);
    }
    return JSON.stringify(message);
  }

  protected startHeartbeat(): void {
    const interval = this.config.heartbeatInterval || 30000;

    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients.values()) {
        if (!client.isAlive) {
          this.logger.warn('Client heartbeat timeout', { id: client.id });
          client.ws.terminate();
          this.clients.delete(client.id);
          continue;
        }

        client.isAlive = false;
        try {
          client.ws.ping();
        } catch {
          // Ignore ping errors
        }
      }
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
