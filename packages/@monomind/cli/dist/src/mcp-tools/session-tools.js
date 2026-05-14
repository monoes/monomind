/**
 * Session MCP Tools for CLI
 *
 * Tool definitions for session management with file persistence.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getProjectCwd } from './types.js';
// Storage paths
const STORAGE_DIR = '.monomind';
const SESSION_DIR = 'sessions';
function getSessionDir() {
    return join(getProjectCwd(), STORAGE_DIR, SESSION_DIR);
}
function getSessionPath(sessionId) {
    // Sanitize sessionId to prevent path traversal
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(getSessionDir(), `${safeId}.json`);
}
function ensureSessionDir() {
    const dir = getSessionDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
const MAX_SESSION_BYTES = 50 * 1024 * 1024;
function loadSession(sessionId) {
    try {
        const path = getSessionPath(sessionId);
        if (existsSync(path)) {
            if (statSync(path).size > MAX_SESSION_BYTES)
                return null;
            const data = readFileSync(path, 'utf-8');
            return JSON.parse(data);
        }
    }
    catch {
        // Return null on error
    }
    return null;
}
function saveSession(session) {
    ensureSessionDir();
    const sessionPath = getSessionPath(session.sessionId);
    // Unique tmp filename so concurrent session_save calls cannot collide on
    // the same .tmp path (which would corrupt the rename target).
    const tmpPath = `${sessionPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8');
    renameSync(tmpPath, sessionPath);
}
function listSessions(limit = 200) {
    ensureSessionDir();
    const dir = getSessionDir();
    // Sort by mtime DESC, then bound reads to `limit` files to prevent DoS
    const files = readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
        try {
            const stat = statSync(join(dir, f));
            return { name: f, mtimeMs: stat.mtimeMs };
        }
        catch {
            return { name: f, mtimeMs: 0 };
        }
    })
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, Math.max(1, Math.min(limit, 1000)));
    const sessions = [];
    for (const file of files) {
        try {
            const filePath = join(dir, file.name);
            if (statSync(filePath).size > MAX_SESSION_BYTES)
                continue;
            const data = readFileSync(filePath, 'utf-8');
            sessions.push(JSON.parse(data));
        }
        catch {
            // Skip invalid files
        }
    }
    return sessions;
}
// Load related stores for session data
function loadRelatedStores(options) {
    const data = {};
    if (options.includeMemory) {
        try {
            const memoryPath = join(getProjectCwd(), STORAGE_DIR, 'memory', 'store.json');
            if (existsSync(memoryPath) && statSync(memoryPath).size <= MAX_SESSION_BYTES) {
                data.memory = JSON.parse(readFileSync(memoryPath, 'utf-8'));
            }
        }
        catch { /* ignore */ }
    }
    if (options.includeTasks) {
        try {
            const taskPath = join(getProjectCwd(), STORAGE_DIR, 'tasks', 'store.json');
            if (existsSync(taskPath) && statSync(taskPath).size <= MAX_SESSION_BYTES) {
                data.tasks = JSON.parse(readFileSync(taskPath, 'utf-8'));
            }
        }
        catch { /* ignore */ }
    }
    if (options.includeAgents) {
        try {
            const agentPath = join(getProjectCwd(), STORAGE_DIR, 'agents', 'store.json');
            if (existsSync(agentPath) && statSync(agentPath).size <= MAX_SESSION_BYTES) {
                data.agents = JSON.parse(readFileSync(agentPath, 'utf-8'));
            }
        }
        catch { /* ignore */ }
    }
    return data;
}
export const sessionTools = [
    {
        name: 'session_save',
        description: 'Save current session state',
        category: 'session',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Session name' },
                description: { type: 'string', description: 'Session description' },
                includeMemory: { type: 'boolean', description: 'Include memory in session' },
                includeTasks: { type: 'boolean', description: 'Include tasks in session' },
                includeAgents: { type: 'boolean', description: 'Include agents in session' },
            },
            required: ['name'],
        },
        handler: async (input) => {
            const sessionId = `session-${Date.now()}-${randomBytes(6).toString('hex')}`;
            // Load related data based on options
            const data = loadRelatedStores({
                includeMemory: input.includeMemory,
                includeTasks: input.includeTasks,
                includeAgents: input.includeAgents,
            });
            // Calculate stats
            const stats = {
                tasks: data.tasks ? Object.keys(data.tasks.tasks || {}).length : 0,
                agents: data.agents ? Object.keys(data.agents.agents || {}).length : 0,
                memoryEntries: data.memory ? Object.keys(data.memory.entries || {}).length : 0,
                totalSize: 0,
            };
            const session = {
                sessionId,
                name: input.name,
                description: input.description,
                savedAt: new Date().toISOString(),
                stats,
                data: Object.keys(data).length > 0 ? data : undefined,
            };
            // Calculate size
            const sessionJson = JSON.stringify(session);
            session.stats.totalSize = Buffer.byteLength(sessionJson, 'utf-8');
            saveSession(session);
            return {
                sessionId,
                name: session.name,
                savedAt: session.savedAt,
                stats: session.stats,
            };
        },
    },
    {
        name: 'session_restore',
        description: 'Restore a saved session',
        category: 'session',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID to restore' },
                name: { type: 'string', description: 'Session name to restore' },
            },
        },
        handler: async (input) => {
            let session = null;
            // Try to find by sessionId first
            if (input.sessionId) {
                session = loadSession(input.sessionId);
            }
            // Try to find by name if sessionId not found
            if (!session && input.name) {
                const sessions = listSessions();
                session = sessions.find(s => s.name === input.name) || null;
            }
            // Try to find latest if no params
            if (!session && !input.sessionId && !input.name) {
                const sessions = listSessions();
                if (sessions.length > 0) {
                    sessions.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
                    session = sessions[0];
                }
            }
            if (session) {
                // Restore data to respective stores (legacy JSON for backward compat)
                if (session.data?.memory) {
                    const memoryDir = join(getProjectCwd(), STORAGE_DIR, 'memory');
                    if (!existsSync(memoryDir))
                        mkdirSync(memoryDir, { recursive: true });
                    const memoryStorePath = join(memoryDir, 'store.json');
                    {
                        const tmp = `${memoryStorePath}.${process.pid}.${Date.now()}.tmp`;
                        writeFileSync(tmp, JSON.stringify(session.data.memory, null, 2), 'utf-8');
                        renameSync(tmp, memoryStorePath);
                    }
                    // Also populate active sql.js SQLite database so memory-tools can find entries
                    try {
                        const { storeEntry } = await import('../memory/memory-initializer.js');
                        const memoryData = session.data.memory;
                        if (memoryData.entries) {
                            for (const entry of Object.values(memoryData.entries)) {
                                const key = entry.key || entry.id || '';
                                const value = entry.value || entry.content || '';
                                if (key && value) {
                                    await storeEntry({
                                        key,
                                        value,
                                        namespace: entry.namespace || 'restored',
                                        upsert: true,
                                    });
                                }
                            }
                        }
                    }
                    catch {
                        // Legacy JSON restore is the fallback -- sql.js import may not be available
                    }
                }
                if (session.data?.tasks) {
                    const taskDir = join(getProjectCwd(), STORAGE_DIR, 'tasks');
                    if (!existsSync(taskDir))
                        mkdirSync(taskDir, { recursive: true });
                    const taskStorePath = join(taskDir, 'store.json');
                    {
                        const tmp = `${taskStorePath}.${process.pid}.${Date.now()}.tmp`;
                        writeFileSync(tmp, JSON.stringify(session.data.tasks, null, 2), 'utf-8');
                        renameSync(tmp, taskStorePath);
                    }
                }
                if (session.data?.agents) {
                    const agentDir = join(getProjectCwd(), STORAGE_DIR, 'agents');
                    if (!existsSync(agentDir))
                        mkdirSync(agentDir, { recursive: true });
                    const agentStorePath = join(agentDir, 'store.json');
                    {
                        const tmp = `${agentStorePath}.${process.pid}.${Date.now()}.tmp`;
                        writeFileSync(tmp, JSON.stringify(session.data.agents, null, 2), 'utf-8');
                        renameSync(tmp, agentStorePath);
                    }
                }
                return {
                    sessionId: session.sessionId,
                    name: session.name,
                    restored: true,
                    restoredAt: new Date().toISOString(),
                    stats: session.stats,
                };
            }
            return {
                sessionId: input.sessionId || input.name || 'latest',
                restored: false,
                error: 'Session not found',
            };
        },
    },
    {
        name: 'session_list',
        description: 'List saved sessions',
        category: 'session',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Maximum sessions to return' },
                sortBy: { type: 'string', description: 'Sort field (date, name, size)' },
            },
        },
        handler: async (input) => {
            let sessions = listSessions();
            // Sort
            const sortBy = input.sortBy || 'date';
            if (sortBy === 'date') {
                sessions.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
            }
            else if (sortBy === 'name') {
                sessions.sort((a, b) => a.name.localeCompare(b.name));
            }
            else if (sortBy === 'size') {
                sessions.sort((a, b) => b.stats.totalSize - a.stats.totalSize);
            }
            // Apply limit — clamp to [1, 200] to prevent negative-slice and OOM
            const rawLimit = typeof input.limit === 'number' ? input.limit : 10;
            const limit = Math.max(1, Math.min(rawLimit, 200));
            const totalCount = sessions.length;
            sessions = sessions.slice(0, limit);
            return {
                sessions: sessions.map(s => ({
                    sessionId: s.sessionId,
                    name: s.name,
                    description: s.description,
                    savedAt: s.savedAt,
                    stats: s.stats,
                })),
                total: totalCount,
                limit,
            };
        },
    },
    {
        name: 'session_delete',
        description: 'Delete a saved session',
        category: 'session',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID to delete' },
            },
            required: ['sessionId'],
        },
        handler: async (input) => {
            const sessionId = input.sessionId;
            const path = getSessionPath(sessionId);
            if (existsSync(path)) {
                unlinkSync(path);
                return {
                    sessionId,
                    deleted: true,
                    deletedAt: new Date().toISOString(),
                };
            }
            return {
                sessionId,
                deleted: false,
                error: 'Session not found',
            };
        },
    },
    {
        name: 'session_info',
        description: 'Get detailed session information',
        category: 'session',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID' },
            },
            required: ['sessionId'],
        },
        handler: async (input) => {
            const sessionId = input.sessionId;
            const session = loadSession(sessionId);
            if (session) {
                const path = getSessionPath(sessionId);
                const stat = statSync(path);
                return {
                    sessionId: session.sessionId,
                    name: session.name,
                    description: session.description,
                    savedAt: session.savedAt,
                    stats: session.stats,
                    fileSize: stat.size,
                    hasData: {
                        memory: !!session.data?.memory,
                        tasks: !!session.data?.tasks,
                        agents: !!session.data?.agents,
                    },
                };
            }
            return {
                sessionId,
                error: 'Session not found',
            };
        },
    },
];
//# sourceMappingURL=session-tools.js.map