/**
 * @monobrain/mcp - HTTP Transport
 *
 * HTTP/REST transport with WebSocket support
 */
import { EventEmitter } from 'events';
import type { ITransport, TransportType, MCPNotification, RequestHandler, NotificationHandler, TransportHealthStatus, ILogger, AuthConfig } from '../types.js';
export interface HttpTransportConfig {
    host: string;
    port: number;
    tlsEnabled?: boolean;
    tlsCert?: string;
    tlsKey?: string;
    corsEnabled?: boolean;
    corsOrigins?: string[];
    auth?: AuthConfig;
    maxRequestSize?: string;
    requestTimeout?: number;
}
export declare class HttpTransport extends EventEmitter implements ITransport {
    private readonly logger;
    private readonly config;
    readonly type: TransportType;
    private requestHandler?;
    private notificationHandler?;
    private app;
    private server?;
    private wss?;
    private running;
    private activeConnections;
    private messagesReceived;
    private messagesSent;
    private errors;
    private httpRequests;
    private wsMessages;
    constructor(logger: ILogger, config: HttpTransportConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    onRequest(handler: RequestHandler): void;
    onNotification(handler: NotificationHandler): void;
    getHealthStatus(): Promise<TransportHealthStatus>;
    sendNotification(notification: MCPNotification): Promise<void>;
    private setupMiddleware;
    private setupRoutes;
    private setupWebSocketHandlers;
    private handleHttpRequest;
    private handleWebSocketMessage;
    /**
     * SECURITY: Timing-safe token comparison to prevent timing attacks
     */
    private timingSafeCompare;
    private validateAuth;
}
export declare function createHttpTransport(logger: ILogger, config: HttpTransportConfig): HttpTransport;
//# sourceMappingURL=http.d.ts.map