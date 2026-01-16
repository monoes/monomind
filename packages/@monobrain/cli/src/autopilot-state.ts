/**
 * Autopilot Shared State Module
 *
 * Centralizes state management, validation, and task discovery
 * for both CLI command and MCP tools. Eliminates code duplication.
 *
 * ADR-072: Autopilot Integration
 * Security: Addresses prototype pollution, NaN bypass, input validation
 */

// ── Constants ─────────────────────────────────────────────────

export const STATE_DIR = '.monobrain/data';
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

// ── Types ─────────────────────────────────────────────────────

export interface AutopilotState {
  sessionId: string;
  enabled: boolean;
  startTime: number;
  iterations: number;
  maxIterations: number;
  timeoutMinutes: number;
  taskSources: string[];
  lastCheck: number | null;
  history: Array<{ ts: number; iteration: number; completed: number; total: number }>;
}

export interface AutopilotLogEntry {
  ts: number;
  event: string;
  [key: string]: unknown;
}

export interface TaskInfo {
  id: string;
  subject: string;
  status: string;
  source: string;
}

export interface TaskProgress {
  completed: number;
  total: number;
  percent: number;
  incomplete: TaskInfo[];
}

// ── Validation Helpers ────────────────────────────────────────

/**
 * Sanitize a parsed JSON object to prevent prototype pollution.
 * Removes __proto__, constructor, and prototype keys recursively.
 */
function sanitizeObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    clean[key] = sanitizeObject((obj as Record<string, unknown>)[key]);
  }
  return clean;
}

/**
 * Safe JSON.parse that prevents prototype pollution.
 */
export function safeJsonParse<T>(raw: string): T {
  return sanitizeObject(JSON.parse(raw)) as T;
}

/**
 * Validate and coerce a numeric parameter. Returns the default if
 * the input is NaN, undefined, or outside the allowed range.
 */
export function validateNumber(value: unknown, min: number, max: number, defaultValue: number): number {
  if (value === undefined || value === null) return defaultValue;
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultValue;
  return Math.min(Math.max(min, Math.round(num)), max);
}

/**
 * Validate task sources against the allowlist.
 * Returns only valid sources; falls back to defaults if none are valid.
 */
export function validateTaskSources(sources: unknown): string[] {
  const defaults = ['team-tasks', 'swarm-tasks', 'file-checklist'];
  if (!Array.isArray(sources)) return defaults;
  const valid = sources
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.trim())
    .filter(s => VALID_TASK_SOURCES.has(s));
  return valid.length > 0 ? valid : defaults;
}

// ── State Management ──────────────────────────────────────────

