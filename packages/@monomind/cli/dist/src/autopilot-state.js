/**
 * Autopilot Shared State Module
 *
 * Centralizes state management, validation, and task discovery
 * for both CLI command and MCP tools. Eliminates code duplication.
 *
 * ADR-072: Autopilot Integration
 * Security: Addresses prototype pollution, NaN bypass, input validation
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
// ── Constants ─────────────────────────────────────────────────
export const STATE_DIR = '.monomind/data';
export const STATE_FILE = `${STATE_DIR}/autopilot-state.json`;
export const LOG_FILE = `${STATE_DIR}/autopilot-log.json`;
/** Maximum entries kept in state.history (prevents unbounded growth) */
const MAX_HISTORY_ENTRIES = 50;
/** Maximum entries kept in the event log */
const MAX_LOG_ENTRIES = 1000;
/** Allowlist for valid task sources */
export const VALID_TASK_SOURCES = new Set(['team-tasks', 'swarm-tasks', 'file-checklist']);
/** Terminal task statuses */
export const TERMINAL_STATUSES = new Set(['completed', 'done', 'cancelled', 'skipped', 'failed']);
// ── Validation Helpers ────────────────────────────────────────
/**
 * Sanitize a parsed JSON object to prevent prototype pollution.
 * Removes __proto__, constructor, and prototype keys recursively.
 */
function sanitizeObject(obj) {
    if (obj === null || typeof obj !== 'object')
        return obj;
    if (Array.isArray(obj))
        return obj.map(sanitizeObject);
    const clean = {};
    for (const key of Object.keys(obj)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
            continue;
        clean[key] = sanitizeObject(obj[key]);
    }
    return clean;
}
/**
 * Safe JSON.parse that prevents prototype pollution.
 */
export function safeJsonParse(raw) {
    return sanitizeObject(JSON.parse(raw));
}
/**
 * Validate and coerce a numeric parameter. Returns the default if
 * the input is NaN, undefined, or outside the allowed range.
 */
export function validateNumber(value, min, max, defaultValue) {
    if (value === undefined || value === null)
        return defaultValue;
    const num = Number(value);
    if (!Number.isFinite(num))
        return defaultValue;
    return Math.min(Math.max(min, Math.round(num)), max);
}
/**
 * Validate task sources against the allowlist.
 * Returns only valid sources; falls back to defaults if none are valid.
 */
