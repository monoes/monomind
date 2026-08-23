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
  AudioContent,
  AuthConfig,
  AuthMethod,
  CancellationParams,
  CompletionArgument,
  CompletionReference,
  CompletionResult,
  ConnectionPoolConfig,
  ConnectionPoolStats,
  ConnectionState,
  ContentAnnotations,
  CreateMessageRequest,
  CreateMessageResult,
  EmbeddedResource,
  EventHandler,
  IConnectionPool,
  ILogger,
  ImageContent,
  ITransport,
  JSONSchema,
  JsonRpcVersion,
  LoadBalancerConfig,
  LoggingMessage,
  LogLevel,
  MCPCapabilities,
  MCPClientInfo,
  MCPError,
  MCPEvent,
  MCPEventType,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPLogLevel,
  MCPMessage,
  MCPNotification,
  MCPPrompt,
  MCPProtocolVersion,
  MCPRequest,
  // MCP 2025-11-25 types
  MCPResource,
  MCPResponse,
  MCPServerConfig,
  MCPServerMetrics,
  MCPSession,
  MCPTask,
  MCPTool,
  ModelPreferences,
  NotificationHandler,
  PaginatedRequest,
  PaginatedResult,
  PooledConnection,
  ProgressNotification,
  PromptArgument,
  PromptContent,
  PromptGetResult,
  PromptListResult,
  PromptMessage,
  PromptRole,
  RequestHandler,
  RequestId,
  ResourceContent,
  ResourceListResult,
  ResourceReadResult,
  ResourceTemplate,
  Root,
  RootsListResult,
  SamplingMessage,
  SessionMetrics,
  SessionState,
  TaskProgress,
  TaskResult,
  TaskState,
  TextContent,
  ToolCallMetrics,
  ToolCallResult,
  ToolContext,
  ToolHandler,
  ToolRegistrationOptions,
  TransportHealthStatus,
  TransportType,
} from './types.js';

// Error handling
export { ErrorCodes, MCPServerError } from './types.js';

// Server
import { createMCPServer, MCPServer } from './server.js';

export type { IMCPServer } from './server.js';
// Tool Registry
export { createToolRegistry, defineTool, ToolRegistry } from './tool-registry.js';
export { createMCPServer, MCPServer };

// Session Manager
import { createSessionManager, SessionManager } from './session-manager.js';

export type { AuthInfo, AuthValidationResult } from './auth.js';
// Inbound auth middleware
export {
  authMiddleware,
  timingSafeCompare,
  validateCredential,
} from './auth.js';

// Connection Pool
export { ConnectionPool, createConnectionPool } from './connection-pool.js';
export type {
  AuthorizationRequest,
  OAuthConfig,
  OAuthTokens,
  TokenStorage,
} from './oauth.js';
// OAuth 2.1 (outbound client)
export {
  createGitHubOAuthConfig,
  createGoogleOAuthConfig,
  createOAuthManager,
  InMemoryTokenStorage,
  OAuthManager,
} from './oauth.js';
export type { PromptDefinition, PromptHandler, PromptRegistryOptions } from './prompt-registry.js';
// Prompt Registry (MCP 2025-11-25)
export {
  createPromptRegistry,
  definePrompt,
  interpolate,
  PromptRegistry,
  resourceMessage,
  textMessage,
} from './prompt-registry.js';
export type { RateLimitConfig, RateLimitResult } from './rate-limiter.js';
// Rate Limiter
export {
  createRateLimiter,
  RateLimiter,
  rateLimitMiddleware,
} from './rate-limiter.js';
export type {
  ResourceHandler,
  ResourceRegistryOptions,
  SubscriptionCallback,
} from './resource-registry.js';
// Resource Registry (MCP 2025-11-25)
export {
  createFileResource,
  createResourceRegistry,
  createTextResource,
  ResourceRegistry,
} from './resource-registry.js';
export type { LLMProvider, SamplingConfig, SamplingContext } from './sampling.js';
// Sampling (Server-initiated LLM)
export {
  createAnthropicProvider,
  createMockProvider,
  createSamplingManager,
  SamplingManager,
} from './sampling.js';
export type { ValidationError, ValidationResult } from './schema-validator.js';
// Schema Validator
export {
  createValidator,
  formatValidationErrors,
  validateSchema,
} from './schema-validator.js';
export type { SessionConfig } from './session-manager.js';
export type { TaskExecutor, TaskManagerOptions } from './task-manager.js';
// Task Manager (MCP 2025-11-25)
export { createTaskManager, TaskManager } from './task-manager.js';
export type {
  HttpTransportConfig,
  StdioTransportConfig,
  TransportConfig,
  WebSocketTransportConfig,
} from './transport/index.js';

// Transport layer
export {
  createInProcessTransport,
  createTransport,
  createTransportManager,
  DEFAULT_TRANSPORT_CONFIGS,
  HttpTransport,
  StdioTransport,
  TransportManager,
  WebSocketTransport,
} from './transport/index.js';
export { createSessionManager, SessionManager };

// Import types for quickStart
import type { ILogger, MCPServerConfig } from './types.js';

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
  logger?: ILogger,
): Promise<MCPServer> {
  // With stdio transport, stdout is the JSON-RPC protocol channel — the
  // default logger must write everything to stderr or it corrupts the wire
  // (issue #94).
  const isStdio = (config.transport ?? 'stdio') === 'stdio';
  const defaultLogger: ILogger =
    logger ||
    (isStdio
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
