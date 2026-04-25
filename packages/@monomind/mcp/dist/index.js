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
// Error handling
export { ErrorCodes, MCPServerError } from './types.js';
// Server
import { MCPServer, createMCPServer } from './server.js';
export { MCPServer, createMCPServer };
// Tool Registry
export { ToolRegistry, createToolRegistry, defineTool } from './tool-registry.js';
// Session Manager
import { SessionManager, createSessionManager } from './session-manager.js';
export { SessionManager, createSessionManager };
// Connection Pool
export { ConnectionPool, createConnectionPool } from './connection-pool.js';
// Resource Registry (MCP 2025-11-25)
export { ResourceRegistry, createResourceRegistry, createTextResource, createFileResource, } from './resource-registry.js';
// Prompt Registry (MCP 2025-11-25)
export { PromptRegistry, createPromptRegistry, definePrompt, textMessage, resourceMessage, interpolate, } from './prompt-registry.js';
// Task Manager (MCP 2025-11-25)
export { TaskManager, createTaskManager } from './task-manager.js';
// Schema Validator
export { validateSchema, formatValidationErrors, createValidator, } from './schema-validator.js';
// Rate Limiter
export { RateLimiter, createRateLimiter, rateLimitMiddleware, } from './rate-limiter.js';
// Sampling (Server-initiated LLM)
export { SamplingManager, createSamplingManager, createMockProvider, createAnthropicProvider, } from './sampling.js';
// OAuth 2.1
export { OAuthManager, createOAuthManager, oauthMiddleware, InMemoryTokenStorage, createGitHubOAuthConfig, createGoogleOAuthConfig, } from './oauth.js';
// Transport layer
export { createTransport, createInProcessTransport, TransportManager, createTransportManager, DEFAULT_TRANSPORT_CONFIGS, StdioTransport, HttpTransport, WebSocketTransport, } from './transport/index.js';
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
export async function quickStart(config, logger) {
    const defaultLogger = logger || {
        debug: (msg, data) => console.debug(`[DEBUG] ${msg}`, data || ''),
        info: (msg, data) => console.info(`[INFO] ${msg}`, data || ''),
        warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
        error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
    };
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
export const MODULE_NAME = '@monobrain/mcp';
//# sourceMappingURL=index.js.map