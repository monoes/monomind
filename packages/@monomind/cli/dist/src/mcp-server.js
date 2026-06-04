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
import { execSync } from 'child_process';
import * as http from 'http';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
/**
 * Recursively strip prototype-pollution keys from a JSON-RPC message before
 * downstream tool handlers consume it. Tool handlers commonly do shallow
 * merges like `{ ...defaults, ...input }`, which would propagate
 * `__proto__`/`constructor`/`prototype` payloads onto config objects.
 */
const FORBIDDEN_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function sanitizeJsonRpcMessage(value, depth = 0) {
    if (depth > 16)
        return null;
    if (Array.isArray(value))
        return value.map(v => sanitizeJsonRpcMessage(v, depth + 1));
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (FORBIDDEN_PROTO_KEYS.has(k))
                continue;
            out[k] = sanitizeJsonRpcMessage(v, depth + 1);
        }
        return out;
    }
    return value;
}
import * as os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { trackRequest } from './mcp-tools/request-tracker.js';
// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * Default configuration
 */
/**
 * Resolve a per-user state directory under $HOME/.monomind. /tmp is shared and
 * world-traversable; placing the PID/log files there made them symlink-
 * attackable (a local attacker pre-creates /tmp/monomind-mcp.pid as a symlink
 * to e.g. ~/.ssh/authorized_keys, then a writeFile clobbers the target).
 */
function getDefaultStateDir() {
    const home = os.homedir();
    return path.join(home, '.monomind');
}
const DEFAULT_OPTIONS = {
    transport: 'stdio',
    host: 'localhost',
    port: 3000,
    pidFile: path.join(getDefaultStateDir(), 'mcp.pid'),
    logFile: path.join(getDefaultStateDir(), 'mcp.log'),
    tools: 'all',
    daemonize: false,
    timeout: 30000,
};
/**
 * MCP Server Manager
 *
 * Manages the lifecycle of the MCP server process
 */
