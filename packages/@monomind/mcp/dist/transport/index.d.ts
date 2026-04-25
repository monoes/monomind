/**
 * @monobrain/mcp - Transport Factory
 *
 * Central factory for creating transport instances
 */
import type { ITransport, TransportType, ILogger } from '../types.js';
import { StdioTransportConfig } from './stdio.js';
import { HttpTransportConfig } from './http.js';
import { WebSocketTransportConfig } from './websocket.js';
export { StdioTransport } from './stdio.js';
export { HttpTransport } from './http.js';
export { WebSocketTransport } from './websocket.js';
export type { StdioTransportConfig } from './stdio.js';
export type { HttpTransportConfig } from './http.js';
export type { WebSocketTransportConfig } from './websocket.js';
export type TransportConfig = {
    type: 'stdio';
} & StdioTransportConfig | {
    type: 'http';
} & HttpTransportConfig | {
    type: 'websocket';
} & WebSocketTransportConfig | {
    type: 'in-process';
};
export declare function createTransport(type: TransportType, logger: ILogger, config?: Partial<TransportConfig>): ITransport;
export declare function createInProcessTransport(logger: ILogger): ITransport;
export declare class TransportManager {
    private readonly logger;
    private transports;
    private running;
    constructor(logger: ILogger);
    addTransport(name: string, transport: ITransport): void;
    removeTransport(name: string): Promise<boolean>;
    getTransport(name: string): ITransport | undefined;
    getTransportNames(): string[];
    startAll(): Promise<void>;
    stopAll(): Promise<void>;
    getHealthStatus(): Promise<Record<string, {
        healthy: boolean;
        error?: string;
    }>>;
    isRunning(): boolean;
}
export declare function createTransportManager(logger: ILogger): TransportManager;
export declare const DEFAULT_TRANSPORT_CONFIGS: {
    readonly stdio: StdioTransportConfig;
    readonly http: HttpTransportConfig;
    readonly websocket: WebSocketTransportConfig;
};
//# sourceMappingURL=index.d.ts.map