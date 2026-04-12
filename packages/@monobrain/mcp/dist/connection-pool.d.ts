/**
 * @monobrain/mcp - Connection Pool
 *
 * High-performance connection pooling
 */
import { EventEmitter } from 'events';
import type { PooledConnection, ConnectionPoolStats, ConnectionPoolConfig, IConnectionPool, ILogger, TransportType } from './types.js';
export declare class ConnectionPool extends EventEmitter implements IConnectionPool {
    private readonly logger;
    private readonly transportType;
    private readonly config;
    private readonly connections;
    private readonly waitingClients;
    private evictionTimer?;
    private connectionCounter;
    private isShuttingDown;
    private stats;
    constructor(config: Partial<ConnectionPoolConfig> | undefined, logger: ILogger, transportType?: TransportType);
    private initializeMinConnections;
    private createConnection;
    acquire(): Promise<PooledConnection>;
    private waitForConnection;
    release(connection: PooledConnection): void;
    destroy(connection: PooledConnection): void;
    getStats(): ConnectionPoolStats;
    drain(): Promise<void>;
    clear(): Promise<void>;
    private startEvictionTimer;
    private stopEvictionTimer;
    private evictIdleConnections;
    private recordAcquireTime;
    getConnections(): PooledConnection[];
    isHealthy(): boolean;
}
export declare function createConnectionPool(config: Partial<ConnectionPoolConfig> | undefined, logger: ILogger, transportType?: TransportType): ConnectionPool;
//# sourceMappingURL=connection-pool.d.ts.map