export class MCPServerManager extends EventEmitter {
    options;
    process;
    server;
    startTime;
    _stdioServerStarted = false;
    healthCheckInterval;
    constructor(options = {}) {
        super();
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    /**
     * Start the MCP server
     */
    async start() {
        // Check if already running (skip if status reports our own PID —
        // getStatus() returns running=true for the current process in stdio mode
        // even before the server is actually started)
        const status = await this.getStatus();
        if (status.running && status.pid !== process.pid) {
            throw new Error(`MCP Server already running (PID: ${status.pid})`);
        }
        const startTime = performance.now();
        this.startTime = new Date();
        this.emit('starting', { options: this.options });
        try {
            if (this.options.transport === 'stdio') {
                // For stdio transport, spawn the server process
                await this.startStdioServer();
            }
            else {
                // For HTTP/WebSocket, start in-process server
                await this.startHttpServer();
            }
            const duration = performance.now() - startTime;
            // Write PID file
            await this.writePidFile();
            // Start health check monitoring
            this.startHealthMonitoring();
            const finalStatus = await this.getStatus();
            this.emit('started', {
                ...finalStatus,
                startupTime: duration,
            });
            return finalStatus;
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    /**
     * Stop the MCP server
     */
    async stop(force = false) {
        const status = await this.getStatus();
        if (!status.running) {
            return;
        }
        this.emit('stopping', { force });
        try {
            // Stop health monitoring
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = undefined;
            }
            if (this.process) {
                // Graceful shutdown
                if (!force) {
                    this.process.kill('SIGTERM');
                    await this.waitForExit(5000);
                }
                // Force kill if still running
                if (this.process && !this.process.killed) {
                    this.process.kill('SIGKILL');
                }
                this.process = undefined;
            }
            if (this.server) {
                await new Promise((resolve) => {
                    this.server.close(() => resolve());
                });
                this.server = undefined;
            }
            if (this._mcpServer) {
                try {
                    await this._mcpServer.close();
                }
                catch { /* ignore */ }
                this._mcpServer = undefined;
            }
            // Remove PID file
            await this.removePidFile();
            this.startTime = undefined;
            this.emit('stopped');
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    /**
     * Get server status
     */
    async getStatus() {
        // Check PID file
        const pid = await this.readPidFile();
        if (!pid) {
            // No PID file found. Detect if we are running in stdio mode
            // (e.g., launched by Claude Code via `claude mcp add`).
            const isStdio = !process.stdin.isTTY;
            const envTransport = process.env.MONOMIND_MCP_TRANSPORT;
            if (isStdio || envTransport === 'stdio' || this._stdioServerStarted) {
                return {
                    running: true,
                    pid: process.pid,
                    transport: 'stdio',
                    startedAt: this.startTime?.toISOString(),
                    uptime: this.startTime
                        ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
                        : undefined,
                };
            }
            return { running: false };
        }
        // Check if process is running
        const isRunning = this.isProcessRunning(pid);
        if (!isRunning) {
            // Clean up stale PID file
            await this.removePidFile();
            return { running: false };
        }
        // Build status
        const status = {
            running: true,
            pid,
            transport: this.options.transport,
            host: this.options.host,
            port: this.options.port,
            startedAt: this.startTime?.toISOString(),
            uptime: this.startTime
                ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
                : undefined,
        };
        // Get health status for HTTP transport
        if (this.options.transport !== 'stdio') {
            status.health = await this.checkHealth();
        }
        return status;
    }
    /**
     * Check server health
     */
    async checkHealth() {
        if (this.options.transport === 'stdio') {
            // For stdio, check if process is running
            const pid = await this.readPidFile();
            if (pid === null) {
                return { healthy: false, error: 'No PID file found' };
            }
            if (!this.isProcessRunning(pid)) {
                // Clean up stale PID file
                await this.removePidFile();
                return { healthy: false, error: 'Process not running (cleaned up stale PID)' };
            }
            return { healthy: true };
        }
        // For HTTP/WebSocket, make health check request
        try {
            const response = await this.httpRequest(`http://${this.options.host}:${this.options.port}/health`, 'GET', this.options.timeout);
            return {
                healthy: response.status === 'ok',
                metrics: {
                    connections: response.connections || 0,
                },
            };
        }
        catch (error) {
            return {
                healthy: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    /**
     * Restart the server
     */
    async restart() {
        await this.stop();
        return await this.start();
    }
    /**
     * Start stdio server in-process
     * Handles stdin/stdout directly like V2 implementation
     */
    async startStdioServer() {
        this._stdioServerStarted = true;
        // Import the tool registry
        const { listMCPTools, callMCPTool, hasTool } = await import('./mcp-client.js');
        const VERSION = '3.0.0';
        const sessionId = `mcp-${Date.now()}-${randomUUID().slice(0, 8)}`;
        // Log to stderr to not corrupt stdout
        console.error(`[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Starting in stdio mode`);
        // Auto-initialize memory database before tools are registered (#1524)
        // This ensures memory_store and other memory tools work immediately
        // without waiting for the first tool call to trigger lazy init.
        try {
            const { initializeMemoryDatabase, checkMemoryInitialization } = await import('./memory/memory-initializer.js');
            const status = await checkMemoryInitialization();
            if (!status.initialized) {
                console.error(`[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Auto-initializing memory database...`);
                const result = await initializeMemoryDatabase({ force: false, verbose: false });
                if (result.success) {
                    console.error(`[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Memory database initialized at ${result.dbPath}`);
                }
                else if (result.error && !result.error.includes('already exists')) {
                    console.error(`[${new Date().toISOString()}] WARN [monomind-mcp] (${sessionId}) Memory database init returned: ${result.error}`);
                }
            }
            else {
                console.error(`[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Memory database already initialized (v${status.version || 'unknown'})`);
            }
        }
        catch (memInitError) {
            // Graceful degradation: server continues even if memory init fails.
            // Memory tools will attempt lazy init on first call via ensureInitialized().
            console.error(`[${new Date().toISOString()}] WARN [monomind-mcp] (${sessionId}) Memory auto-init failed (tools will retry on first call): ${memInitError instanceof Error ? memInitError.message : String(memInitError)}`);
        }
        console.error(JSON.stringify({
            arch: process.arch,
            mode: 'mcp-stdio',
            nodeVersion: process.version,
            pid: process.pid,
            platform: process.platform,
            protocol: 'stdio',
            sessionId,
            version: VERSION,
        }));
        // Send server initialization notification
        console.log(JSON.stringify({
            jsonrpc: '2.0',
            method: 'server.initialized',
            params: {
                serverInfo: {
                    name: 'monomind',
                    version: VERSION,
                    capabilities: {
                        tools: { listChanged: true },
                        resources: { subscribe: true, listChanged: true },
                    },
                },
            },
        }));
        // Handle stdin messages (S-5: bounded buffer to prevent OOM)
        const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB
        let buffer = '';
        process.stdin.on('data', async (chunk) => {
            buffer += chunk.toString();
            if (buffer.length > MAX_BUFFER_SIZE) {
                console.error(`[${new Date().toISOString()}] ERROR [monomind-mcp] Buffer exceeded ${MAX_BUFFER_SIZE} bytes, rejecting`);
                buffer = '';
                console.log(JSON.stringify({
                    jsonrpc: '2.0',
                    error: { code: -32600, message: 'Request too large' },
                }));
                return;
            }
            // Process complete JSON messages
            let lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        // Sanitize against prototype pollution. JSON.parse on its own does
                        // not pollute, but downstream tool handlers that shallow-merge
                        // input into option defaults would propagate `__proto__`,
                        // `constructor`, or `prototype` keys. Strip them at the boundary.
                        const message = sanitizeJsonRpcMessage(JSON.parse(line));
                        const response = await this.handleMCPMessage(message, sessionId);
                        if (response) {
                            console.log(JSON.stringify(response));
                        }
                    }
                    catch (error) {
                        // Log-injection defense: stringify message fragment instead of
                        // letting raw line content land in the log unescaped.
                        const safeMsg = (error instanceof Error ? error.message : String(error))
                            .replace(/[\r\n\x00-\x1f\x7f]/g, '?').slice(0, 500);
                        console.error(`[${new Date().toISOString()}] ERROR [monomind-mcp] Failed to parse message: ${safeMsg}`);
                    }
                }
            }
        });
        // Centralized graceful shutdown — clears the health-check interval and
        // removes the PID file before exiting. Without this an abrupt
        // `process.exit(0)` leaves a stale PID file plus a dangling interval and
        // unflushed in-flight tool calls.
        let shuttingDown = false;
        const shutdown = async (reason) => {
            if (shuttingDown)
                return;
            shuttingDown = true;
            console.error(`[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) ${reason}, shutting down...`);
            try {
                if (this.healthCheckInterval) {
                    clearInterval(this.healthCheckInterval);
                    this.healthCheckInterval = undefined;
                }
            }
            catch { /* best-effort */ }
            try {
                await this.removePidFile();
            }
            catch { /* best-effort */ }
            process.exit(0);
        };
        process.stdin.on('end', () => { void shutdown('stdin closed'); });
        process.on('SIGINT', () => { void shutdown('Received SIGINT'); });
        process.on('SIGTERM', () => { void shutdown('Received SIGTERM'); });
        // Mark as ready immediately for stdio
        this.emit('ready');
    }
    /**
     * Handle incoming MCP message
     */
    async handleMCPMessage(message, sessionId) {
        const { listMCPTools, callMCPTool, hasTool } = await import('./mcp-client.js');
        if (!message.method) {
            return {
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32600, message: 'Invalid Request: missing method' },
            };
        }
        const params = (message.params || {});
        try {
            switch (message.method) {
                case 'initialize':
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: {
                            protocolVersion: '2024-11-05',
                            serverInfo: { name: 'monomind', version: '3.0.0' },
                            capabilities: {
                                tools: { listChanged: true },
                                resources: { subscribe: true, listChanged: true },
                            },
                        },
                    };
                case 'tools/list':
                    const tools = listMCPTools();
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: {
                            tools: tools.map(tool => ({
                                name: tool.name,
                                description: tool.description,
                                inputSchema: tool.inputSchema,
                            })),
                        },
                    };
                case 'tools/call': {
                    // Strict boundary validation. Without this, `params.name` could be
                    // an array/object (silently coerced) and `params.arguments` could be
                    // an array (downstream `Object.keys` returns numeric indices).
                    if (typeof params.name !== 'string') {
                        return {
                            jsonrpc: '2.0',
                            id: message.id,
                            error: { code: -32602, message: 'Invalid params.name: must be a string' },
                        };
                    }
                    const rawArgs = params.arguments;
                    if (rawArgs !== undefined && (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs))) {
                        return {
                            jsonrpc: '2.0',
                            id: message.id,
                            error: { code: -32602, message: 'Invalid params.arguments: must be an object' },
                        };
                    }
                    const toolName = params.name;
                    const toolParams = (rawArgs || {});
                    if (!hasTool(toolName)) {
                        return {
                            jsonrpc: '2.0',
                            id: message.id,
                            error: { code: -32601, message: `Tool not found: ${toolName}` },
                        };
                    }
                    try {
                        const result = await callMCPTool(toolName, toolParams, { sessionId });
                        trackRequest(toolName, true);
                        return {
                            jsonrpc: '2.0',
                            id: message.id,
                            result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
                        };
                    }
                    catch (error) {
                        trackRequest(toolName, false);
                        const errMsg = process.env.NODE_ENV === 'production'
                            ? 'Tool execution failed'
                            : (error instanceof Error ? error.message : 'Tool execution failed');
                        return {
                            jsonrpc: '2.0',
                            id: message.id,
                            error: {
                                code: -32603,
                                message: errMsg,
                            },
                        };
                    }
                }
                case 'resources/list':
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: {
                            resources: [
                                {
                                    uri: 'monograph://repo/processes',
                                    name: 'Processes',
                                    description: 'All detected Process nodes with their steps',
                                    mimeType: 'application/json',
                                },
                                {
                                    uri: 'monograph://repo/communities',
                                    name: 'Communities',
                                    description: 'All community clusters with member symbols',
                                    mimeType: 'application/json',
                                },
                                {
                                    uri: 'monograph://repo/schema',
                                    name: 'Schema',
                                    description: 'Graph schema: node labels, edge relations, counts',
                                    mimeType: 'application/json',
                                },
                                {
                                    uri: 'monograph://repo/graph',
                                    name: 'Graph',
                                    description: 'Full graph export (nodes + edges, up to 2000 nodes)',
                                    mimeType: 'application/json',
                                },
                            ],
                        },
                    };
                case 'resources/read': {
                    const uri = params.uri ?? '';
                    try {
                        const { join } = await import('path');
                        const { openDb, closeDb, getProcessesResource, getCommunitiesResource, getSchemaResource, getGraphResource } = await import('@monoes/monograph');
                        const projectCwd = process.env['MONOMIND_CWD'] || process.cwd();
                        const dbPath = join(projectCwd, '.monomind', 'monograph.db');
                        const resDb = openDb(dbPath);
                        let data;
                        try {
                            switch (uri) {
                                case 'monograph://repo/processes':
                                    data = getProcessesResource(resDb);
                                    break;
                                case 'monograph://repo/communities':
                                    data = getCommunitiesResource(resDb);
                                    break;
                                case 'monograph://repo/schema':
                                    data = getSchemaResource(resDb);
                                    break;
                                case 'monograph://repo/graph':
                                    data = getGraphResource(resDb);
                                    break;
                                default:
                                    return {
                                        jsonrpc: '2.0',
                                        id: message.id,
                                        error: { code: -32602, message: `Unknown resource URI: ${uri}` },
                                    };
                            }
                        }
                        finally {
                            closeDb(resDb);
                        }
                        return {
                            jsonrpc: '2.0',
                            id: message.id,
                            result: {
                                contents: [
                                    {
                                        uri,
                                        text: JSON.stringify(data),
                                        mimeType: 'application/json',
                                    },
                                ],
                            },
                        };
                    }
                    catch (err) {
                        return {
                            jsonrpc: '2.0',
                            id: message.id,
                            error: {
                                code: -32603,
                                message: err instanceof Error ? err.message : 'Failed to read resource',
                            },
                        };
                    }
                }
                case 'notifications/initialized':
                    // Client notification - no response needed
                    console.error(`[${new Date().toISOString()}] INFO [monomind-mcp] (${sessionId}) Client initialized`);
                    return null;
                case 'ping':
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: {},
                    };
                default:
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        error: { code: -32601, message: `Method not found: ${message.method}` },
                    };
            }
        }
        catch (error) {
            // Log-injection defense: caller-controlled `message.method` may contain
            // newlines, ANSI escapes, or other control bytes that forge log lines.
            // JSON.stringify quotes the string and escapes control chars.
            const safeMethod = JSON.stringify(message.method);
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error(`[${new Date().toISOString()}] ERROR [monomind-mcp] Error handling ${safeMethod}: ${errMsg.replace(/[\r\n]/g, ' ')}`);
            // Sanitize outgoing error messages — internal Error.message often
            // contains absolute paths or partial secrets. In production return a
            // generic message; in dev/debug return the full message for triage.
            const isProd = process.env.NODE_ENV === 'production';
            const outMessage = error instanceof Error
                ? (isProd ? 'Internal error' : error.message)
                : 'Internal error';
            return {
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32603, message: outMessage },
            };
        }
    }
    /**
     * Start HTTP server in-process.
     *
     * SECURITY: refuses to bind to non-loopback hosts unless the operator opts
     * in via MONOMIND_MCP_ALLOW_REMOTE=1 AND provides a bearer token via
     * MONOMIND_MCP_TOKEN. Without this gate, `--host 0.0.0.0` exposed every
     * registered tool (including agent_spawn, terminal-tools, system tools) to
     * any LAN attacker as unauthenticated RCE.
     */
    async startHttpServer() {
        // Loopback gate
        const host = this.options.host;
        const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '::ffff:127.0.0.1';
        const allowRemote = process.env.MONOMIND_MCP_ALLOW_REMOTE === '1';
        const token = process.env.MONOMIND_MCP_TOKEN;
        if (!isLoopback && !allowRemote) {
            throw new Error(`Refusing to bind MCP HTTP transport to non-loopback host "${host}". ` +
                `Set MONOMIND_MCP_ALLOW_REMOTE=1 and MONOMIND_MCP_TOKEN=<secret> to enable remote access.`);
        }
        if (!isLoopback && allowRemote && (!token || token.length < 32)) {
            throw new Error('Remote MCP transport requires MONOMIND_MCP_TOKEN to be set to a strong secret (>= 32 chars).');
        }
        // Dynamically import the MCP server package
        // FIX for issue #942: Use proper package import instead of broken relative path
        const { createMCPServer } = await import('@monomind/mcp');
        const logger = {
            debug: (msg, data) => this.emit('log', { level: 'debug', msg, data }),
            info: (msg, data) => this.emit('log', { level: 'info', msg, data }),
            warn: (msg, data) => this.emit('log', { level: 'warn', msg, data }),
            error: (msg, data) => this.emit('log', { level: 'error', msg, data }),
        };
        // SECURITY: actually wire the token into the underlying server's auth
        // config. The startup gate above only *validates* that a token was set —
        // without passing it through here, the token was never enforced on
        // requests. Operators believed their server was protected when it wasn't.
        // For loopback we still configure auth when a token is set, so users who
        // explicitly opt-in to bind 0.0.0.0 with a token get end-to-end protection.
        const authConfig = token && token.length >= 32
            ? { enabled: true, method: 'token', tokens: [token] }
            : (isLoopback ? undefined : { enabled: true, method: 'token', tokens: [] });
        const mcpServer = createMCPServer({
            name: 'Monomind MCP Server V1',
            version: '3.0.0',
            transport: this.options.transport,
            host: this.options.host,
            port: this.options.port,
            enableMetrics: true,
            enableCaching: true,
            ...(authConfig ? { auth: authConfig } : {}),
        }, logger);
        await mcpServer.start();
        // Store reference for stopping
        this._mcpServer = mcpServer;
    }
    /**
     * Wait for server to be ready
     */
    async waitForReady(timeout = 10000) {
        // For stdio transport, we're ready immediately (in-process)
        if (this.options.transport === 'stdio') {
            return;
        }
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const health = await this.checkHealth();
            if (health.healthy) {
                return;
            }
            await this.sleep(100);
        }
        throw new Error('Server failed to start within timeout');
    }
    /**
     * Wait for process to exit
     */
    async waitForExit(timeout) {
        if (!this.process)
            return;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                resolve();
            }, timeout);
            this.process.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
    }
    /**
     * Start health monitoring
     */
    startHealthMonitoring() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                const health = await this.checkHealth();
                this.emit('health', health);
                if (!health.healthy) {
                    this.emit('unhealthy', health);
                }
            }
            catch (error) {
                this.emit('health-error', error);
            }
        }, 30000);
        this.healthCheckInterval.unref();
    }
    /**
     * Write PID file
     */
    async writePidFile() {
        const pid = this.process?.pid || process.pid;
        // Ensure the state dir exists (user-private, not /tmp)
        const dir = path.dirname(this.options.pidFile);
        await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
        // wx flag = O_CREAT | O_EXCL: fails fast on a pre-existing path including
        // a symlinked one, so we never follow an attacker-staged link to write
        // PIDs into ~/.ssh/authorized_keys or similar.
        try {
            await fs.promises.writeFile(this.options.pidFile, String(pid), { flag: 'wx', mode: 0o600 });
        }
        catch (e) {
            const code = e.code;
            if (code === 'EEXIST') {
                // Stale PID file (the existence-check + isProcessRunning gate above
                // already passed, so the file belongs to a dead daemon). Replace it
                // by unlinking-then-creating with O_EXCL again — never write through
                // an existing path that might be a symlink.
                await fs.promises.unlink(this.options.pidFile);
                await fs.promises.writeFile(this.options.pidFile, String(pid), { flag: 'wx', mode: 0o600 });
            }
            else {
                throw e;
            }
        }
    }
    /**
     * Read PID file
     */
    async readPidFile() {
        try {
            const content = await fs.promises.readFile(this.options.pidFile, 'utf8');
            const pid = parseInt(content.trim(), 10);
            return isNaN(pid) ? null : pid;
        }
        catch {
            return null;
        }
    }
    /**
     * Remove PID file
     */
    async removePidFile() {
        try {
            await fs.promises.unlink(this.options.pidFile);
        }
        catch {
            // Ignore errors
        }
        // Also clean up legacy PID file location from older versions
        try {
            const legacyPath = path.join(process.env.MONOMIND_CWD || process.cwd(), '.monomind', 'mcp-server.pid');
            if (legacyPath !== this.options.pidFile) {
                await fs.promises.unlink(legacyPath);
            }
        }
        catch {
            // Ignore — file may not exist
        }
    }
    /**
     * Check if process is running AND is a node/monomind process.
     * Plain `kill -0` returns true for any process with the same owner,
     * which causes false positives when the OS recycles the PID.
     */
    isProcessRunning(pid) {
        try {
            process.kill(pid, 0);
        }
        catch {
            return false;
        }
        // Verify it's actually our MCP server process (guards against PID reuse by
        // an unrelated Node.js program that happened to get the same PID).
        // We require the command line to mention both "node"/"npx" AND "monomind"/"mcp".
        try {
            const cmdline = execSync(`cat /proc/${pid}/cmdline 2>/dev/null || ps -p ${pid} -o args= 2>/dev/null`, {
                encoding: 'utf8',
                timeout: 1000,
            }).trim();
            const isMonomindMcp = (cmdline.includes('node') || cmdline.includes('npx')) &&
                (cmdline.includes('monomind') || cmdline.includes('mcp'));
            return isMonomindMcp;
        }
        catch {
            // If we can't inspect the process (macOS, Windows, permissions), fall back to kill check
            return true;
        }
    }
    /**
     * Make HTTP request
     */
    async httpRequest(url, method, timeout) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const req = http.request({
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname,
                method,
                timeout,
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch {
                        resolve({ status: res.statusCode === 200 ? 'ok' : 'error' });
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            req.end();
        });
    }
    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
