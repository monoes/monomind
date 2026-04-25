/**
 * @monobrain/mcp - Standalone MCP Server
 *
 * Zero-dependency MCP (Model Context Protocol) implementation
 *
 * Features:
 * - High-performance server with <400ms startup
 * - Connection pooling with max 10 connections
 * - Multiple transport support (stdio, http, websocket, in-process)
 * - Fast tool registry with <10ms registration
 * - Session management with timeout handling
 * - Comprehensive metrics and monitoring
 *
 * @module @monobrain/mcp
 * @version 3.0.0
 */
export type { JsonRpcVersion, RequestId, MCPMessage, MCPRequest, MCPResponse, MCPNotification, MCPError, TransportType, AuthMethod, AuthConfig, LoadBalancerConfig, ConnectionPoolConfig, MCPServerConfig, SessionState, MCPSession, MCPClientInfo, MCPCapabilities, MCPProtocolVersion, MCPInitializeParams, MCPInitializeResult, JSONSchema, ToolContext, ToolHandler, MCPTool, ToolCallResult, ToolRegistrationOptions, RequestHandler, NotificationHandler, TransportHealthStatus, ITransport, ConnectionState, PooledConnection, ConnectionPoolStats, IConnectionPool, ToolCallMetrics, MCPServerMetrics, SessionMetrics, MCPEventType, MCPEvent, EventHandler, LogLevel, ILogger, MCPResource, ResourceContent, ResourceTemplate, ResourceListResult, ResourceReadResult, PromptArgument, MCPPrompt, PromptRole, ContentAnnotations, TextContent, ImageContent, AudioContent, EmbeddedResource, PromptContent, PromptMessage, PromptListResult, PromptGetResult, TaskState, MCPTask, TaskProgress, TaskResult, PaginatedRequest, PaginatedResult, ProgressNotification, CancellationParams, SamplingMessage, ModelPreferences, CreateMessageRequest, CreateMessageResult, Root, RootsListResult, MCPLogLevel, LoggingMessage, CompletionReference, CompletionArgument, CompletionResult, } from './types.js';
export { ErrorCodes, MCPServerError } from './types.js';
import { MCPServer, createMCPServer } from './server.js';
export { MCPServer, createMCPServer };
export type { IMCPServer } from './server.js';
export { ToolRegistry, createToolRegistry, defineTool } from './tool-registry.js';
import { SessionManager, createSessionManager } from './session-manager.js';
export { SessionManager, createSessionManager };
export type { SessionConfig } from './session-manager.js';
export { ConnectionPool, createConnectionPool } from './connection-pool.js';
export { ResourceRegistry, createResourceRegistry, createTextResource, createFileResource, } from './resource-registry.js';
export type { ResourceHandler, SubscriptionCallback, ResourceRegistryOptions } from './resource-registry.js';
export { PromptRegistry, createPromptRegistry, definePrompt, textMessage, resourceMessage, interpolate, } from './prompt-registry.js';
export type { PromptHandler, PromptDefinition, PromptRegistryOptions } from './prompt-registry.js';
export { TaskManager, createTaskManager } from './task-manager.js';
export type { TaskExecutor, TaskManagerOptions } from './task-manager.js';
export { validateSchema, formatValidationErrors, createValidator, } from './schema-validator.js';
export type { ValidationError, ValidationResult } from './schema-validator.js';
export { RateLimiter, createRateLimiter, rateLimitMiddleware, } from './rate-limiter.js';
export type { RateLimitConfig, RateLimitResult } from './rate-limiter.js';
export { SamplingManager, createSamplingManager, createMockProvider, createAnthropicProvider, } from './sampling.js';
export type { LLMProvider, SamplingConfig, SamplingContext } from './sampling.js';
export { OAuthManager, createOAuthManager, oauthMiddleware, InMemoryTokenStorage, createGitHubOAuthConfig, createGoogleOAuthConfig, } from './oauth.js';
export type { OAuthConfig, OAuthTokens, TokenStorage, AuthorizationRequest, } from './oauth.js';
export { createTransport, createInProcessTransport, TransportManager, createTransportManager, DEFAULT_TRANSPORT_CONFIGS, StdioTransport, HttpTransport, WebSocketTransport, } from './transport/index.js';
export type { TransportConfig, StdioTransportConfig, HttpTransportConfig, WebSocketTransportConfig, } from './transport/index.js';
import type { MCPServerConfig, ILogger } from './types.js';
/**
 * Quick start function to create and configure an MCP server
 *
 * @example
 * ```typescript
 * import { quickStart } from '@monobrain/mcp';
 *
 * const server = await quickStart({
 *   transport: 'stdio',
 *   name: 'My MCP Server',
 * });
 *
 * server.registerTool({
 *   name: 'my-tool',
 *   description: 'My custom tool',
 *   inputSchema: { type: 'object', properties: {} },
 *   handler: async () => ({ result: 'success' }),
 * });
 *
 * await server.start();
 * ```
 */
export declare function quickStart(config: Partial<MCPServerConfig>, logger?: ILogger): Promise<MCPServer>;
/**
 * Module version
 */
export declare const VERSION = "3.0.0";
/**
 * Module name
 */
export declare const MODULE_NAME = "@monobrain/mcp";
//# sourceMappingURL=index.d.ts.map