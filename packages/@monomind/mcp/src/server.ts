/**
 * @monoes/mcp - MCP Server
 *
 * High-performance MCP server implementation
 */

import { buildDiscoverResult, checkRequestedVersion, isModernRequest } from './modern.js';
import { MCPServerRouting } from './server-routing.js';
import { createTransport } from './transport/index.js';
import type {
  ILogger,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPNotification,
  MCPRequest,
  MCPResponse,
  MCPServerConfig,
  MCPServerMetrics,
  MCPSession,
  MCPTool,
} from './types.js';
import { ErrorCodes, MCPServerError } from './types.js';

export interface IMCPServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerTool(tool: MCPTool): boolean;
  registerTools(tools: MCPTool[]): { registered: number; failed: string[] };
  getHealthStatus(): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }>;
  getMetrics(): MCPServerMetrics;
  getSessions(): MCPSession[];
  getSession(sessionId: string): MCPSession | undefined;
  terminateSession(sessionId: string): boolean;
}

export class MCPServer extends MCPServerRouting implements IMCPServer {
  async start(): Promise<void> {
    if (this.running) {
      throw new MCPServerError('Server already running');
    }

    const startTime = performance.now();
    this.startTime = new Date();

    this.logger.info('Starting MCP server', {
      name: this.config.name,
      version: this.config.version,
      transport: this.config.transport,
    });

    try {
      this.transport = createTransport(this.config.transport, this.logger, {
        type: this.config.transport,
        host: this.config.host,
        port: this.config.port,
        corsEnabled: this.config.corsEnabled,
        corsOrigins: this.config.corsOrigins,
        auth: this.config.auth,
        maxRequestSize: String(this.config.maxRequestSize),
        requestTimeout: this.config.requestTimeout,
      } as any);

      this.transport.onRequest(async (request, connectionId) => {
        return await this.handleRequest(request, connectionId);
      });

      this.transport.onNotification(async (notification, connectionId) => {
        await this.handleNotification(notification, connectionId);
      });

      // Transports that support multiple concurrent clients (http, websocket)
      // report when a connection closes so its session can be torn down —
      // without this a disconnected client's session (and any resource
      // subscriptions) would leak for the full sessionTimeout.
      this.transport.onConnectionClose?.((connectionId) => {
        this.closeConnectionSession(connectionId);
      });

      await this.transport.start();
      await this.registerBuiltInTools();
      this.registerBuiltInResources();
      this.registerBuiltInPrompts();

      this.running = true;
      this.startupDuration = performance.now() - startTime;

      this.logger.info('MCP server started', {
        startupTime: `${this.startupDuration.toFixed(2)}ms`,
        tools: this.toolRegistry.getToolCount(),
      });

      this.emit('server:started', {
        startupTime: this.startupDuration,
        tools: this.toolRegistry.getToolCount(),
      });
    } catch (error) {
      this.logger.error('Failed to start MCP server', { error });
      throw new MCPServerError('Failed to start server', ErrorCodes.INTERNAL_ERROR, { error });
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping MCP server');

    try {
      if (this.transport) {
        await this.transport.stop();
        this.transport = undefined;
      }

      // PKG-1: destroy() runs stopCleanupTimer + clearAll + removeAllListeners.
      // clearAll() alone left the SessionManager cleanup interval (setInterval
      // at session-manager.ts:303) firing forever after stop().
      this.sessionManager.destroy();
      this.taskManager.destroy();
      // Safety net: detach any subscription whose session already vanished
      // without a session:closed event reaching the purge handler.
      for (const sessionId of [...this.resourceSubscriptions.keys()]) {
        this.purgeSessionSubscriptions(sessionId);
      }
      this.resourceSubscriptions.clear();
      this.rateLimiter.destroy();

      if (this.connectionPool) {
        await this.connectionPool.clear();
      }

      this.running = false;
      this.currentSession = undefined;
      this.connectionSessions.clear();

      this.logger.info('MCP server stopped');
      this.emit('server:stopped');
    } catch (error) {
      this.logger.error('Error stopping MCP server', { error });
      throw error;
    }
  }

  terminateSession(sessionId: string): boolean {
    const result = this.sessionManager.closeSession(sessionId, 'Terminated by server');
    if (this.currentSession?.id === sessionId) {
      this.currentSession = undefined;
    }
    for (const [connectionId, session] of this.connectionSessions) {
      if (session.id === sessionId) {
        this.connectionSessions.delete(connectionId);
      }
    }
    return result;
  }

  private async handleRequest(request: MCPRequest, connectionId?: string): Promise<MCPResponse> {
    const startTime = performance.now();
    this.requestStats.total++;

    this.logger.debug('Handling request', {
      id: request.id,
      method: request.method,
    });

    // Rate limiting check (skip for initialize)
    if (request.method !== 'initialize') {
      const sessionId = this.getSessionForConnection(connectionId)?.id;
      const rateLimitResult = this.rateLimiter.check(sessionId);
      if (!rateLimitResult.allowed) {
        this.requestStats.failed++;
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32000,
            message: 'Rate limit exceeded',
            data: { retryAfter: rateLimitResult.retryAfter },
          },
        };
      }
      this.rateLimiter.consume(sessionId);
    }

