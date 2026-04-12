/**
 * @monobrain/mcp - Session Manager
 *
 * MCP session lifecycle management
 */
import { EventEmitter } from 'events';
import type { MCPSession, SessionState, SessionMetrics, MCPInitializeParams, TransportType, ILogger } from './types.js';
export interface SessionConfig {
    maxSessions?: number;
    sessionTimeout?: number;
    cleanupInterval?: number;
    enableMetrics?: boolean;
}
export declare class SessionManager extends EventEmitter {
    private readonly logger;
    private readonly sessions;
    private readonly config;
    private cleanupTimer?;
    private sessionCounter;
    private totalCreated;
    private totalClosed;
    private totalExpired;
    constructor(logger: ILogger, config?: SessionConfig);
    createSession(transport: TransportType): MCPSession;
    initializeSession(sessionId: string, params: MCPInitializeParams): MCPSession | undefined;
    authenticateSession(sessionId: string): boolean;
    getSession(sessionId: string): MCPSession | undefined;
    hasSession(sessionId: string): boolean;
    getActiveSessions(): MCPSession[];
    updateActivity(sessionId: string): boolean;
    setState(sessionId: string, state: SessionState): boolean;
    setMetadata(sessionId: string, key: string, value: unknown): boolean;
    getMetadata(sessionId: string, key: string): unknown;
    closeSession(sessionId: string, reason?: string): boolean;
    removeSession(sessionId: string): boolean;
    getSessionMetrics(): SessionMetrics;
    getStats(): {
        total: number;
        byState: Record<SessionState, number>;
        byTransport: Record<TransportType, number>;
        totalCreated: number;
        totalClosed: number;
        totalExpired: number;
        oldestSession?: Date;
        newestSession?: Date;
    };
    cleanupExpiredSessions(): number;
    private startCleanupTimer;
    private stopCleanupTimer;
    private generateSessionId;
    clearAll(): void;
    destroy(): void;
}
export declare function createSessionManager(logger: ILogger, config?: SessionConfig): SessionManager;
//# sourceMappingURL=session-manager.d.ts.map