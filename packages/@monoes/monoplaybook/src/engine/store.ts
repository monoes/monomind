import { readFile } from 'node:fs/promises';
import type { PlaybookDef, RunRecord } from './types.js';

// TODO: Upgrade to better-sqlite3 for persistence across process restarts.
// Schema:
//   CREATE TABLE browse_runs (
//     id TEXT PRIMARY KEY, playbook_id TEXT, playbook_name TEXT,
//     status TEXT, started_at INTEGER, completed_at INTEGER,
//     items_processed INTEGER, items_total INTEGER, error TEXT
//   );
//   CREATE TABLE browse_sessions (
//     id TEXT PRIMARY KEY, platform TEXT, username TEXT,
//     cookies TEXT, user_agent TEXT, created_at INTEGER, last_used_at INTEGER
//   );
const runStore = new Map<string, RunRecord>();

export function clearRunStore(): void {
  runStore.clear();
}

export async function readPlaybook(filePath: string): Promise<PlaybookDef> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`Playbook file not found: ${filePath}`);
  }
  let def: unknown;
  try {
    def = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in playbook file: ${filePath}`);
  }
  if (!isPlaybookDef(def)) {
    const w = def as Record<string, unknown>;
    if (typeof w?.['id'] !== 'string') throw new Error('Playbook missing required field: id');
    if (typeof w?.['name'] !== 'string') throw new Error('Playbook missing required field: name');
    if (!Array.isArray(w?.['nodes'])) throw new Error('Playbook missing required field: nodes');
    throw new Error('Playbook missing required field: connections');
  }
  return def;
}

function isPlaybookDef(def: unknown): def is PlaybookDef {
  if (typeof def !== 'object' || def === null) return false;
  const w = def as Record<string, unknown>;
  return (
    typeof w['id'] === 'string' &&
    typeof w['name'] === 'string' &&
    Array.isArray(w['nodes']) &&
    Array.isArray(w['connections'])
  );
}

export async function writePlaybookRun(record: RunRecord): Promise<void> {
  runStore.set(record.id, { ...record });
}

export async function listPlaybookRuns(playbookId?: string): Promise<RunRecord[]> {
  const all = [...runStore.values()];
  return playbookId ? all.filter(r => r.playbookId === playbookId) : all;
}