    try {
      if (request.method === 'initialize') {
        return await this.handleInitialize(request, connectionId);
      }

      const versionError = checkRequestedVersion(request.params);
      if (versionError) {
        this.requestStats.failed++;
        return { jsonrpc: '2.0', id: request.id, error: versionError };
      }

      if (request.method === 'server/discover') {
        this.requestStats.successful++;
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: buildDiscoverResult(this.serverInfo, this.capabilities),
        };
      }

      const session = this.getOrCreateSession(connectionId);

      // A modern (2026-07-28) request is stateless: it declares its own
      // version and needs no prior `initialize`.
      if (
        !session.isInitialized &&
        request.method !== 'initialized' &&
        !isModernRequest(request.params)
      ) {
        return this.createErrorResponse(
          request.id,
          ErrorCodes.SERVER_NOT_INITIALIZED,
          'Server not initialized',
        );
      }

      this.sessionManager.updateActivity(session.id);

      const response = await this.routeRequest(request, connectionId);

      const duration = performance.now() - startTime;
      this.requestStats.successful++;
      this.requestStats.totalResponseTime += duration;

      this.logger.debug('Request completed', {
        id: request.id,
        method: request.method,
        duration: `${duration.toFixed(2)}ms`,
      });

      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.requestStats.failed++;
      this.requestStats.totalResponseTime += duration;

      this.logger.error('Request failed', {
        id: request.id,
        method: request.method,
        error,
      });

      return this.createErrorResponse(
        request.id,
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Internal error',
      );
    }
  }

  private async handleNotification(
    notification: MCPNotification,
    _connectionId?: string,
  ): Promise<void> {
    this.logger.debug('Handling notification', { method: notification.method });

    switch (notification.method) {
      case 'initialized':
        this.logger.info('Client initialized notification received');
        break;

      case 'notifications/cancelled':
        this.logger.debug('Request cancelled', notification.params);
        break;

      default:
        this.logger.debug('Unknown notification', { method: notification.method });
    }
  }

  private async handleInitialize(request: MCPRequest, connectionId?: string): Promise<MCPResponse> {
    const params = request.params as unknown as MCPInitializeParams | undefined;

    if (!params) {
      return this.createErrorResponse(request.id, ErrorCodes.INVALID_PARAMS, 'Invalid params');
    }

    const session = this.sessionManager.createSession(this.config.transport);
    this.sessionManager.initializeSession(session.id, params);
    this.bindSessionToConnection(session, connectionId);

    const result: MCPInitializeResult = {
      protocolVersion: this.protocolVersion,
      capabilities: this.capabilities,
      serverInfo: this.serverInfo,
      instructions: 'Monomind MCP Server V1 ready for tool execution',
    };

    this.logger.info('Session initialized', {
      sessionId: session.id,
      clientInfo: params.clientInfo,
    });

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };
  }
}

export function createMCPServer(
  config: Partial<MCPServerConfig>,
  logger: ILogger,
  orchestrator?: unknown,
  swarmCoordinator?: unknown,
): MCPServer {
  return new MCPServer(config, logger, orchestrator, swarmCoordinator);
}
