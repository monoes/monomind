/**
 * CLI MCP Server Management
 *
 * Provides server lifecycle management for MCP integration:
 * - Start/stop/status methods with process management
 * - Health check endpoint integration
 * - Graceful shutdown handling
 * - PID file management for daemon detection
 * - Event-based status monitoring
 *
 * Performance Targets:
 * - Server startup: <400ms
 * - Health check: <10ms
 * - Graceful shutdown: <5s
 *
 * @module @monomind/cli/mcp-server
 * @version 3.0.0
 */
import { EventEmitter } from 'events';
/**
 * MCP Server configuration
 */
export interface MCPServerOptions {
    transport?: 'stdio' | 'http' | 'websocket';
    host?: string;
    port?: number;
    pidFile?: string;
    logFile?: string;
    tools?: string[] | 'all';
    daemonize?: boolean;
    timeout?: number;
}
/**
 * MCP Server status
 */
export interface MCPServerStatus {
    running: boolean;
    pid?: number;
    transport?: string;
    host?: string;
    port?: number;
    uptime?: number;
    tools?: number;
    startedAt?: string;
    health?: {
        healthy: boolean;
        error?: string;
        metrics?: Record<string, number>;
    };
}
/**
 * MCP Server Manager
 *
 * Manages the lifecycle of the MCP server process
 */
export declare class MCPServerManager extends EventEmitter {
    private options;
    private process?;
    private server?;
    private startTime?;
    private _stdioServerStarted;
    private healthCheckInterval?;
    constructor(options?: MCPServerOptions);
    /**
     * Start the MCP server
     */
    start(): Promise<MCPServerStatus>;
    /**
     * Stop the MCP server
     */
    stop(force?: boolean): Promise<void>;
    /**
     * Get server status
     */
    getStatus(): Promise<MCPServerStatus>;
    /**
     * Check server health
     */
    checkHealth(): Promise<{
        healthy: boolean;
        error?: string;
        metrics?: Record<string, number>;
    }>;
    /**
     * Restart the server
     */
    restart(): Promise<MCPServerStatus>;
    /**
     * Start stdio server in-process
     * Handles stdin/stdout directly like V2 implementation
     */
    private startStdioServer;
    /**
     * Handle incoming MCP message
     */
    private handleMCPMessage;
    /**
     * Start HTTP server in-process.
     *
     * SECURITY: refuses to bind to non-loopback hosts unless the operator opts
     * in via MONOMIND_MCP_ALLOW_REMOTE=1 AND provides a bearer token via
     * MONOMIND_MCP_TOKEN. Without this gate, `--host 0.0.0.0` exposed every
     * registered tool (including agent_spawn, terminal-tools, system tools) to
     * any LAN attacker as unauthenticated RCE.
     */
    private startHttpServer;
    /**
     * Wait for server to be ready
     */
    private waitForReady;
    /**
     * Wait for process to exit
     */
    private waitForExit;
    /**
     * Start health monitoring
     */
    private startHealthMonitoring;
    /**
     * Write PID file
     */
    private writePidFile;
    /**
     * Read PID file
     */
    private readPidFile;
    /**
     * Remove PID file
     */
    private removePidFile;
    /**
     * Check if process is running AND is a node/monomind process.
     * Plain `kill -0` returns true for any process with the same owner,
     * which causes false positives when the OS recycles the PID.
     */
    private isProcessRunning;
    /**
     * Make HTTP request
     */
    private httpRequest;
    /**
     * Sleep utility
     */
    private sleep;
}
/**
 * Create MCP server manager
 */
export declare function createMCPServerManager(options?: MCPServerOptions): MCPServerManager;
/**
 * Get or create server manager singleton
 *
 * FIX for issue #942: Recreate singleton if transport type changes
 * Previously, once created with stdio (default), HTTP options were ignored
 */
export declare function getServerManager(options?: MCPServerOptions): MCPServerManager;
/**
 * Quick start MCP server
 */
export declare function startMCPServer(options?: MCPServerOptions): Promise<MCPServerStatus>;
/**
 * Quick stop MCP server
 */
export declare function stopMCPServer(force?: boolean): Promise<void>;
/**
 * Get MCP server status
 */
export declare function getMCPServerStatus(): Promise<MCPServerStatus>;
export default MCPServerManager;
//# sourceMappingURL=mcp-server.d.ts.map