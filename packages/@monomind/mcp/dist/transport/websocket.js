/**
 * @monobrain/mcp - WebSocket Transport
 *
 * Standalone WebSocket transport with heartbeat
 */
import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
export class WebSocketTransport extends EventEmitter {
    logger;
    config;
    type = 'websocket';
    requestHandler;
    notificationHandler;
    server;
    wss;
    clients = new Map();
    heartbeatTimer;
    running = false;
    connectionCounter = 0;
    messagesReceived = 0;
    messagesSent = 0;
    errors = 0;
    totalConnections = 0;
    constructor(logger, config) {
        super();
        this.logger = logger;
        this.config = config;
    }
    async start() {
        if (this.running) {
            throw new Error('WebSocket transport already running');
        }
        this.logger.info('Starting WebSocket transport', {
            host: this.config.host,
            port: this.config.port,
            path: this.config.path || '/ws',
        });
        this.server = createServer((req, res) => {
            res.writeHead(426, { 'Content-Type': 'text/plain' });
            res.end('Upgrade Required - WebSocket connection expected');
        });
        this.wss = new WebSocketServer({
            server: this.server,
            path: this.config.path || '/ws',
            maxPayload: this.config.maxMessageSize || 10 * 1024 * 1024,
            perMessageDeflate: true,
        });
        this.setupWebSocketHandlers();
        this.startHeartbeat();
        await new Promise((resolve, reject) => {
            this.server.listen(this.config.port, this.config.host, () => {
                resolve();
            });
            this.server.on('error', reject);
        });
        this.running = true;
        this.logger.info('WebSocket transport started', {
            url: `ws://${this.config.host}:${this.config.port}${this.config.path || '/ws'}`,
        });
    }
    async stop() {
        if (!this.running) {
            return;
        }
        this.logger.info('Stopping WebSocket transport');
        this.running = false;
        this.stopHeartbeat();
        for (const client of this.clients.values()) {
            try {
                client.ws.close(1000, 'Server shutting down');
            }
            catch {
                // Ignore errors
            }
        }
        this.clients.clear();
        if (this.wss) {
            this.wss.close();
            this.wss = undefined;
        }
        if (this.server) {
            await new Promise((resolve) => {
                this.server.close(() => resolve());
            });
            this.server = undefined;
        }
        this.logger.info('WebSocket transport stopped');
    }
    onRequest(handler) {
        this.requestHandler = handler;
    }
    onNotification(handler) {
        this.notificationHandler = handler;
    }
    async getHealthStatus() {
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
    async sendNotification(notification) {
        const message = this.serializeMessage(notification);
        for (const client of this.clients.values()) {
            try {
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(message);
                    this.messagesSent++;
                }
            }
            catch (error) {
                this.logger.error('Failed to send notification', { clientId: client.id, error });
                this.errors++;
            }
        }
    }
    async sendToClient(clientId, notification) {
        const client = this.clients.get(clientId);
        if (!client || client.ws.readyState !== WebSocket.OPEN) {
            return false;
        }
        try {
            client.ws.send(this.serializeMessage(notification));
            this.messagesSent++;
            return true;
        }
        catch (error) {
            this.logger.error('Failed to send to client', { clientId, error });
            this.errors++;
            return false;
        }
    }
    getClients() {
        return Array.from(this.clients.keys());
    }
    getClientInfo(clientId) {
        return this.clients.get(clientId);
    }
    disconnectClient(clientId, reason = 'Disconnected by server') {
        const client = this.clients.get(clientId);
        if (!client) {
            return false;
        }
        try {
            client.ws.close(1000, reason);
            return true;
        }
        catch {
            return false;
        }
    }
    setupWebSocketHandlers() {
        if (!this.wss)
            return;
        this.wss.on('connection', (ws) => {
            if (this.config.maxConnections && this.clients.size >= this.config.maxConnections) {
                this.logger.warn('Max connections reached, rejecting client');
                ws.close(1013, 'Server at capacity');
                return;
            }
            const clientId = `client-${++this.connectionCounter}`;
            const client = {
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
            });
            ws.on('error', (error) => {
                this.logger.error('Client error', { id: clientId, error });
                this.errors++;
                this.clients.delete(clientId);
            });
            this.emit('client:connected', clientId);
        });
    }
    async handleMessage(client, data) {
        client.lastActivity = new Date();
        client.messageCount++;
        this.messagesReceived++;
        try {
            const message = this.parseMessage(data);
            if (!client.isAuthenticated && this.config.auth?.enabled) {
                if (message.method !== 'authenticate') {
                    client.ws.send(this.serializeMessage({
                        jsonrpc: '2.0',
                        id: message.id || null,
                        error: { code: -32001, message: 'Authentication required' },
                    }));
                    return;
                }
            }
            if (message.jsonrpc !== '2.0') {
                client.ws.send(this.serializeMessage({
                    jsonrpc: '2.0',
                    id: message.id || null,
                    error: { code: -32600, message: 'Invalid JSON-RPC version' },
                }));
                return;
            }
            if (message.id === undefined) {
                if (this.notificationHandler) {
                    await this.notificationHandler(message);
                }
            }
            else {
                if (!this.requestHandler) {
                    client.ws.send(this.serializeMessage({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: { code: -32603, message: 'No request handler' },
                    }));
                    return;
                }
                const startTime = performance.now();
                const response = await this.requestHandler(message);
                const duration = performance.now() - startTime;
                this.logger.debug('Request processed', {
                    clientId: client.id,
                    method: message.method,
                    duration: `${duration.toFixed(2)}ms`,
                });
                client.ws.send(this.serializeMessage(response));
                this.messagesSent++;
            }
        }
        catch (error) {
            this.errors++;
            this.logger.error('Message handling error', { clientId: client.id, error });
            try {
                client.ws.send(this.serializeMessage({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error' },
                }));
            }
            catch {
                // Ignore send errors
            }
        }
    }
    parseMessage(data) {
        if (this.config.enableBinaryMode && Buffer.isBuffer(data)) {
            return JSON.parse(data.toString());
        }
        return JSON.parse(data.toString());
    }
    serializeMessage(message) {
        if (this.config.enableBinaryMode) {
            return JSON.stringify(message);
        }
        return JSON.stringify(message);
    }
    startHeartbeat() {
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
                }
                catch {
                    // Ignore ping errors
                }
            }
        }, interval);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }
}
export function createWebSocketTransport(logger, config) {
    return new WebSocketTransport(logger, config);
}
//# sourceMappingURL=websocket.js.map