export function validateTaskSources(sources) {
    const defaults = ['team-tasks', 'swarm-tasks', 'file-checklist'];
    if (!Array.isArray(sources))
        return defaults;
    const valid = sources
        .filter((s) => typeof s === 'string')
        .map(s => s.trim())
        .filter(s => VALID_TASK_SOURCES.has(s));
    return valid.length > 0 ? valid : defaults;
}
// ── State Management ──────────────────────────────────────────
export function getDefaultState() {
    return {
        sessionId: randomUUID(),
        enabled: false,
        startTime: Date.now(),
        iterations: 0,
        maxIterations: 50,
        timeoutMinutes: 240,
        taskSources: ['team-tasks', 'swarm-tasks', 'file-checklist'],
        lastCheck: null,
        history: [],
    };
}
export function loadState() {
    const filePath = path.resolve(STATE_FILE);
    const defaults = getDefaultState();
    try {
        if (fs.existsSync(filePath)) {
            const raw = safeJsonParse(fs.readFileSync(filePath, 'utf-8'));
            const merged = { ...defaults, ...raw };
            // Re-validate fields that could be tampered with
            merged.maxIterations = validateNumber(merged.maxIterations, 1, 1000, 50);
            merged.timeoutMinutes = validateNumber(merged.timeoutMinutes, 1, 1440, 240);
            merged.iterations = validateNumber(merged.iterations, 0, 1000, 0);
            merged.taskSources = validateTaskSources(merged.taskSources);
            // Cap history to prevent unbounded growth
            if (Array.isArray(merged.history) && merged.history.length > MAX_HISTORY_ENTRIES) {
                merged.history = merged.history.slice(-MAX_HISTORY_ENTRIES);
            }
            return merged;
        }
    }
    catch {
        // Corrupted state file — return defaults
    }
    return defaults;
}
export function saveState(state) {
    const dir = path.resolve(STATE_DIR);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    // Cap history before saving
    if (state.history.length > MAX_HISTORY_ENTRIES) {
        state.history = state.history.slice(-MAX_HISTORY_ENTRIES);
    }
    // Unique tmp filename — concurrent autopilot_enable/disable/reset calls
    // must not collide on the same .tmp path.
    const tmpFile = `${path.resolve(STATE_FILE)}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
    fs.renameSync(tmpFile, path.resolve(STATE_FILE));
}
export function appendLog(entry) {
    const filePath = path.resolve(LOG_FILE);
    const dir = path.resolve(STATE_DIR);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    // Append-only NDJSON: atomic at the OS level for individual lines, no
    // read-modify-write race between concurrent MCP tool calls. Compaction is
    // handled lazily by `compactLog()` which the daemon can call periodically.
    // Previously this function did read → push → tmp-write → rename, which
    // under concurrent autopilot_enable/disable/reset calls silently lost
    // entries (last writer wins) and could truncate the log to a single entry
    // if a peer crashed mid-write and the next caller's safeJsonParse threw.
    try {
        fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', { flag: 'a' });
    }
    catch {
        // Best-effort logging; do not throw from a non-critical observability path.
    }
    // Opportunistic compaction so the file doesn't grow without bound.
    try {
        const stat = fs.statSync(filePath);
        if (stat.size > 4 * 1024 * 1024) {
            compactLog(filePath);
        }
    }
    catch { /* ignore */ }
}
/**
 * Compact NDJSON log down to MAX_LOG_ENTRIES. On parse failure for any line,
 * preserve the corrupt file aside (do not silently destroy data).
 */
function compactLog(filePath) {
    let lines;
    try {
        lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim().length > 0);
    }
    catch {
        return;
    }
    const entries = [];
    let corrupt = 0;
    for (const line of lines) {
        try {
            const e = safeJsonParse(line);
            if (e && typeof e === 'object')
                entries.push(e);
        }
        catch {
            corrupt++;
        }
    }
    if (corrupt > 0) {
        try {
            fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`);
        }
        catch { /* ignore */ }
    }
    const trimmed = entries.length > MAX_LOG_ENTRIES ? entries.slice(-MAX_LOG_ENTRIES) : entries;
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, trimmed.map(e => JSON.stringify(e)).join('\n') + '\n');
    fs.renameSync(tmp, filePath);
}
export function loadLog() {
    const filePath = path.resolve(LOG_FILE);
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf-8');
            // Backward compatible: support both old JSON-array form and the new
            // append-only NDJSON form. Prefer NDJSON if the file looks line-based.
            const trimmed = raw.trim();
            if (trimmed.startsWith('[')) {
                const result = safeJsonParse(raw);
                return Array.isArray(result) ? result : [];
            }
            const out = [];
            for (const line of trimmed.split('\n')) {
                if (!line)
                    continue;
                try {
                    const entry = safeJsonParse(line);
                    if (entry && typeof entry === 'object')
                        out.push(entry);
                }
                catch { /* skip corrupt line */ }
            }
            return out;
        }
    }
    catch {
        // Corrupted log — return empty
    }
    return [];
}
// ── Task Discovery ────────────────────────────────────────────
export function discoverTasks(sources) {
    const tasks = [];
    // Only process valid sources
    const validSources = sources.filter(s => VALID_TASK_SOURCES.has(s));
    for (const source of validSources) {
        if (source === 'team-tasks') {
            const tasksDir = path.join(os.homedir(), '.claude', 'tasks');
            try {
                if (fs.existsSync(tasksDir)) {
                    const teams = fs.readdirSync(tasksDir, { withFileTypes: true });
                    for (const team of teams) {
                        if (!team.isDirectory())
                            continue;
                        const teamDir = path.join(tasksDir, team.name);
                        const files = fs.readdirSync(teamDir).filter((f) => f.endsWith('.json'));
                        for (const file of files) {
                            try {
                                const data = safeJsonParse(fs.readFileSync(path.join(teamDir, file), 'utf-8'));
                                tasks.push({
                                    id: String(data.id || file.replace('.json', '')),
                                    subject: String(data.subject || data.title || file),
                                    status: String(data.status || 'unknown'),
                                    source: 'team-tasks',
                                });
                            }
                            catch { /* skip individual file */ }
                        }
                    }
                }
            }
            catch { /* skip source */ }
        }
        if (source === 'swarm-tasks') {
            const swarmFile = path.resolve('.monomind/swarm-tasks.json');
            try {
                if (fs.existsSync(swarmFile)) {
                    const data = safeJsonParse(fs.readFileSync(swarmFile, 'utf-8'));
                    const swarmTasks = Array.isArray(data) ? data : (data.tasks || []);
                    for (const t of swarmTasks) {
                        if (t && typeof t === 'object') {
                            const task = t;
                            tasks.push({
                                id: String(task.id || task.taskId || `swarm-${tasks.length}`),
                                subject: String(task.subject || task.description || task.name || 'Unnamed task'),
                                status: String(task.status || 'unknown'),
                                source: 'swarm-tasks',
                            });
                        }
                    }
                }
            }
            catch { /* skip source */ }
        }
        if (source === 'file-checklist') {
            const checklistFile = path.resolve('.monomind/data/checklist.json');
            try {
                if (fs.existsSync(checklistFile)) {
                    const data = safeJsonParse(fs.readFileSync(checklistFile, 'utf-8'));
                    const items = Array.isArray(data) ? data : (data.items || []);
                    for (const item of items) {
                        if (item && typeof item === 'object') {
                            const i = item;
                            tasks.push({
                                id: String(i.id || `check-${tasks.length}`),
                                subject: String(i.subject || i.text || i.description || 'Unnamed item'),
                                status: String(i.status || (i.done ? 'completed' : 'pending')),
                                source: 'file-checklist',
                            });
                        }
                    }
                }
            }
            catch { /* skip source */ }
        }
    }
    return tasks;
}
// ── Progress Helpers ──────────────────────────────────────────
export function isTerminal(status) {
    return TERMINAL_STATUSES.has(status.toLowerCase());
}
export function getProgress(tasks) {
    const completed = tasks.filter(t => isTerminal(t.status)).length;
    const total = tasks.length;
    const percent = total === 0 ? 100 : Math.round((completed / total) * 100);
    const incomplete = tasks.filter(t => !isTerminal(t.status));
    return { completed, total, percent, incomplete };
}
// ── Reward Calculation ────────────────────────────────────────
export function calculateReward(iterations, durationMs) {
    const iterFactor = (1 - iterations / (iterations + 10)) * 0.6;
    const timeFactor = (1 - Math.min(durationMs / 3600000, 1)) * 0.4;
    return Math.round((iterFactor + timeFactor) * 100) / 100;
}
// ── Learning Integration ──────────────────────────────────────
export async function tryLoadLearning() {
    try {
        const modPath = 'agentic-flow/dist/coordination/autopilot-learning.js';
        const mod = await import(/* webpackIgnore: true */ modPath).catch(() => null);
        if (mod?.AutopilotLearning) {
            const instance = new mod.AutopilotLearning();
            if (await instance.initialize())
                return instance;
        }
    }
    catch { /* not available */ }
    return null;
}
//# sourceMappingURL=autopilot-state.js.map