import { readFile } from 'node:fs/promises';
import type { WorkflowDef, RunRecord } from './types.js';
import type { ActionDef } from '../action-builder/types.js';

// TODO: Upgrade to better-sqlite3 for persistence across process restarts.
// Schema:
//   CREATE TABLE browse_runs (
//     id TEXT PRIMARY KEY, workflow_id TEXT, workflow_name TEXT,
//     status TEXT, started_at INTEGER, completed_at INTEGER,
//     items_processed INTEGER, items_total INTEGER, error TEXT
//   );
//   CREATE TABLE browse_sessions (
//     id TEXT PRIMARY KEY, platform TEXT, username TEXT,
//     cookies TEXT, user_agent TEXT, created_at INTEGER, last_used_at INTEGER
//   );
const runStore = new Map<string, RunRecord>();

export async function readWorkflow(filePath: string): Promise<WorkflowDef> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`Workflow file not found: ${filePath}`);
  }
  let def: unknown;
  try {
    def = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in workflow file: ${filePath}`);
  }
  validateWorkflow(def);
  return def as WorkflowDef;
}

function validateWorkflow(def: unknown): void {
  if (typeof def !== 'object' || def === null) {
    throw new Error('Workflow must be a JSON object');
  }
  const w = def as Record<string, unknown>;
  if (typeof w['id'] !== 'string') {
    throw new Error('Workflow missing required field: id');
  }
  if (typeof w['name'] !== 'string') {
    throw new Error('Workflow missing required field: name');
  }
  if (!Array.isArray(w['nodes'])) {
    throw new Error('Workflow missing required field: nodes');
  }
  if (!Array.isArray(w['connections'])) {
    throw new Error('Workflow missing required field: connections');
  }
}

export async function readAction(filePath: string): Promise<ActionDef> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`Action file not found: ${filePath}`);
  }
  let def: unknown;
  try {
    def = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in action file: ${filePath}`);
  }
  return def as ActionDef;
}

export async function writeRunRecord(record: RunRecord): Promise<void> {
  runStore.set(record.id, { ...record });
}

export async function listRuns(workflowId?: string): Promise<RunRecord[]> {
  const all = [...runStore.values()];
  return workflowId ? all.filter(r => r.workflowId === workflowId) : all;
}
