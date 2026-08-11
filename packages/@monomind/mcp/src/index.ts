/**
 * @monoes/mcp - Standalone MCP Server
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
 * @module @monoes/mcp
 * @version 3.0.0
 */

// Core types
export type {
  JsonRpcVersion,
  RequestId,
  MCPMessage,
  MCPRequest,
  MCPResponse,
  MCPNotification,
  MCPError,
  TransportType,
  AuthMethod,
  AuthConfig,
  LoadBalancerConfig,
  ConnectionPoolConfig,
  MCPServerConfig,
  SessionState,
  MCPSession,
  MCPClientInfo,
  MCPCapabilities,
  MCPProtocolVersion,
  MCPInitializeParams,
  MCPInitializeResult,
  JSONSchema,
  ToolContext,
  ToolHandler,
  MCPTool,
  ToolCallResult,
  ToolRegistrationOptions,
  RequestHandler,
  NotificationHandler,
  TransportHealthStatus,
  ITransport,
  ConnectionState,
  PooledConnection,
  ConnectionPoolStats,
  IConnectionPool,
  ToolCallMetrics,
  MCPServerMetrics,
  SessionMetrics,
  MCPEventType,
  MCPEvent,
  EventHandler,
  LogLevel,
  ILogger,
  // MCP 2025-11-25 types
  MCPResource,
  ResourceContent,
  ResourceTemplate,
  ResourceListResult,
  ResourceReadResult,
  PromptArgument,
  MCPPrompt,
  PromptRole,
  ContentAnnotations,
  TextContent,
  ImageContent,
  AudioContent,
  EmbeddedResource,
  PromptContent,
  PromptMessage,
  PromptListResult,
  PromptGetResult,
  TaskState,
  MCPTask,
  TaskProgress,
  TaskResult,
  PaginatedRequest,
  PaginatedResult,
  ProgressNotification,
  CancellationParams,
  SamplingMessage,
  ModelPreferences,
  CreateMessageRequest,
  CreateMessageResult,
  Root,
  RootsListResult,
  MCPLogLevel,
  LoggingMessage,
  CompletionReference,
  CompletionArgument,
  CompletionResult,
} from './types.js';

// Error handling
export { ErrorCodes, MCPServerError } from './types.js';

// Server
import { MCPServer, createMCPServer } from './server.js';
export { MCPServer, createMCPServer };
export type { IMCPServer } from './server.js';

// Tool Registry
export { ToolRegistry, createToolRegistry, defineTool } from './tool-registry.js';

// Session Manager
import { SessionManager, createSessionManager } from './session-manager.js';
export { SessionManager, createSessionManager };
export type { SessionConfig } from './session-manager.js';

// Connection Pool
export { ConnectionPool, createConnectionPool } from './connection-pool.js';

// Resource Registry (MCP 2025-11-25)
export {
  ResourceRegistry,
  createResourceRegistry,
  createTextResource,
  createFileResource,
} from './resource-registry.js';
export type { ResourceHandler, SubscriptionCallback, ResourceRegistryOptions } from './resource-registry.js';

// Prompt Registry (MCP 2025-11-25)
export {
  PromptRegistry,
  createPromptRegistry,
  definePrompt,
  textMessage,
  resourceMessage,
  interpolate,
} from './prompt-registry.js';
export type { PromptHandler, PromptDefinition, PromptRegistryOptions } from './prompt-registry.js';

// Task Manager (MCP 2025-11-25)
export { TaskManager, createTaskManager } from './task-manager.js';
export type { TaskExecutor, TaskManagerOptions } from './task-manager.js';

// Schema Validator
export {
  validateSchema,
  formatValidationErrors,
  createValidator,
} from './schema-validator.js';
export type { ValidationError, ValidationResult } from './schema-validator.js';

// Rate Limiter
export {
  RateLimiter,
  createRateLimiter,
  rateLimitMiddleware,
} from './rate-limiter.js';
export type { RateLimitConfig, RateLimitResult } from './rate-limiter.js';

// Sampling (Server-initiated LLM)
export {
  SamplingManager,
  createSamplingManager,
  createMockProvider,
  createAnthropicProvider,
} from './sampling.js';
export type { LLMProvider, SamplingConfig, SamplingContext } from './sampling.js';

// OAuth 2.1 (outbound client)
export {
  OAuthManager,
  createOAuthManager,
  InMemoryTokenStorage,
  createGitHubOAuthConfig,
  createGoogleOAuthConfig,
} from './oauth.js';
export type {
  OAuthConfig,
  OAuthTokens,
  TokenStorage,
  AuthorizationRequest,
} from './oauth.js';

// Inbound auth middleware
export {
  authMiddleware,
  validateCredential,
  timingSafeCompare,
} from './auth.js';
export type { AuthInfo, AuthValidationResult } from './auth.js';

// Transport layer
export {
  createTransport,
  createInProcessTransport,
  TransportManager,
  createTransportManager,
  DEFAULT_TRANSPORT_CONFIGS,
  StdioTransport,
  HttpTransport,
  WebSocketTransport,
} from './transport/index.js';

export type {
  TransportConfig,
  StdioTransportConfig,
  HttpTransportConfig,
  WebSocketTransportConfig,
} from './transport/index.js';

// Import types for quickStart
import type { MCPServerConfig, ILogger } from './types.js';

/**
 * Quick start function to create and configure an MCP server
 *
 * @example
 * ```typescript
 * import { quickStart } from '@monoes/mcp';
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
export async function quickStart(
  config: Partial<MCPServerConfig>,
  logger?: ILogger
): Promise<MCPServer> {
  // With stdio transport, stdout is the JSON-RPC protocol channel — the
  // default logger must write everything to stderr or it corrupts the wire
  // (issue #94).
  const isStdio = (config.transport ?? 'stdio') === 'stdio';
  const defaultLogger: ILogger = logger || (isStdio
    ? {
        debug: (msg, data) => console.error(`[DEBUG] ${msg}`, data || ''),
        info: (msg, data) => console.error(`[INFO] ${msg}`, data || ''),
        warn: (msg, data) => console.error(`[WARN] ${msg}`, data || ''),
        error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
      }
    : {
        debug: (msg, data) => console.debug(`[DEBUG] ${msg}`, data || ''),
        info: (msg, data) => console.info(`[INFO] ${msg}`, data || ''),
        warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
        error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
      });

  const server = createMCPServer(config, defaultLogger);

  return server;
}

/**
 * Module version
 */
export const VERSION = '3.0.0';

/**
 * Module name
 */
export const MODULE_NAME = '@monoes/mcp';
