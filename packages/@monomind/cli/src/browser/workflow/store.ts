import { readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { WorkflowDef, RunRecord } from './types.js';

export class WorkflowStoreError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'WorkflowStoreError';
  }
}

// ── JSON file operations ──────────────────────────────────────────────────────

export async function readWorkflow(filePath: string): Promise<WorkflowDef> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8') as unknown as string;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new WorkflowStoreError(
      code === 'ENOENT' ? `Workflow file not found: ${filePath}` : `Cannot read workflow file: ${filePath}`,
      err,
    );
  }
  try {
    const wf = JSON.parse(raw) as WorkflowDef;
    if (!wf.id || !Array.isArray(wf.nodes) || !Array.isArray(wf.connections)) {
      throw new Error('Missing required fields: id, nodes, connections');
    }
    return wf;
  } catch (err) {
    throw new WorkflowStoreError(`Invalid workflow JSON in ${filePath}: ${(err as Error).message}`, err);
  }
}

// ── SQLite run history (sql.js) ───────────────────────────────────────────────

const DB_PATH = join(homedir(), '.monomind', 'browse.db');

async function getDb() {
  const { default: initSqlJs } = await import('sql.js');
  const SQL = await initSqlJs();
  await mkdir(join(homedir(), '.monomind'), { recursive: true });

  let fileBuffer: Buffer | undefined;
  try {
    fileBuffer = await readFile(DB_PATH) as unknown as Buffer;
  } catch {
    // First run — no DB yet
  }

  const db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS browse_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    items_processed INTEGER DEFAULT 0,
    items_total INTEGER DEFAULT 0,
    error TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS browse_sessions (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    cookies TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  )`);

  return { db, flush: async () => {
    const data = db.export();
    await writeFile(DB_PATH, Buffer.from(data));
  }};
}

export async function writeRunRecord(record: RunRecord): Promise<void> {
  const { db, flush } = await getDb();
  db.run(
    `INSERT OR REPLACE INTO browse_runs
     (id, workflow_id, workflow_name, status, started_at, completed_at, items_processed, items_total, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [record.id, record.workflowId, record.workflowName, record.status,
     record.startedAt, record.completedAt ?? null, record.itemsProcessed,
     record.itemsTotal, record.error ?? null],
  );
  await flush();
}

export async function listRuns(workflowId?: string): Promise<RunRecord[]> {
  const { db } = await getDb();
  const query = workflowId
    ? db.prepare(`SELECT * FROM browse_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50`)
    : db.prepare(`SELECT * FROM browse_runs ORDER BY started_at DESC LIMIT 50`);

  const rows: RunRecord[] = [];
  if (workflowId) query.bind([workflowId]);
  while (query.step()) {
    const r = query.getAsObject() as Record<string, unknown>;
    rows.push({
      id: r['id'] as string,
      workflowId: r['workflow_id'] as string,
      workflowName: r['workflow_name'] as string,
      status: r['status'] as RunRecord['status'],
      startedAt: r['started_at'] as number,
      completedAt: r['completed_at'] as number | undefined,
      itemsProcessed: r['items_processed'] as number,
      itemsTotal: r['items_total'] as number,
      error: r['error'] as string | undefined,
    });
  }
  query.free();
  return rows;
}

export async function saveSession(session: {
  id: string; platform: string; username: string;
  cookies: string; userAgent?: string;
}): Promise<void> {
  const now = Date.now();
  const { db, flush } = await getDb();
  db.run(
    `INSERT OR REPLACE INTO browse_sessions
     (id, platform, username, cookies, user_agent, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [session.id, session.platform, session.username, session.cookies,
     session.userAgent ?? null, now, now],
  );
  await flush();
}

export async function listSessions(): Promise<Array<{
  id: string; platform: string; username: string; lastUsedAt: number;
}>> {
  const { db } = await getDb();
  const query = db.prepare(`SELECT id, platform, username, last_used_at FROM browse_sessions ORDER BY last_used_at DESC`);
  const rows: Array<{ id: string; platform: string; username: string; lastUsedAt: number }> = [];
  while (query.step()) {
    const r = query.getAsObject() as Record<string, unknown>;
    rows.push({ id: r['id'] as string, platform: r['platform'] as string,
      username: r['username'] as string, lastUsedAt: r['last_used_at'] as number });
  }
  query.free();
  return rows;
}

export async function deleteSession(id: string): Promise<void> {
  const { db, flush } = await getDb();
  db.run(`DELETE FROM browse_sessions WHERE id = ?`, [id]);
  await flush();
}

export async function getSessionCookies(platform: string, username: string): Promise<string | null> {
  const { db } = await getDb();
  const stmt = db.prepare(`SELECT cookies FROM browse_sessions WHERE platform = ? AND username = ? LIMIT 1`);
  stmt.bind([platform, username]);
  if (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    db.run(`UPDATE browse_sessions SET last_used_at = ? WHERE platform = ? AND username = ?`,
      [Date.now(), platform, username]);
    return r['cookies'] as string;
  }
  stmt.free();
  return null;
}
