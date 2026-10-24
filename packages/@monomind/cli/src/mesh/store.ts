import type { AgentInfo, HelloFields, Presence, WhoFilter } from './protocol.js';

/** Live registrations one process may hold, and across the whole host. */
const MAX_LIVE_PER_PID = 64;
const MAX_LIVE_TOTAL = 5000;
/** Rows `list` returns when the caller gives no limit. */
const DEFAULT_LIST_LIMIT = 500;
/** How long a row stays in the table (and in `includeGone` listings) after the agent left. */
const GONE_RETENTION_MS = 24 * 60 * 60 * 1000;

export class StoreError extends Error {
  constructor(
    readonly code: 'ALIAS_TAKEN' | 'LIMIT',
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

interface Stmt {
  run(...args: unknown[]): { changes: number };
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
}
interface Db {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  pragma(s: string): unknown;
  close(): void;
}

interface Row {
  addr: string;
  alias: string | null;
  tier: HelloFields['tier'];
  runtime: string;
  pid: number;
  project: string;
  project_path: string;
  task: string | null;
  capabilities: string;
  tags: string;
  parent: string | null;
  status: Presence;
  last_seen: number;
  joined_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  addr TEXT PRIMARY KEY,
  alias TEXT,
  tier TEXT NOT NULL,
  runtime TEXT NOT NULL,
  pid INTEGER NOT NULL,
  project TEXT NOT NULL,
  project_path TEXT NOT NULL,
  task TEXT,
  capabilities TEXT NOT NULL,
  tags TEXT NOT NULL,
  parent TEXT,
  status TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  joined_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_project_status ON agents(project, status);
PRAGMA user_version = 1;
`;

function toInfo(r: Row): AgentInfo {
  const addr = r.addr.split('/');
  return {
    addr: r.addr,
    tier: r.tier,
    runtime: r.runtime,
    pid: r.pid,
    project: r.project,
    projectPath: r.project_path,
    sessionId: addr[2],
    ...(addr[3] ? { agentId: addr[3] } : {}),
    ...(r.alias ? { alias: r.alias } : {}),
    ...(r.task ? { task: r.task } : {}),
    capabilities: JSON.parse(r.capabilities) as string[],
    tags: JSON.parse(r.tags) as string[],
    ...(r.parent ? { parent: r.parent } : {}),
    status: r.status,
    lastSeen: r.last_seen,
    joinedAt: r.joined_at,
  };
}

/** Sole-writer presence store. Only the hub opens it. */
export class MeshStore {
  private constructor(private readonly db: Db) {}

  static async open(file: string): Promise<MeshStore> {
    // better-sqlite3 is an `export =` CJS module: the constructor is on `.default`.
    const mod = await import('better-sqlite3');
    const Database = (mod as unknown as { default: new (path: string) => Db }).default;
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    return new MeshStore(db);
  }

  upsertAgent(addr: string, h: HelloFields, now: number): void {
    const live = this.db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(pid = ?), 0) AS mine FROM agents
         WHERE status != 'gone' AND addr != ?`,
      )
      .get(h.pid, addr) as { total: number; mine: number };
    if (live.mine >= MAX_LIVE_PER_PID || live.total >= MAX_LIVE_TOTAL) {
      throw new StoreError('LIMIT', 'too many live registrations');
    }
    if (h.alias) {
      const taken = this.db
        .prepare(
          `SELECT addr FROM agents WHERE project = ? AND alias = ? AND status != 'gone' AND addr != ?`,
        )
        .get(h.project, h.alias, addr);
      if (taken) {
        throw new StoreError('ALIAS_TAKEN', `alias "${h.alias}" is in use in project ${h.project}`);
      }
    }
    this.db
      .prepare(
        `INSERT INTO agents (addr, alias, tier, runtime, pid, project, project_path, task, capabilities, tags, parent, status, last_seen, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT(addr) DO UPDATE SET
           alias = excluded.alias, tier = excluded.tier, runtime = excluded.runtime, pid = excluded.pid,
           project_path = excluded.project_path, task = excluded.task, capabilities = excluded.capabilities,
           tags = excluded.tags, parent = excluded.parent, status = 'active', last_seen = excluded.last_seen`,
      )
      .run(
        addr,
        h.alias ?? null,
        h.tier,
        h.runtime,
        h.pid,
        h.project,
        h.projectPath,
        h.task ?? null,
        JSON.stringify(h.capabilities),
        JSON.stringify(h.tags),
        h.parent ?? null,
        now,
        now,
      );
  }

  /** False when the agent is unknown or already gone (the caller must re-register). */
  heartbeat(addr: string, now: number, task?: string): boolean {
    const r = this.db
      .prepare(
        `UPDATE agents SET status = 'active', last_seen = ?, task = COALESCE(?, task)
         WHERE addr = ? AND status != 'gone'`,
      )
      .run(now, task ?? null, addr);
    return r.changes > 0;
  }

  bye(addr: string): void {
    this.db.prepare(`UPDATE agents SET status = 'gone' WHERE addr = ?`).run(addr);
  }

  sweep(
    now: number,
    staleMs: number,
    goneMs: number,
    isAlive: (pid: number) => boolean,
    pruneGoneMs = GONE_RETENTION_MS,
  ): { stale: string[]; gone: string[] } {
    this.db
      .prepare(`DELETE FROM agents WHERE status = 'gone' AND last_seen < ?`)
      .run(now - pruneGoneMs);
    const rows = this.db
      .prepare(`SELECT addr, pid, status, last_seen FROM agents WHERE status != 'gone'`)
      .all() as Pick<Row, 'addr' | 'pid' | 'status' | 'last_seen'>[];
    const out = { stale: [] as string[], gone: [] as string[] };
    const setStatus = this.db.prepare(`UPDATE agents SET status = ? WHERE addr = ?`);
    for (const r of rows) {
      const age = now - r.last_seen;
      if (!isAlive(r.pid) || age >= goneMs) {
        setStatus.run('gone', r.addr);
        out.gone.push(r.addr);
      } else if (age >= staleMs && r.status === 'active') {
        setStatus.run('stale', r.addr);
        out.stale.push(r.addr);
      }
    }
    return out;
  }

  list(filter: Partial<WhoFilter> = {}, limit = DEFAULT_LIST_LIMIT): AgentInfo[] {
    const where: string[] = [];
    const args: unknown[] = [];
    const eq = (column: string, value: string | undefined) => {
      if (!value) return;
      where.push(`${column} = ?`);
      args.push(value);
    };
    eq('project', filter.project);
    eq('tier', filter.tier);
    eq('status', filter.status);
    if (!filter.status && !filter.includeGone) where.push(`status != 'gone'`);
    eq('parent', filter.parent);
    if (filter.capability) {
      where.push('EXISTS (SELECT 1 FROM json_each(capabilities) WHERE value = ?)');
      args.push(filter.capability);
    }
    if (filter.tag) {
      where.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)');
      args.push(filter.tag);
    }
    const sql = `SELECT * FROM agents ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY joined_at, addr LIMIT ?`;
    return (this.db.prepare(sql).all(...args, limit) as Row[]).map(toInfo);
  }

  liveCount(): number {
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM agents WHERE status != 'gone'`).get() as {
      n: number;
    };
    return r.n;
  }

  close(): void {
    this.db.close();
  }
}