export function getDefaultState(): AutopilotState {
  const crypto = require('crypto') as typeof import('crypto');
  return {
    sessionId: crypto.randomUUID(),
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

export function loadState(): AutopilotState {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const filePath = path.resolve(STATE_FILE);
  const defaults = getDefaultState();
  try {
    if (fs.existsSync(filePath)) {
      const raw = safeJsonParse<Partial<AutopilotState>>(fs.readFileSync(filePath, 'utf-8'));
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
  } catch {
    // Corrupted state file — return defaults
  }
  return defaults;
}

export function saveState(state: AutopilotState): void {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const dir = path.resolve(STATE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Cap history before saving
  if (state.history.length > MAX_HISTORY_ENTRIES) {
    state.history = state.history.slice(-MAX_HISTORY_ENTRIES);
  }
  const tmpFile = path.resolve(STATE_FILE) + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  fs.renameSync(tmpFile, path.resolve(STATE_FILE));
}

export function appendLog(entry: AutopilotLogEntry): void {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const filePath = path.resolve(LOG_FILE);
  const dir = path.resolve(STATE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let log: AutopilotLogEntry[] = [];
  try {
    if (fs.existsSync(filePath)) {
      log = safeJsonParse<AutopilotLogEntry[]>(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(log)) log = [];
    }
  } catch {
    log = [];
  }
  log.push(entry);
  if (log.length > MAX_LOG_ENTRIES) log = log.slice(-MAX_LOG_ENTRIES);
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(log, null, 2));
  fs.renameSync(tmpFile, filePath);
}

export function loadLog(): AutopilotLogEntry[] {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const filePath = path.resolve(LOG_FILE);
  try {
    if (fs.existsSync(filePath)) {
      const result = safeJsonParse<AutopilotLogEntry[]>(fs.readFileSync(filePath, 'utf-8'));
      return Array.isArray(result) ? result : [];
    }
  } catch {
    // Corrupted log — return empty
  }
  return [];
}

// ── Task Discovery ────────────────────────────────────────────

export function discoverTasks(sources: string[]): TaskInfo[] {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const os = require('os') as typeof import('os');
  const tasks: TaskInfo[] = [];

  // Only process valid sources
  const validSources = sources.filter(s => VALID_TASK_SOURCES.has(s));

  for (const source of validSources) {
    if (source === 'team-tasks') {
      const tasksDir = path.join(os.homedir(), '.claude', 'tasks');
      try {
        if (fs.existsSync(tasksDir)) {
          const teams = fs.readdirSync(tasksDir, { withFileTypes: true });
          for (const team of teams) {
            if (!team.isDirectory()) continue;
            const teamDir = path.join(tasksDir, team.name);
            const files = fs.readdirSync(teamDir).filter((f: string) => f.endsWith('.json'));
            for (const file of files) {
              try {
                const data = safeJsonParse<Record<string, unknown>>(fs.readFileSync(path.join(teamDir, file), 'utf-8'));
                tasks.push({
                  id: String(data.id || file.replace('.json', '')),
                  subject: String(data.subject || data.title || file),
                  status: String(data.status || 'unknown'),
                  source: 'team-tasks',
                });
              } catch { /* skip individual file */ }
            }
          }
        }
      } catch { /* skip source */ }
    }

    if (source === 'swarm-tasks') {
      const swarmFile = path.resolve('.monobrain/swarm-tasks.json');
      try {
        if (fs.existsSync(swarmFile)) {
          const data = safeJsonParse<Record<string, unknown> | unknown[]>(fs.readFileSync(swarmFile, 'utf-8'));
          const swarmTasks = Array.isArray(data) ? data : ((data as Record<string, unknown>).tasks as unknown[] || []);
          for (const t of swarmTasks) {
            if (t && typeof t === 'object') {
              const task = t as Record<string, unknown>;
              tasks.push({
                id: String(task.id || task.taskId || `swarm-${tasks.length}`),
                subject: String(task.subject || task.description || task.name || 'Unnamed task'),
                status: String(task.status || 'unknown'),
                source: 'swarm-tasks',
              });
            }
          }
        }
      } catch { /* skip source */ }
    }

    if (source === 'file-checklist') {
      const checklistFile = path.resolve('.monobrain/data/checklist.json');
      try {
        if (fs.existsSync(checklistFile)) {
          const data = safeJsonParse<Record<string, unknown> | unknown[]>(fs.readFileSync(checklistFile, 'utf-8'));
          const items = Array.isArray(data) ? data : ((data as Record<string, unknown>).items as unknown[] || []);
          for (const item of items) {
            if (item && typeof item === 'object') {
              const i = item as Record<string, unknown>;
              tasks.push({
                id: String(i.id || `check-${tasks.length}`),
                subject: String(i.subject || i.text || i.description || 'Unnamed item'),
                status: String(i.status || (i.done ? 'completed' : 'pending')),
                source: 'file-checklist',
              });
            }
          }
        }
      } catch { /* skip source */ }
    }
  }

  return tasks;
}

// ── Progress Helpers ──────────────────────────────────────────

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

export function getProgress(tasks: TaskInfo[]): TaskProgress {
  const completed = tasks.filter(t => isTerminal(t.status)).length;
  const total = tasks.length;
  const percent = total === 0 ? 100 : Math.round((completed / total) * 100);
  const incomplete = tasks.filter(t => !isTerminal(t.status));
  return { completed, total, percent, incomplete };
}

// ── Reward Calculation ────────────────────────────────────────

export function calculateReward(iterations: number, durationMs: number): number {
  const iterFactor = (1 - iterations / (iterations + 10)) * 0.6;
  const timeFactor = (1 - Math.min(durationMs / 3600000, 1)) * 0.4;
  return Math.round((iterFactor + timeFactor) * 100) / 100;
}

// ── Learning Integration ──────────────────────────────────────

export async function tryLoadLearning(): Promise<{ initialize: () => Promise<boolean>; [key: string]: unknown } | null> {
  try {
    const modPath = 'agentic-flow/dist/coordination/autopilot-learning.js';
    const mod = await import(/* webpackIgnore: true */ modPath).catch(() => null);
    if (mod?.AutopilotLearning) {
      const instance = new mod.AutopilotLearning();
      if (await instance.initialize()) return instance;
    }
  } catch { /* not available */ }
  return null;
}
