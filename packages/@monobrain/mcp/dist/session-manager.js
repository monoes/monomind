/**
 * @monobrain/mcp - Session Manager
 *
 * MCP session lifecycle management
 */
import { EventEmitter } from 'events';
const DEFAULT_SESSION_CONFIG = {
    maxSessions: 100,
    sessionTimeout: 30 * 60 * 1000,
    cleanupInterval: 60 * 1000,
    enableMetrics: true,
};
export class SessionManager extends EventEmitter {
    logger;
    sessions = new Map();
    config;
    cleanupTimer;
    sessionCounter = 0;
    totalCreated = 0;
    totalClosed = 0;
    totalExpired = 0;
    constructor(logger, config = {}) {
        super();
        this.logger = logger;
        this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
        this.startCleanupTimer();
    }
    createSession(transport) {
        if (this.sessions.size >= this.config.maxSessions) {
            throw new Error(`Maximum sessions (${this.config.maxSessions}) reached`);
        }
        const id = this.generateSessionId();
        const now = new Date();
        const session = {
            id,
            state: 'created',
            transport,
            createdAt: now,
            lastActivityAt: now,
            isInitialized: false,
            isAuthenticated: false,
        };
        this.sessions.set(id, session);
        this.totalCreated++;
        this.logger.debug('Session created', { id, transport });
        this.emit('session:created', session);
        return session;
    }
    initializeSession(sessionId, params) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            this.logger.warn('Session not found for initialization', { sessionId });
            return undefined;
        }
        session.state = 'ready';
        session.isInitialized = true;
        session.clientInfo = params.clientInfo;
        session.protocolVersion = params.protocolVersion;
        session.capabilities = params.capabilities;
        session.lastActivityAt = new Date();
        this.logger.info('Session initialized', {
            sessionId,
            clientInfo: params.clientInfo,
            protocolVersion: params.protocolVersion,
        });
        this.emit('session:initialized', session);
        return session;
    }
    authenticateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }
        session.isAuthenticated = true;
        session.lastActivityAt = new Date();
        this.logger.debug('Session authenticated', { sessionId });
        this.emit('session:authenticated', session);
        return true;
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    hasSession(sessionId) {
        return this.sessions.has(sessionId);
    }
    getActiveSessions() {
        return Array.from(this.sessions.values()).filter((s) => s.state === 'ready' || s.state === 'created' || s.state === 'initializing');
    }
    updateActivity(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }
        session.lastActivityAt = new Date();
        return true;
    }
    setState(sessionId, state) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }
        const oldState = session.state;
        session.state = state;
        session.lastActivityAt = new Date();
        this.logger.debug('Session state changed', {
            sessionId,
            oldState,
            newState: state,
        });
        this.emit('session:stateChanged', { session, oldState, newState: state });
        return true;
    }
    setMetadata(sessionId, key, value) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }
        if (!session.metadata) {
            session.metadata = {};
        }
        session.metadata[key] = value;
        session.lastActivityAt = new Date();
        return true;
    }
    getMetadata(sessionId, key) {
        const session = this.sessions.get(sessionId);
        return session?.metadata?.[key];
    }
    closeSession(sessionId, reason) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }
        session.state = 'closed';
        this.sessions.delete(sessionId);
        this.totalClosed++;
        this.logger.info('Session closed', { sessionId, reason });
        this.emit('session:closed', { session, reason });
        return true;
    }
    removeSession(sessionId) {
        return this.closeSession(sessionId);
    }
    getSessionMetrics() {
        let authenticated = 0;
        let active = 0;
        for (const session of this.sessions.values()) {
            if (session.isAuthenticated)
                authenticated++;
            if (session.state === 'ready')
                active++;
        }
        return {
            total: this.sessions.size,
            active,
            authenticated,
            expired: this.totalExpired,
        };
    }
    getStats() {
        const byState = {
            created: 0,
            initializing: 0,
            ready: 0,
            closing: 0,
            closed: 0,
            error: 0,
        };
        const byTransport = {
            stdio: 0,
            http: 0,
            websocket: 0,
            'in-process': 0,
        };
        let oldest;
        let newest;
        for (const session of this.sessions.values()) {
            byState[session.state] = (byState[session.state] || 0) + 1;
            byTransport[session.transport] = (byTransport[session.transport] || 0) + 1;
            if (!oldest || session.createdAt < oldest) {
                oldest = session.createdAt;
            }
            if (!newest || session.createdAt > newest) {
                newest = session.createdAt;
            }
        }
        return {
            total: this.sessions.size,
            byState: byState,
            byTransport: byTransport,
            totalCreated: this.totalCreated,
            totalClosed: this.totalClosed,
            totalExpired: this.totalExpired,
            oldestSession: oldest,
            newestSession: newest,
        };
    }
    cleanupExpiredSessions() {
        const now = Date.now();
        const expired = [];
        for (const [id, session] of this.sessions) {
            const inactiveTime = now - session.lastActivityAt.getTime();
            if (inactiveTime > this.config.sessionTimeout) {
                expired.push(id);
            }
        }
        for (const id of expired) {
            const session = this.sessions.get(id);
            if (session) {
                session.state = 'closed';
                this.sessions.delete(id);
                this.totalExpired++;
                this.logger.info('Session expired', { sessionId: id });
                this.emit('session:expired', session);
            }
        }
        if (expired.length > 0) {
            this.logger.info('Cleaned up expired sessions', { count: expired.length });
        }
        return expired.length;
    }
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredSessions();
        }, this.config.cleanupInterval);
    }
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }
    generateSessionId() {
        return `session-${++this.sessionCounter}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }
    clearAll() {
        for (const id of this.sessions.keys()) {
            this.closeSession(id, 'Session manager cleared');
        }
        this.logger.info('All sessions cleared');
    }
    destroy() {
        this.stopCleanupTimer();
        this.clearAll();
        this.removeAllListeners();
        this.logger.info('Session manager destroyed');
    }
}
export function createSessionManager(logger, config) {
    return new SessionManager(logger, config);
}
//# sourceMappingURL=session-manager.js.map