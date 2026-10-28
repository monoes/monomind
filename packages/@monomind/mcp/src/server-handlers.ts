/**
 * @monoes/mcp - MCP Server (tool, resource and prompt handlers)
 */

import { withCacheHints } from './modern.js';
import { MCPServerBuiltins } from './server-builtins.js';
import type { MCPRequest, MCPResponse, ToolContext } from './types.js';
import { ErrorCodes } from './types.js';

export abstract class MCPServerHandlers extends MCPServerBuiltins {
  protected handleToolsList(request: MCPRequest): MCPResponse {
    const tools = this.toolRegistry.listTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: this.toolRegistry.getTool(t.name)?.inputSchema,
    }));

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: withCacheHints({ tools }),
    };
  }

  protected async handleToolsCall(
    request: MCPRequest,
    connectionId?: string,
  ): Promise<MCPResponse> {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };

    if (!params?.name) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Tool name is required',
      );
    }

    const context: ToolContext = {
      sessionId: this.getSessionForConnection(connectionId)?.id || 'unknown',
      requestId: request.id,
      orchestrator: this.orchestrator,
      swarmCoordinator: this.swarmCoordinator,
    };

    const result = await this.toolRegistry.execute(params.name, params.arguments || {}, context);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };
  }

  protected async handleToolExecution(
    request: MCPRequest,
    connectionId?: string,
  ): Promise<MCPResponse> {
    const context: ToolContext = {
      sessionId: this.getSessionForConnection(connectionId)?.id || 'unknown',
      requestId: request.id,
      orchestrator: this.orchestrator,
      swarmCoordinator: this.swarmCoordinator,
    };

    const result = await this.toolRegistry.execute(
      request.method,
      (request.params as Record<string, unknown>) || {},
      context,
    );

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };
  }

  // ============================================================================
  // Resource Handlers (MCP 2025-11-25)
  // ============================================================================

  protected handleResourcesList(request: MCPRequest): MCPResponse {
    const params = request.params as { cursor?: string } | undefined;
    const result = this.resourceRegistry.list(params?.cursor);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: withCacheHints(result),
    };
  }

  protected async handleResourcesRead(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as { uri: string } | undefined;

    if (!params?.uri) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Resource URI is required',
      );
    }

    try {
      const result = await this.resourceRegistry.read(params.uri);
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        error instanceof Error ? error.message : 'Resource read failed',
      );
    }
  }

  protected handleResourcesSubscribe(request: MCPRequest, connectionId?: string): MCPResponse {
    const params = request.params as { uri: string } | undefined;
    const sessionId = this.getSessionForConnection(connectionId)?.id;

    if (!params?.uri) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Resource URI is required',
      );
    }

    if (!sessionId) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.SERVER_NOT_INITIALIZED,
        'No active session',
      );
    }

    try {
      // Track subscription for this session
      let sessionSubs = this.resourceSubscriptions.get(sessionId);
      if (!sessionSubs) {
        sessionSubs = new Map();
        this.resourceSubscriptions.set(sessionId, sessionSubs);
      }

      // Re-subscribing the same URI replaces the previous subscription —
      // otherwise the old callback would keep firing with no way to reach it.
      const existingId = sessionSubs.get(params.uri);
      if (existingId) {
        this.resourceRegistry.unsubscribe(existingId);
      }

      const subscriptionId = this.resourceRegistry.subscribe(params.uri, (uri, _content) => {
        // Send notification when resource updates
        this.sendNotification('notifications/resources/updated', { uri });
      });

      sessionSubs.set(params.uri, subscriptionId);

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { subscriptionId },
      };
    } catch (error) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Subscription failed',
      );
    }
  }

  protected handleResourcesUnsubscribe(request: MCPRequest, connectionId?: string): MCPResponse {
    const params = request.params as { uri: string } | undefined;
    const sessionId = this.getSessionForConnection(connectionId)?.id;

    if (!params?.uri) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Resource URI is required',
      );
    }

    if (sessionId) {
      const sessionSubs = this.resourceSubscriptions.get(sessionId);
      const subscriptionId = sessionSubs?.get(params.uri);
      if (sessionSubs && subscriptionId) {
        // Actually detach the registry callback — just forgetting the URI
        // locally left the callback live, producing phantom notifications
        // (issue #92).
        this.resourceRegistry.unsubscribe(subscriptionId);
        sessionSubs.delete(params.uri);
        if (sessionSubs.size === 0) {
          this.resourceSubscriptions.delete(sessionId);
        }
      }
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { success: true },
    };
  }

  // ============================================================================
  // Prompt Handlers (MCP 2025-11-25)
  // ============================================================================

  protected handlePromptsList(request: MCPRequest): MCPResponse {
    const params = request.params as { cursor?: string } | undefined;
    const result = this.promptRegistry.list(params?.cursor);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: withCacheHints(result),
    };
  }

  protected async handlePromptsGet(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as
      | { name: string; arguments?: Record<string, string> }
      | undefined;

    if (!params?.name) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Prompt name is required',
      );
    }

    try {
      const result = await this.promptRegistry.get(params.name, params.arguments);
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        error instanceof Error ? error.message : 'Prompt get failed',
      );
    }
  }
}
