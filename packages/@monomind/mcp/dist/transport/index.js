/**
 * @monobrain/mcp - Transport Factory
 *
 * Central factory for creating transport instances
 */
import { createStdioTransport } from './stdio.js';
import { createHttpTransport } from './http.js';
import { createWebSocketTransport } from './websocket.js';
export { StdioTransport } from './stdio.js';
export { HttpTransport } from './http.js';
export { WebSocketTransport } from './websocket.js';
export function createTransport(type, logger, config) {
    switch (type) {
        case 'stdio':
            return createStdioTransport(logger, config);
        case 'http':
            if (!config || !('host' in config) || !('port' in config)) {
                throw new Error('HTTP transport requires host and port configuration');
            }
            return createHttpTransport(logger, {
                host: config.host,
                port: config.port,
                ...config,
            });
        case 'websocket':
            if (!config || !('host' in config) || !('port' in config)) {
                throw new Error('WebSocket transport requires host and port configuration');
            }
            return createWebSocketTransport(logger, {
                host: config.host,
                port: config.port,
                ...config,
            });
        case 'in-process':
            return createInProcessTransport(logger);
        default:
            throw new Error(`Unknown transport type: ${type}`);
    }
}
class InProcessTransport {
    logger;
    type = 'in-process';
    constructor(logger) {
        this.logger = logger;
    }
    async start() {
        this.logger.debug('In-process transport started');
    }
    async stop() {
        this.logger.debug('In-process transport stopped');
    }
    onRequest() {
        // No-op - requests are handled directly
    }
    onNotification() {
        // No-op - notifications are handled directly
    }
    async getHealthStatus() {
        return {
            healthy: true,
            metrics: {
                latency: 0,
                connections: 1,
            },
        };
    }
}
export function createInProcessTransport(logger) {
    return new InProcessTransport(logger);
}
export class TransportManager {
    logger;
    transports = new Map();
    running = false;
    constructor(logger) {
        this.logger = logger;
    }
    addTransport(name, transport) {
        if (this.transports.has(name)) {
            throw new Error(`Transport "${name}" already exists`);
        }
        this.transports.set(name, transport);
        this.logger.debug('Transport added', { name, type: transport.type });
    }
    async removeTransport(name) {
        const transport = this.transports.get(name);
        if (!transport) {
            return false;
        }
        await transport.stop();
        this.transports.delete(name);
        this.logger.debug('Transport removed', { name });
        return true;
    }
    getTransport(name) {
        return this.transports.get(name);
    }
    getTransportNames() {
        return Array.from(this.transports.keys());
    }
    async startAll() {
        if (this.running) {
            throw new Error('TransportManager already running');
        }
        this.logger.info('Starting all transports', { count: this.transports.size });
        const startPromises = Array.from(this.transports.entries()).map(async ([name, transport]) => {
            try {
                await transport.start();
                this.logger.info('Transport started', { name, type: transport.type });
            }
            catch (error) {
                this.logger.error('Failed to start transport', { name, error });
                throw error;
            }
        });
        await Promise.all(startPromises);
        this.running = true;
        this.logger.info('All transports started');
    }
    async stopAll() {
        if (!this.running) {
            return;
        }
        this.logger.info('Stopping all transports');
        const stopPromises = Array.from(this.transports.entries()).map(async ([name, transport]) => {
            try {
                await transport.stop();
                this.logger.info('Transport stopped', { name });
            }
            catch (error) {
                this.logger.error('Error stopping transport', { name, error });
            }
        });
        await Promise.all(stopPromises);
        this.running = false;
        this.logger.info('All transports stopped');
    }
    async getHealthStatus() {
        const results = {};
        for (const [name, transport] of this.transports) {
            try {
                const status = await transport.getHealthStatus();
                results[name] = { healthy: status.healthy, error: status.error };
            }
            catch (error) {
                results[name] = {
                    healthy: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }
        return results;
    }
    isRunning() {
        return this.running;
    }
}
export function createTransportManager(logger) {
    return new TransportManager(logger);
}
export const DEFAULT_TRANSPORT_CONFIGS = {
    stdio: {},
    http: {
        host: 'localhost',
        port: 3000,
        corsEnabled: true,
        corsOrigins: ['*'],
        maxRequestSize: '10mb',
        requestTimeout: 30000,
    },
    websocket: {
        host: 'localhost',
        port: 3001,
        path: '/ws',
        maxConnections: 100,
        heartbeatInterval: 30000,
        heartbeatTimeout: 10000,
        maxMessageSize: 10 * 1024 * 1024,
    },
};
//# sourceMappingURL=index.js.map