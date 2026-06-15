import { getProjectCwd } from './types.js';
import { existsSync, readFileSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
// Storage paths
const STORAGE_DIR = '.monomind';
const TERMINAL_DIR = 'terminals';
const TERMINAL_FILE = 'store.json';
function getTerminalDir() {
    return join(getProjectCwd(), STORAGE_DIR, TERMINAL_DIR);
}
function getTerminalPath() {
    return join(getTerminalDir(), TERMINAL_FILE);
}
function ensureTerminalDir() {
    const dir = getTerminalDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
const MAX_TERMINAL_STORE_BYTES = 10 * 1024 * 1024; // 10 MB
function loadTerminalStore() {
    try {
        const path = getTerminalPath();
        if (existsSync(path) && statSync(path).size <= MAX_TERMINAL_STORE_BYTES) {
            return JSON.parse(readFileSync(path, 'utf-8'));
        }
    }
    catch {
        // Return empty store
    }
    return { sessions: {}, version: '3.0.0' };
}
function saveTerminalStore(store) {
    ensureTerminalDir();
    // Unique tmp filename so concurrent handler invocations cannot clobber each
    // other's .tmp mid-write (which would produce a partial JSON on rename).
    const tmpPath = `${getTerminalPath()}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
    renameSync(tmpPath, getTerminalPath());
}
export const terminalTools = [
    {
        name: 'terminal_create',
        description: 'Create a new terminal session',
        category: 'terminal',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Session name' },
                workingDir: { type: 'string', description: 'Working directory' },
                env: { type: 'object', description: 'Environment variables' },
            },
        },
        handler: async (input) => {
            const store = loadTerminalStore();
            const MAX_SESSIONS = 1000;
            if (Object.keys(store.sessions).length >= MAX_SESSIONS) {
                return { success: false, error: 'Session limit reached' };
            }
            const FORBIDDEN_ENV_KEYS = new Set([
                'PATH',
                'LD_PRELOAD',
                'LD_LIBRARY_PATH',
                'NODE_OPTIONS',
                'NODE_PATH',
                'DYLD_INSERT_LIBRARIES',
                'DYLD_LIBRARY_PATH',
            ]);
            const rawEnv = input.env || {};
            const safeEnv = {};
            for (const [k, v] of Object.entries(rawEnv)) {
                if (!FORBIDDEN_ENV_KEYS.has(k) && /^[A-Z_][A-Z0-9_]*$/i.test(k)) {
                    safeEnv[k] = String(v);
                }
            }
            // Validate workingDir: must exist, be a directory, and not escape to
            // system-sensitive paths. Fall back to project cwd if invalid.
            let resolvedWorkingDir = getProjectCwd();
            if (input.workingDir && typeof input.workingDir === 'string') {
                const candidate = resolve(input.workingDir);
                const projectCwd = getProjectCwd();
                const home = homedir();
                // Allow paths under project cwd or user home directory only.
                const isUnderProject = candidate === projectCwd || candidate.startsWith(projectCwd + '/') || candidate.startsWith(projectCwd + '\\');
                const isUnderHome = candidate === home || candidate.startsWith(home + '/') || candidate.startsWith(home + '\\');
                if ((isUnderProject || isUnderHome) && existsSync(candidate)) {
                    try {
                        if (statSync(candidate).isDirectory()) {
                            resolvedWorkingDir = candidate;
                        }
                    }
                    catch {
                        // Leave resolvedWorkingDir as default
                    }
                }
            }
            const id = `term-${Date.now()}-${randomBytes(4).toString('hex')}`;
            const session = {
                id,
                name: input.name || `Terminal ${Object.keys(store.sessions).length + 1}`,
                status: 'active',
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                workingDir: resolvedWorkingDir,
                history: [],
                env: safeEnv,
            };
            store.sessions[id] = session;
            saveTerminalStore(store);
            return {
                success: true,
                sessionId: id,
                name: session.name,
                status: session.status,
                workingDir: session.workingDir,
                createdAt: session.createdAt,
            };
        },
    },
    {
        name: 'terminal_execute',
        description: 'Execute a command in a terminal session',
        category: 'terminal',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Terminal session ID' },
                command: { type: 'string', description: 'Command to execute' },
                timeout: { type: 'number', description: 'Command timeout in ms' },
                captureOutput: { type: 'boolean', description: 'Capture command output' },
            },
            required: ['command'],
        },
        handler: async (input) => {
            const store = loadTerminalStore();
            const sessionId = input.sessionId;
            const command = input.command;
            const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
            // Reject inherited keys (incl. toString/hasOwnProperty/etc.) so a tampered
            // store.json can't redirect bracket access into Object.prototype.
            if (sessionId &&
                (typeof sessionId !== 'string' || FORBIDDEN_KEYS.has(sessionId) || !Object.hasOwn(store.sessions, sessionId))) {
                return { success: false, error: 'Invalid sessionId' };
            }
            // Find or create default session
            let session = sessionId
                ? store.sessions[sessionId]
                : Object.values(store.sessions).find((s) => s.status === 'active');
            if (!session) {
                // Create default session
                const id = `term-${Date.now()}-${randomBytes(4).toString('hex')}`;
                session = {
                    id,
                    name: 'Default Terminal',
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    lastActivity: new Date().toISOString(),
                    workingDir: getProjectCwd(),
                    history: [],
                    env: {},
                };
                store.sessions[id] = session;
            }
            // Reject shell metacharacters AND env-prefix syntax. The previous regex
            // allowed `=`, which `/bin/sh` interprets as a per-command env override
            // (`PATH=/tmp/evil ls`, `LD_PRELOAD=/tmp/x.so cmd`) — turning the
            // metacharacter denylist into RCE. Also reject leading-dash so the
            // first arg can't be misinterpreted by the spawned binary as a flag,
            // and reject glob/expansion characters that may evaluate paths.
            if (/[|;&`$\n\r<>=*?~(){}[\]#!\\"']/.test(command)) {
                return { error: 'Command contains disallowed shell metacharacters', allowed: false };
            }
            if (/^\s*-/.test(command)) {
                return { error: 'Command must not start with "-"', allowed: false };
            }
            const rawTimeout = Number(input.timeout);
            const timeout = Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.min(rawTimeout, 5 * 60_000) : 30_000;
            const cwd = session.workingDir || getProjectCwd();
            const startTime = Date.now();
            let output;
            let exitCode;
            try {
                output = execSync(command, {
                    cwd,
                    encoding: 'utf-8',
                    timeout,
                    maxBuffer: 5 * 1024 * 1024,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, ...session.env },
                });
                exitCode = 0;
            }
            catch (err) {
                const e = err;
                output = (e.stdout?.toString() || '') + (e.stderr ? `\n[stderr] ${e.stderr.toString()}` : '');
                exitCode = e.status ?? 1;
            }
            const duration = Date.now() - startTime;
            const timestamp = new Date().toISOString();
            // Record in history (cap output size and total entries to prevent unbounded growth)
            const MAX_OUTPUT_BYTES = 64 * 1024;
            const MAX_HISTORY = 200;
            const truncatedOutput = output.length > MAX_OUTPUT_BYTES
                ? output.slice(0, MAX_OUTPUT_BYTES) + '\n[... truncated ...]'
                : output;
            session.history.push({ command, output: truncatedOutput, timestamp, exitCode });
            if (session.history.length > MAX_HISTORY) {
                session.history.splice(0, session.history.length - MAX_HISTORY);
            }
            session.lastActivity = timestamp;
            session.status = 'active';
            saveTerminalStore(store);
            return {
                success: exitCode === 0,
                sessionId: session.id,
                command,
                output,
                exitCode,
                executedAt: timestamp,
                duration,
            };
        },
    },
    {
        name: 'terminal_list',
        description: 'List all terminal sessions',
        category: 'terminal',
        inputSchema: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    enum: ['all', 'active', 'idle', 'closed'],
                    description: 'Filter by status',
                },
                includeHistory: { type: 'boolean', description: 'Include command history' },
            },
        },
        handler: async (input) => {
            const store = loadTerminalStore();
            let sessions = Object.values(store.sessions);
            const status = input.status;
            if (status && status !== 'all') {
                sessions = sessions.filter((s) => s.status === status);
            }
            return {
                sessions: sessions.map((s) => ({
                    id: s.id,
                    name: s.name,
                    status: s.status,
                    workingDir: s.workingDir,
                    createdAt: s.createdAt,
                    lastActivity: s.lastActivity,
                    historyLength: s.history.length,
                    ...(input.includeHistory ? { history: s.history.slice(-10) } : {}),
                })),
                total: sessions.length,
                active: sessions.filter((s) => s.status === 'active').length,
            };
        },
    },
    {
        name: 'terminal_close',
        description: 'Close a terminal session',
        category: 'terminal',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID to close' },
                force: { type: 'boolean', description: 'Force close' },
            },
            required: ['sessionId'],
        },
        handler: async (input) => {
            const store = loadTerminalStore();
            const sessionId = input.sessionId;
            const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
            if (!sessionId || FORBIDDEN_KEYS.has(sessionId)) {
                return { success: false, error: 'Invalid sessionId' };
            }
            const session = Object.hasOwn(store.sessions, sessionId) ? store.sessions[sessionId] : undefined;
            if (!session) {
                return { success: false, error: 'Session not found' };
            }
            session.status = 'closed';
            saveTerminalStore(store);
            return {
                success: true,
                sessionId,
                closedAt: new Date().toISOString(),
            };
        },
    },
    {
        name: 'terminal_history',
        description: 'Get command history for a terminal session',
        category: 'terminal',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID' },
                limit: { type: 'number', description: 'Number of entries to return' },
                offset: { type: 'number', description: 'Offset from latest' },
            },
        },
        handler: async (input) => {
            const store = loadTerminalStore();
            const sessionId = input.sessionId;
            const limit = input.limit || 50;
            const offset = input.offset || 0;
            const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
            if (sessionId) {
                if (typeof sessionId !== 'string' || FORBIDDEN_KEYS.has(sessionId) || !Object.hasOwn(store.sessions, sessionId)) {
                    return { success: false, error: 'Invalid sessionId' };
                }
                const session = store.sessions[sessionId];
                if (!session) {
                    return { success: false, error: 'Session not found' };
                }
                const history = session.history.slice(-(limit + offset), offset ? -offset : undefined);
                return {
                    sessionId,
                    history,
                    total: session.history.length,
                };
            }
            // Return combined history from all sessions
            const allHistory = Object.values(store.sessions)
                .flatMap((s) => s.history.map((h) => ({ ...h, sessionId: s.id })))
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .slice(offset, offset + limit);
            return {
                history: allHistory,
                total: allHistory.length,
            };
        },
    },
];
//# sourceMappingURL=terminal-tools.js.map