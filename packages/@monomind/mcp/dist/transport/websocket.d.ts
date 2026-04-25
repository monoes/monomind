/**
 * @monobrain/mcp - WebSocket Transport
 *
 * Standalone WebSocket transport with heartbeat
 */
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import type { ITransport, TransportType, MCPNotification, RequestHandler, NotificationHandler, TransportHealthStatus, ILogger, AuthConfig } from '../types.js';
export interface WebSocketTransportConfig {
    host: string;
    port: number;
    path?: string;
    maxConnections?: number;
    heartbeatInterval?: number;
    heartbeatTimeout?: number;
    maxMessageSize?: number;
    auth?: AuthConfig;
    enableBinaryMode?: boolean;
}
interface ClientConnection {
    id: string;
    ws: WebSocket;
    createdAt: Date;
    lastActivity: Date;
    messageCount: number;
    isAlive: boolean;
    isAuthenticated: boolean;
}
export declare class WebSocketTransport extends EventEmitter implements ITransport {
    private readonly logger;
    private readonly config;
    readonly type: TransportType;
    private requestHandler?;
    private notificationHandler?;
    private server?;
    private wss?;
    private clients;
    private heartbeatTimer?;
    private running;
    private connectionCounter;
    private messagesReceived;
    private messagesSent;
    private errors;
    private totalConnections;
    constructor(logger: ILogger, config: WebSocketTransportConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    onRequest(handler: RequestHandler): void;
    onNotification(handler: NotificationHandler): void;
    getHealthStatus(): Promise<TransportHealthStatus>;
    sendNotification(notification: MCPNotification): Promise<void>;
    sendToClient(clientId: string, notification: MCPNotification): Promise<boolean>;
    getClients(): string[];
    getClientInfo(clientId: string): ClientConnection | undefined;
    disconnectClient(clientId: string, reason?: string): boolean;
    private setupWebSocketHandlers;
    private handleMessage;
    private parseMessage;
    private serializeMessage;
    private startHeartbeat;
    private stopHeartbeat;
}
export declare function createWebSocketTransport(logger: ILogger, config: WebSocketTransportConfig): WebSocketTransport;
export {};
//# sourceMappingURL=websocket.d.ts.map