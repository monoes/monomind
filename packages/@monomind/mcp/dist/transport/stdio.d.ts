/**
 * @monobrain/mcp - Stdio Transport
 *
 * Standard I/O transport for MCP communication
 */
import { EventEmitter } from 'events';
import type { ITransport, TransportType, MCPNotification, RequestHandler, NotificationHandler, TransportHealthStatus, ILogger } from '../types.js';
export interface StdioTransportConfig {
    inputStream?: NodeJS.ReadableStream;
    outputStream?: NodeJS.WritableStream;
    maxMessageSize?: number;
}
export declare class StdioTransport extends EventEmitter implements ITransport {
    private readonly logger;
    readonly type: TransportType;
    private requestHandler?;
    private notificationHandler?;
    private rl?;
    private running;
    private messagesReceived;
    private messagesSent;
    private errors;
    private readonly inputStream;
    private readonly outputStream;
    private readonly maxMessageSize;
    constructor(logger: ILogger, config?: StdioTransportConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    onRequest(handler: RequestHandler): void;
    onNotification(handler: NotificationHandler): void;
    getHealthStatus(): Promise<TransportHealthStatus>;
    private handleLine;
    private handleRequest;
    private handleNotification;
    private sendResponse;
    private sendError;
    sendNotification(notification: MCPNotification): Promise<void>;
    private write;
    private handleClose;
    private handleError;
}
export declare function createStdioTransport(logger: ILogger, config?: StdioTransportConfig): StdioTransport;
//# sourceMappingURL=stdio.d.ts.map