/**
 * Create MCP server manager
 */
export function createMCPServerManager(options) {
    return new MCPServerManager(options);
}
/**
 * Singleton server manager instance
 */
let serverManager = null;
let currentTransport = undefined;
/**
 * Get or create server manager singleton
 *
 * FIX for issue #942: Recreate singleton if transport type changes
 * Previously, once created with stdio (default), HTTP options were ignored
 */
export function getServerManager(options) {
    const requestedTransport = options?.transport;
    // Recreate if transport type changes (fixes HTTP transport not working)
    if (serverManager && requestedTransport && requestedTransport !== currentTransport) {
        serverManager = new MCPServerManager(options);
        currentTransport = requestedTransport;
    }
    if (!serverManager) {
        serverManager = new MCPServerManager(options);
        currentTransport = options?.transport;
    }
    return serverManager;
}
/**
 * Quick start MCP server
 */
export async function startMCPServer(options) {
    // A2: mark this as a long-lived host so the SONA write-path (trajectory record +
    // consolidation) stays enabled. In one-shot CLI mode this env var is absent and
    // the per-call SONA trajectory — which would never reach the consolidation
    // threshold and is discarded on process exit — is skipped to avoid wasted
    // ONNX/embedding overhead. Across MCP calls the registry singleton persists, so
    // trajectories accumulate and DO reach threshold here.
    process.env.MONOMIND_PERSISTENT_HOST = '1';
    const manager = getServerManager(options);
    return await manager.start();
}
/**
 * Quick stop MCP server
 */
export async function stopMCPServer(force = false) {
    if (serverManager) {
        await serverManager.stop(force);
    }
}
/**
 * Get MCP server status
 */
export async function getMCPServerStatus() {
    const manager = getServerManager();
    return await manager.getStatus();
}
export default MCPServerManager;
//# sourceMappingURL=mcp-server.js.map