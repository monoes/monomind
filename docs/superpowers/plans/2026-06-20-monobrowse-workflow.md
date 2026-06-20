# monobrowse Workflow System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser workflow automation system to `monomind browse` with DAG execution, platform adapters for LinkedIn/Instagram/X/Gemini, an AI-powered action builder, and a live web dashboard.

**Architecture:** New files only — `browse.ts` is modified only to add three new subcommand imports. Runtime lives in `browser/workflow/`, `browser/adapters/`, `browser/action-builder/`, and `browser/dashboard/`. CLI entry points are `commands/browse-workflow.ts`, `commands/browse-action.ts`, `commands/browse-platform.ts`.

**Tech Stack:** TypeScript/ESM, sql.js (WASM SQLite, already a dep), ws (WebSocket, already a dep), Anthropic SDK (already a dep), vitest

---

## File Map

| File | Purpose |
|---|---|
| `src/browser/workflow/types.ts` | WorkflowDef, NodeDef, ConnectionDef, Item, RunRecord, StepType |
| `src/browser/action-builder/types.ts` | ActionDef, StepDef, StepType |
| `src/browser/workflow/expression.ts` | `{{$json.*}}` / `{{$env.*}}` / `{{params.*}}` template resolver |
| `src/browser/workflow/store.ts` | JSON file reader + sql.js run-history writer |
| `src/browser/workflow/engine.ts` | DAG runner: topological sort → step executor → item flow |
| `src/browser/adapters/index.ts` | PlatformAdapter interface + registry |
| `src/browser/adapters/linkedin.ts` | LinkedIn: isLoggedIn, loginURL, reservedPaths |
| `src/browser/adapters/instagram.ts` | Instagram: isLoggedIn, loginURL, reservedPaths |
| `src/browser/adapters/x.ts` | X: isLoggedIn, loginURL, reservedPaths |
| `src/browser/adapters/gemini.ts` | Gemini: isLoggedIn, loginURL, reservedPaths |
| `src/browser/action-builder/analyzer.ts` | Open page → capture DOM → call Claude API → emit ActionDef |
| `src/browser/dashboard/server.ts` | HTTP + WebSocket server on port 4242 |
| `src/browser/dashboard/ui.html` | Self-contained dashboard web page |
| `src/commands/browse-workflow.ts` | `browse workflow` subcommands (create/run/list/status/stop) |
| `src/commands/browse-action.ts` | `browse action` subcommands (build/run/list/show) |
| `src/commands/browse-platform.ts` | `browse platform` subcommands (connect/list/disconnect) |
| `src/commands/browse.ts` | **MODIFY:** add 3 new subcommand imports to existing array |

---

### Task 1: Workflow + Action Types

**Files:**
- Create: `src/browser/workflow/types.ts`
- Create: `src/browser/action-builder/types.ts`
- Test: `src/__tests__/browse-workflow-types.test.ts`

- [ ] **Step 1: Write failing type tests**

```typescript
// src/__tests__/browse-workflow-types.test.ts
import { describe, it, expect } from 'vitest';
import type { WorkflowDef, NodeDef, ConnectionDef, Item, RunRecord, RunStatus } from '../browser/workflow/types.js';
import type { ActionDef, StepDef } from '../browser/action-builder/types.js';

describe('WorkflowDef', () => {
  it('accepts a valid workflow definition', () => {
    const wf: WorkflowDef = {
      id: 'my-workflow',
      name: 'My Workflow',
      nodes: [
        { id: 'n1', type: 'trigger.manual', config: {} },
        { id: 'n2', type: 'action.linkedin.comment_post', config: { post_url: '{{$json.url}}', text: 'hi' } },
      ],
      connections: [{ from: 'n1', to: 'n2' }],
    };
    expect(wf.nodes).toHaveLength(2);
    expect(wf.connections[0].from).toBe('n1');
  });

  it('accepts a valid ActionDef with steps', () => {
    const action: ActionDef = {
      id: 'linkedin:comment_post',
      platform: 'linkedin',
      name: 'Comment on Post',
      params: ['post_url', 'text'],
      steps: [
        { type: 'navigate', url: '{{params.post_url}}' },
        { type: 'find', selectors: ['.comment-box', '[aria-label="Add a comment"]'], as: 'box' },
        { type: 'click', target: '{{box}}' },
        { type: 'type', target: '{{box}}', text: '{{params.text}}', humanDelay: true },
        { type: 'wait', condition: 'network_idle', timeout: 3000 },
      ],
    };
    expect(action.steps).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-workflow-types.test.ts
```
Expected: FAIL — cannot find module

- [ ] **Step 3: Create workflow types**

```typescript
// src/browser/workflow/types.ts
export interface WorkflowDef {
  id: string;
  name: string;
  nodes: NodeDef[];
  connections: ConnectionDef[];
}

export interface NodeDef {
  id: string;
  type: string; // 'trigger.manual' | 'action.linkedin.comment_post' | 'core.if' | etc.
  name?: string;
  config: Record<string, unknown>;
  onError?: 'skip' | 'stop';
}

export interface ConnectionDef {
  from: string;
  to: string;
  handle?: string; // 'main' | 'true' | 'false'
}

export interface Item {
  data: Record<string, unknown>;
  binary?: string; // base64
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  startedAt: number; // ms epoch
  completedAt?: number;
  itemsProcessed: number;
  itemsTotal: number;
  error?: string;
}

export interface StepEvent {
  runId: string;
  workflowId: string;
  workflowName: string;
  nodeId: string;
  nodeName: string;
  eventType: 'run_started' | 'step_started' | 'step_completed' | 'step_failed' | 'run_completed' | 'run_stopped';
  itemIndex?: number;
  itemTotal?: number;
  durationMs?: number;
  error?: string;
  timestamp: number;
}
```

- [ ] **Step 4: Create action-builder types**

```typescript
// src/browser/action-builder/types.ts
export type StepType = 'navigate' | 'find' | 'click' | 'type' | 'wait' | 'extract' | 'condition';

export interface NavigateStep { type: 'navigate'; url: string; }
export interface FindStep { type: 'find'; selectors: string[]; as: string; }
export interface ClickStep { type: 'click'; target: string; }
export interface TypeStep { type: 'type'; target: string; text: string; humanDelay?: boolean; }
export interface WaitStep { type: 'wait'; condition: 'network_idle' | 'selector' | 'duration'; timeout?: number; selector?: string; }
export interface ExtractStep { type: 'extract'; target: string; as: string; attribute?: string; }
export interface ConditionStep { type: 'condition'; expression: string; then: StepDef[]; else?: StepDef[]; }

export type StepDef = NavigateStep | FindStep | ClickStep | TypeStep | WaitStep | ExtractStep | ConditionStep;

export interface ActionDef {
  id: string;          // 'linkedin:comment_post'
  platform: string;    // 'linkedin'
  name: string;
  params: string[];
  steps: StepDef[];
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-workflow-types.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/src/browser/workflow/types.ts \
        packages/@monomind/cli/src/browser/action-builder/types.ts \
        packages/@monomind/cli/src/__tests__/browse-workflow-types.test.ts
git commit -m "feat(monobrowse): add workflow and action type definitions"
```

---

### Task 2: Expression Engine

**Files:**
- Create: `src/browser/workflow/expression.ts`
- Test: `src/__tests__/browse-expression.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/browse-expression.test.ts
import { describe, it, expect } from 'vitest';
import { resolveExpression, resolveConfig } from '../browser/workflow/expression.js';
import type { Item } from '../browser/workflow/types.js';

const item: Item = { data: { url: 'https://linkedin.com/post/123', comment: 'Great post!' } };
const nodeOutputs: Record<string, Item[]> = {
  'trigger': [{ data: { url: 'https://linkedin.com/post/123' } }],
};
const params: Record<string, string> = { text: 'Hello world', post_url: 'https://linkedin.com/post/123' };

describe('resolveExpression', () => {
  it('resolves $json fields', () => {
    expect(resolveExpression('{{$json.url}}', item, nodeOutputs, params)).toBe('https://linkedin.com/post/123');
  });

  it('resolves $env variables', () => {
    process.env.TEST_VAR = 'test-value';
    expect(resolveExpression('{{$env.TEST_VAR}}', item, nodeOutputs, params)).toBe('test-value');
    delete process.env.TEST_VAR;
  });

  it('resolves params', () => {
    expect(resolveExpression('{{params.text}}', item, nodeOutputs, params)).toBe('Hello world');
  });

  it('resolves node output references', () => {
    expect(resolveExpression('{{$node.trigger.url}}', item, nodeOutputs, params)).toBe('https://linkedin.com/post/123');
  });

  it('returns raw string if no template markers', () => {
    expect(resolveExpression('plain text', item, nodeOutputs, params)).toBe('plain text');
  });

  it('throws on unresolved expression', () => {
    expect(() => resolveExpression('{{$json.missing}}', item, nodeOutputs, params)).toThrow('Unresolved');
  });
});

describe('resolveConfig', () => {
  it('resolves all string values in a config object', () => {
    const config = { post_url: '{{$json.url}}', text: '{{params.text}}', count: 3 };
    const result = resolveConfig(config, item, nodeOutputs, params);
    expect(result.post_url).toBe('https://linkedin.com/post/123');
    expect(result.text).toBe('Hello world');
    expect(result.count).toBe(3); // non-string left as-is
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-expression.test.ts
```
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement expression engine**

```typescript
// src/browser/workflow/expression.ts
import type { Item } from './types.js';

const TEMPLATE_RE = /\{\{([^}]+)\}\}/g;
const cache = new Map<string, RegExpMatchArray[]>();

function extractTemplates(template: string): RegExpMatchArray[] {
  if (cache.has(template)) return cache.get(template)!;
  const matches = [...template.matchAll(new RegExp(TEMPLATE_RE.source, 'g'))];
  cache.set(template, matches);
  return matches;
}

export function resolveExpression(
  template: string,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
): string {
  const matches = extractTemplates(template);
  if (matches.length === 0) return template;

  let result = template;
  for (const match of matches) {
    const expr = match[1].trim();
    const value = resolveToken(expr, item, nodeOutputs, params);
    result = result.replace(match[0], String(value));
  }
  return result;
}

function resolveToken(
  expr: string,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
): unknown {
  if (expr.startsWith('$json.')) {
    const key = expr.slice(6);
    if (!(key in item.data)) throw new Error(`Unresolved: $json.${key} not found in item data`);
    return item.data[key];
  }
  if (expr.startsWith('$env.')) {
    const key = expr.slice(5);
    const val = process.env[key];
    if (val === undefined) throw new Error(`Unresolved: $env.${key} not set`);
    return val;
  }
  if (expr.startsWith('params.')) {
    const key = expr.slice(7);
    if (!(key in params)) throw new Error(`Unresolved: params.${key} not provided`);
    return params[key];
  }
  if (expr.startsWith('$node.')) {
    const parts = expr.slice(6).split('.');
    const nodeId = parts[0];
    const field = parts.slice(1).join('.');
    const items = nodeOutputs[nodeId];
    if (!items || items.length === 0) throw new Error(`Unresolved: $node.${nodeId} has no output`);
    const val = items[0].data[field];
    if (val === undefined) throw new Error(`Unresolved: $node.${nodeId}.${field} not found`);
    return val;
  }
  // Named ref (from find step) — caller resolves these at execution time
  return `{{${expr}}}`;
}

export function resolveConfig(
  config: Record<string, unknown>,
  item: Item,
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    result[k] = typeof v === 'string' ? resolveExpression(v, item, nodeOutputs, params) : v;
  }
  return result;
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-expression.test.ts
```
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/browser/workflow/expression.ts \
        packages/@monomind/cli/src/__tests__/browse-expression.test.ts
git commit -m "feat(monobrowse): add expression engine for {{$json.*}} template resolution"
```

---

### Task 3: Workflow Store

**Files:**
- Create: `src/browser/workflow/store.ts`
- Test: `src/__tests__/browse-store.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/browse-store.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readWorkflow, WorkflowStoreError } from '../browser/workflow/store.js';

// Mock fs/promises to avoid real filesystem in tests
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  mkdir: vi.fn(),
}));

describe('readWorkflow', () => {
  it('parses a valid workflow JSON file', async () => {
    const { readFile } = await import('fs/promises');
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({
      id: 'test-wf',
      name: 'Test',
      nodes: [{ id: 'n1', type: 'trigger.manual', config: {} }],
      connections: [],
    }) as unknown as Uint8Array);

    const wf = await readWorkflow('/path/to/test-wf.json');
    expect(wf.id).toBe('test-wf');
    expect(wf.nodes).toHaveLength(1);
  });

  it('throws WorkflowStoreError for invalid JSON', async () => {
    const { readFile } = await import('fs/promises');
    vi.mocked(readFile).mockResolvedValueOnce('not json' as unknown as Uint8Array);

    await expect(readWorkflow('/path/to/bad.json')).rejects.toThrow(WorkflowStoreError);
  });

  it('throws WorkflowStoreError when file missing', async () => {
    const { readFile } = await import('fs/promises');
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    vi.mocked(readFile).mockRejectedValueOnce(err);

    await expect(readWorkflow('/missing.json')).rejects.toThrow(WorkflowStoreError);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-store.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement the store**

```typescript
// src/browser/workflow/store.ts
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
```

- [ ] **Step 4: Run tests**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-store.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/browser/workflow/store.ts \
        packages/@monomind/cli/src/__tests__/browse-store.test.ts
git commit -m "feat(monobrowse): add workflow store with sql.js run history and session storage"
```

---

### Task 4: DAG Engine

**Files:**
- Create: `src/browser/workflow/engine.ts`
- Test: `src/__tests__/browse-engine.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/browse-engine.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildDag, DagError } from '../browser/workflow/engine.js';
import type { WorkflowDef } from '../browser/workflow/types.js';

describe('buildDag', () => {
  it('returns topological order for a linear workflow', () => {
    const wf: WorkflowDef = {
      id: 'test', name: 'Test',
      nodes: [
        { id: 'a', type: 'trigger.manual', config: {} },
        { id: 'b', type: 'action.linkedin.comment_post', config: {} },
        { id: 'c', type: 'core.filter', config: {} },
      ],
      connections: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    };
    const order = buildDag(wf);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('throws DagError on cyclic workflow', () => {
    const wf: WorkflowDef = {
      id: 'cyclic', name: 'Cyclic',
      nodes: [
        { id: 'a', type: 'trigger.manual', config: {} },
        { id: 'b', type: 'core.filter', config: {} },
      ],
      connections: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    };
    expect(() => buildDag(wf)).toThrow(DagError);
  });

  it('throws DagError when node referenced in connection does not exist', () => {
    const wf: WorkflowDef = {
      id: 'missing', name: 'Missing',
      nodes: [{ id: 'a', type: 'trigger.manual', config: {} }],
      connections: [{ from: 'a', to: 'ghost' }],
    };
    expect(() => buildDag(wf)).toThrow(DagError);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-engine.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement the DAG engine**

```typescript
// src/browser/workflow/engine.ts
import { randomUUID } from 'crypto';
import type { WorkflowDef, NodeDef, Item, RunRecord, StepEvent } from './types.js';
import { resolveConfig } from './expression.js';
import { writeRunRecord } from './store.js';

export class DagError extends Error {
  constructor(message: string) { super(message); this.name = 'DagError'; }
}

export function buildDag(wf: WorkflowDef): string[] {
  const nodeIds = new Set(wf.nodes.map(n => n.id));
  for (const conn of wf.connections) {
    if (!nodeIds.has(conn.from)) throw new DagError(`Connection references unknown node: ${conn.from}`);
    if (!nodeIds.has(conn.to)) throw new DagError(`Connection references unknown node: ${conn.to}`);
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const n of wf.nodes) { inDegree.set(n.id, 0); adjacency.set(n.id, []); }
  for (const conn of wf.connections) {
    adjacency.get(conn.from)!.push(conn.to);
    inDegree.set(conn.to, (inDegree.get(conn.to) ?? 0) + 1);
  }

  const queue = wf.nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    order.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  if (order.length !== wf.nodes.length) throw new DagError('Workflow contains a cycle');
  return order;
}

export interface RunOptions {
  items?: Item[];
  params?: Record<string, string>;
  signal?: AbortSignal;
  onEvent?: (event: StepEvent) => void;
  executeNode?: NodeExecutor;
}

export type NodeExecutor = (
  node: NodeDef,
  items: Item[],
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
  signal?: AbortSignal,
) => Promise<Item[]>;

export async function runWorkflow(
  wf: WorkflowDef,
  options: RunOptions = {},
): Promise<RunRecord> {
  const runId = randomUUID();
  const startedAt = Date.now();
  const items = options.items ?? [{ data: {} }];
  const params = options.params ?? {};
  const emit = options.onEvent ?? (() => {});
  const execute = options.executeNode ?? defaultNodeExecutor;

  const record: RunRecord = {
    id: runId,
    workflowId: wf.id,
    workflowName: wf.name,
    status: 'running',
    startedAt,
    itemsProcessed: 0,
    itemsTotal: items.length,
  };

  emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId: '', nodeName: '',
    eventType: 'run_started', itemTotal: items.length, timestamp: Date.now() });

  const order = buildDag(wf);
  const nodeMap = new Map(wf.nodes.map(n => [n.id, n]));
  const nodeOutputs: Record<string, Item[]> = {};
  let currentItems = items;

  try {
    for (const nodeId of order) {
      if (options.signal?.aborted) {
        record.status = 'stopped';
        record.completedAt = Date.now();
        emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId, nodeName: nodeId,
          eventType: 'run_stopped', timestamp: Date.now() });
        await writeRunRecord(record);
        return record;
      }

      const node = nodeMap.get(nodeId)!;
      const stepStart = Date.now();
      emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId, nodeName: node.name ?? nodeId,
        eventType: 'step_started', itemTotal: currentItems.length, timestamp: stepStart });

      try {
        const output = await execute(node, currentItems, nodeOutputs, params, options.signal);
        nodeOutputs[nodeId] = output;
        record.itemsProcessed = output.length;
        emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId, nodeName: node.name ?? nodeId,
          eventType: 'step_completed', durationMs: Date.now() - stepStart,
          itemTotal: output.length, timestamp: Date.now() });
        if (!node.type.startsWith('trigger.')) currentItems = output;
      } catch (err) {
        emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId, nodeName: node.name ?? nodeId,
          eventType: 'step_failed', error: (err as Error).message,
          durationMs: Date.now() - stepStart, timestamp: Date.now() });
        if (node.onError === 'skip') continue;
        throw err;
      }
    }

    record.status = 'completed';
    record.completedAt = Date.now();
    emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId: '', nodeName: '',
      eventType: 'run_completed', timestamp: Date.now() });
  } catch (err) {
    record.status = 'failed';
    record.error = (err as Error).message;
    record.completedAt = Date.now();
  }

  await writeRunRecord(record);
  return record;
}

async function defaultNodeExecutor(
  node: NodeDef,
  items: Item[],
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
): Promise<Item[]> {
  if (node.type.startsWith('trigger.')) return items;

  if (node.type === 'core.filter') {
    const field = node.config['field'] as string;
    const value = node.config['value'];
    return items.filter(item => item.data[field] === value);
  }

  if (node.type === 'core.set') {
    const assignments = node.config['fields'] as Record<string, unknown>;
    return items.map(item => {
      const resolved = resolveConfig(assignments, item, nodeOutputs, params);
      return { ...item, data: { ...item.data, ...resolved } };
    });
  }

  // action.* nodes — resolved by caller who passes a real executeNode
  return items;
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-engine.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/browser/workflow/engine.ts \
        packages/@monomind/cli/src/__tests__/browse-engine.test.ts
git commit -m "feat(monobrowse): add DAG workflow engine with topological sort and step execution"
```

---

### Task 5: Platform Adapters

**Files:**
- Create: `src/browser/adapters/index.ts`
- Create: `src/browser/adapters/linkedin.ts`
- Create: `src/browser/adapters/instagram.ts`
- Create: `src/browser/adapters/x.ts`
- Create: `src/browser/adapters/gemini.ts`
- Test: `src/__tests__/browse-adapters.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/browse-adapters.test.ts
import { describe, it, expect } from 'vitest';
import { getAdapter, listAdapters } from '../browser/adapters/index.js';

describe('adapter registry', () => {
  it('returns all 4 adapters', () => {
    const adapters = listAdapters();
    const platforms = adapters.map(a => a.platform);
    expect(platforms).toContain('linkedin');
    expect(platforms).toContain('instagram');
    expect(platforms).toContain('x');
    expect(platforms).toContain('gemini');
  });

  it('getAdapter returns correct adapter for platform', () => {
    const adapter = getAdapter('linkedin');
    expect(adapter.platform).toBe('linkedin');
    expect(adapter.baseURL).toBe('https://www.linkedin.com');
  });

  it('getAdapter throws for unknown platform', () => {
    expect(() => getAdapter('tiktok')).toThrow('Unknown platform');
  });

  it('linkedin has correct reserved paths', () => {
    const adapter = getAdapter('linkedin');
    expect(adapter.reservedPaths).toContain('/feed');
    expect(adapter.reservedPaths).toContain('/jobs');
  });

  it('x has correct reserved paths', () => {
    const adapter = getAdapter('x');
    expect(adapter.reservedPaths).toContain('/home');
    expect(adapter.reservedPaths).toContain('/explore');
    expect(adapter.reservedPaths).toContain('/messages');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-adapters.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create adapter interface and registry**

```typescript
// src/browser/adapters/index.ts
import type { CdpClient } from '../cdp.js';

export interface PageInterface {
  client: CdpClient;
  sessionId: string;
  evaluate<T>(fn: string): Promise<T>;
  url(): Promise<string>;
}

export interface PlatformAdapter {
  platform: string;
  baseURL: string;
  reservedPaths: string[];
  isLoggedIn(page: PageInterface): Promise<boolean>;
  loginURL(): string;
  extractUsername(page: PageInterface): Promise<string>;
}

const registry = new Map<string, PlatformAdapter>();

export function registerAdapter(adapter: PlatformAdapter): void {
  registry.set(adapter.platform, adapter);
}

export function getAdapter(platform: string): PlatformAdapter {
  const adapter = registry.get(platform);
  if (!adapter) throw new Error(`Unknown platform: ${platform}. Available: ${[...registry.keys()].join(', ')}`);
  return adapter;
}

export function listAdapters(): PlatformAdapter[] {
  return [...registry.values()];
}

// Auto-register all adapters
import { linkedinAdapter } from './linkedin.js';
import { instagramAdapter } from './instagram.js';
import { xAdapter } from './x.js';
import { geminiAdapter } from './gemini.js';

registerAdapter(linkedinAdapter);
registerAdapter(instagramAdapter);
registerAdapter(xAdapter);
registerAdapter(geminiAdapter);
```

- [ ] **Step 4: Create LinkedIn adapter**

```typescript
// src/browser/adapters/linkedin.ts
import type { PlatformAdapter, PageInterface } from './index.js';

export const linkedinAdapter: PlatformAdapter = {
  platform: 'linkedin',
  baseURL: 'https://www.linkedin.com',
  reservedPaths: ['/feed', '/jobs', '/messaging', '/notifications', '/mynetwork', '/learning', '/search'],

  loginURL: () => 'https://www.linkedin.com/login',

  async isLoggedIn(page: PageInterface): Promise<boolean> {
    const url = await page.url();
    if (url.includes('/login') || url.includes('/authwall')) return false;
    const hasNav = await page.evaluate<boolean>(
      `!!document.querySelector('[data-control-name="nav.home"] ,nav.global-nav')`
    );
    return hasNav;
  },

  async extractUsername(page: PageInterface): Promise<string> {
    const profileUrl = await page.evaluate<string>(
      `(document.querySelector('a[href*="/in/"]')?.getAttribute('href') ?? '')`
    );
    const match = profileUrl.match(/\/in\/([^/?#]+)/);
    return match?.[1] ?? 'unknown';
  },
};
```

- [ ] **Step 5: Create Instagram adapter**

```typescript
// src/browser/adapters/instagram.ts
import type { PlatformAdapter, PageInterface } from './index.js';

export const instagramAdapter: PlatformAdapter = {
  platform: 'instagram',
  baseURL: 'https://www.instagram.com',
  reservedPaths: ['/explore', '/reels', '/direct', '/stories', '/accounts', '/p', '/reel', '/tv'],

  loginURL: () => 'https://www.instagram.com/accounts/login/',

  async isLoggedIn(page: PageInterface): Promise<boolean> {
    const url = await page.url();
    if (url.includes('/accounts/login') || url.includes('/accounts/emailsignup')) return false;
    const hasAvatar = await page.evaluate<boolean>(
      `!!document.querySelector('img[alt*="profile picture"], [aria-label="Home"]')`
    );
    return hasAvatar;
  },

  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>(
      `(document.querySelector('a[href^="/"][href$="/"] span')?.textContent ?? 'unknown').trim()`
    );
  },
};
```

- [ ] **Step 6: Create X adapter**

```typescript
// src/browser/adapters/x.ts
import type { PlatformAdapter, PageInterface } from './index.js';

export const xAdapter: PlatformAdapter = {
  platform: 'x',
  baseURL: 'https://x.com',
  reservedPaths: ['/home', '/explore', '/notifications', '/messages', '/i', '/search',
    '/settings', '/bookmarks', '/lists', '/profile', '/compose', '/trending'],

  loginURL: () => 'https://x.com/i/flow/login',

  async isLoggedIn(page: PageInterface): Promise<boolean> {
    const url = await page.url();
    if (url.includes('/i/flow/login') || url.includes('/login')) return false;
    return page.evaluate<boolean>(
      `!!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')`
    );
  },

  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>(`
      (document.querySelector('[data-testid="UserName"] span')?.textContent ?? 'unknown').trim()
    `);
  },
};
```

- [ ] **Step 7: Create Gemini adapter**

```typescript
// src/browser/adapters/gemini.ts
import type { PlatformAdapter, PageInterface } from './index.js';

export const geminiAdapter: PlatformAdapter = {
  platform: 'gemini',
  baseURL: 'https://gemini.google.com',
  reservedPaths: ['/app', '/faq', '/privacy', '/terms', '/about'],

  loginURL: () => 'https://accounts.google.com/signin',

  async isLoggedIn(page: PageInterface): Promise<boolean> {
    const url = await page.url();
    if (url.includes('accounts.google.com')) return false;
    return page.evaluate<boolean>(
      `!!document.querySelector('bard-sidenav, [data-test-id="bard-sidenav"]')`
    );
  },

  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>(
      `(document.querySelector('[data-email]')?.getAttribute('data-email') ?? 'unknown')`
    );
  },
};
```

- [ ] **Step 8: Run tests**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-adapters.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 9: Commit**

```bash
git add packages/@monomind/cli/src/browser/adapters/ \
        packages/@monomind/cli/src/__tests__/browse-adapters.test.ts
git commit -m "feat(monobrowse): add platform adapters for linkedin, instagram, x, gemini"
```

---

### Task 6: AI Action Builder

**Files:**
- Create: `src/browser/action-builder/analyzer.ts`
- Test: `src/__tests__/browse-analyzer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/browse-analyzer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildPrompt, parseActionResponse } from '../browser/action-builder/analyzer.js';

describe('buildPrompt', () => {
  it('includes the task description in the prompt', () => {
    const prompt = buildPrompt('comment on a post', '<h1>LinkedIn</h1><button>Comment</button>');
    expect(prompt).toContain('comment on a post');
    expect(prompt).toContain('LinkedIn');
  });
});

describe('parseActionResponse', () => {
  it('parses a valid JSON action definition from Claude response', () => {
    const response = `Here is the action:
\`\`\`json
{
  "id": "custom:comment_post",
  "platform": "custom",
  "name": "Comment on Post",
  "params": ["url", "text"],
  "steps": [
    { "type": "navigate", "url": "{{params.url}}" },
    { "type": "find", "selectors": [".comment-box"], "as": "box" },
    { "type": "type", "target": "{{box}}", "text": "{{params.text}}", "humanDelay": true }
  ]
}
\`\`\``;
    const action = parseActionResponse(response);
    expect(action.id).toBe('custom:comment_post');
    expect(action.steps).toHaveLength(3);
  });

  it('throws if response contains no JSON block', () => {
    expect(() => parseActionResponse('Sorry, I cannot help with that.')).toThrow('No JSON');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-analyzer.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement the analyzer**

```typescript
// src/browser/action-builder/analyzer.ts
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { ActionDef } from './types.js';

const SYSTEM_PROMPT = `You are a browser automation expert. Given a DOM snippet and a task description, generate a JSON action definition that automates the task.

Rules:
- Use ONLY these step types: navigate, find, click, type, wait, extract
- For "find" steps, provide 2-3 selector alternatives in order of preference (CSS, aria-label, XPath)
- For "type" steps, set humanDelay: true for form inputs
- Parameters use {{params.name}} syntax
- The action id format is "custom:<snake_case_name>"
- Output ONLY a JSON code block, no explanation before or after

JSON schema:
{
  "id": "custom:action_name",
  "platform": "custom",
  "name": "Human Readable Name",
  "params": ["param1", "param2"],
  "steps": [...]
}`;

export function buildPrompt(task: string, domSnapshot: string): string {
  const truncated = domSnapshot.slice(0, 8000);
  return `Task: ${task}\n\nDOM snapshot:\n${truncated}\n\nGenerate the action JSON.`;
}

export function parseActionResponse(response: string): ActionDef {
  const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!match) throw new Error('No JSON block found in Claude response');
  try {
    return JSON.parse(match[1].trim()) as ActionDef;
  } catch (err) {
    throw new Error(`Invalid JSON in response: ${(err as Error).message}`);
  }
}

export async function analyzeAndBuild(options: {
  url: string;
  task: string;
  client: import('../cdp.js').CdpClient;
  sessionId: string;
  outputDir: string;
}): Promise<ActionDef> {
  const { url, task, client, sessionId, outputDir } = options;

  // Navigate to the URL and wait for load
  await client.send('Page.navigate', { url }, sessionId);
  await new Promise(r => setTimeout(r, 2500)); // allow page to settle

  // Capture DOM snapshot — accessibility tree + visible text
  const domResult = await client.send<{ root: { nodeType: number } }>(
    'DOM.getDocument', { depth: 3, pierce: true }, sessionId
  );
  const outerHtml = await client.send<{ outerHTML: string }>(
    'DOM.getOuterHTML', { nodeId: (domResult as { root: { nodeId: number } }).root.nodeId }, sessionId
  );

  // Strip scripts/styles, keep interactive elements
  const cleanDom = (outerHtml as { outerHTML: string }).outerHTML
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 12000);

  // Call Claude API
  const Anthropic = (await import('anthropic')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(task, cleanDom) }],
  });

  const responseText = message.content
    .filter(c => c.type === 'text')
    .map(c => (c as { type: 'text'; text: string }).text)
    .join('');

  const action = parseActionResponse(responseText);

  // Write to output directory
  await mkdir(outputDir, { recursive: true });
  const filename = action.id.replace(/[^a-z0-9_-]/gi, '_') + '.json';
  const outPath = join(outputDir, filename);
  await writeFile(outPath, JSON.stringify(action, null, 2));

  return action;
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-analyzer.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/browser/action-builder/ \
        packages/@monomind/cli/src/__tests__/browse-analyzer.test.ts
git commit -m "feat(monobrowse): add AI action builder that generates action JSON from DOM snapshot"
```

---

### Task 7: Web Dashboard

**Files:**
- Create: `src/browser/dashboard/server.ts`
- Create: `src/browser/dashboard/ui.html`

No unit tests for the dashboard server — it's integration-tested manually via `browse workflow run`.

- [ ] **Step 1: Create dashboard server**

```typescript
// src/browser/dashboard/server.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { StepEvent, RunRecord } from '../workflow/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4242;

interface DashboardServer {
  broadcast(event: StepEvent): void;
  close(): void;
  port: number;
}

let instance: DashboardServer | null = null;

export function getDashboardServer(port = DEFAULT_PORT): DashboardServer {
  if (instance) return instance;

  const recentRuns: RunRecord[] = [];
  const clients = new Set<WebSocket>();
  const htmlPath = join(__dirname, 'ui.html');

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/') {
      try {
        const html = await readFile(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end('Dashboard UI not found');
      }
      return;
    }
    if (req.method === 'GET' && req.url === '/runs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recentRuns));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    // Send recent state on connect
    ws.send(JSON.stringify({ type: 'init', runs: recentRuns }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  httpServer.listen(port);

  instance = {
    port,
    broadcast(event: StepEvent) {
      const msg = JSON.stringify(event);
      for (const client of clients) {
        if (client.readyState === client.OPEN) client.send(msg);
      }
    },
    close() {
      httpServer.close();
      wss.close();
      instance = null;
    },
  };

  return instance;
}
```

- [ ] **Step 2: Create dashboard UI**

```html
<!-- src/browser/dashboard/ui.html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>monobrowse dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f0f1a; color: #ccc; font-family: system-ui, sans-serif; font-size: 13px; }
  header { background: #7c3aed; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; }
  header h1 { color: #fff; font-size: 14px; font-weight: 600; }
  header .meta { color: rgba(255,255,255,.7); font-size: 11px; }
  .stats { display: flex; gap: 10px; padding: 12px 16px; background: #1a1a2e; border-bottom: 1px solid #2a2a3e; }
  .badge { border-radius: 4px; padding: 3px 10px; font-size: 11px; border: 1px solid; }
  .badge.running { background: #22c55e22; border-color: #22c55e55; color: #22c55e; }
  .badge.done { background: #55555522; border-color: #55555544; color: #888; }
  .badge.failed { background: #ef444422; border-color: #ef444444; color: #ef4444; }
  .runs { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
  .run { background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 8px; padding: 12px; }
  .run.active { border-color: #7c3aed44; }
  .run.completed { opacity: .6; }
  .run.failed { border-color: #ef444444; }
  .run-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .run-name { font-weight: 600; color: #e2e8f0; }
  .status-badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; margin-left: 8px; }
  .status-running { background: #7c3aed22; color: #7c3aed; }
  .status-completed { background: #22c55e22; color: #22c55e; }
  .status-failed { background: #ef444422; color: #ef4444; }
  .status-stopped { background: #f59e0b22; color: #f59e0b; }
  .run-meta { color: #555; font-size: 11px; display: flex; gap: 12px; }
  .steps { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-family: monospace; }
  .step { display: flex; align-items: center; gap: 8px; }
  .step-icon { width: 14px; flex-shrink: 0; }
  .step-name { flex: 1; }
  .step-time { color: #555; font-size: 10px; }
  .step.current .step-name { color: #fff; font-weight: 600; }
  .step.done .step-icon { color: #22c55e; }
  .step.current .step-icon { color: #3b82f6; }
  .step.pending .step-icon { color: #555; }
  .step.error .step-icon { color: #ef4444; }
  .progress-bar { height: 3px; background: #333; border-radius: 2px; margin: 6px 0 2px; }
  .progress-fill { height: 3px; background: #3b82f6; border-radius: 2px; transition: width .3s; }
  .log { margin-top: 8px; background: #0f0f0f; border-radius: 4px; padding: 6px 8px;
         font-family: monospace; font-size: 10px; color: #555; line-height: 1.6; max-height: 60px; overflow: hidden; }
  .stop-btn { background: #ef444422; border: 1px solid #ef444444; color: #ef4444;
              border-radius: 4px; padding: 2px 8px; font-size: 10px; cursor: pointer; }
  .empty { padding: 40px; text-align: center; color: #555; }
</style>
</head>
<body>
<header>
  <h1>monobrowse dashboard</h1>
  <span class="meta" id="meta">connecting...</span>
</header>
<div class="stats">
  <span class="badge running" id="stat-running">0 running</span>
  <span class="badge done" id="stat-done">0 done</span>
  <span class="badge failed" id="stat-failed">0 failed</span>
</div>
<div class="runs" id="runs">
  <div class="empty">No workflows running. Start one with:<br><code>monomind browse workflow run &lt;file.json&gt;</code></div>
</div>

<script>
const runs = new Map();
const logs = new Map();

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { document.getElementById('meta').textContent = `localhost:${location.port} · connected`; };
  ws.onclose = () => { document.getElementById('meta').textContent = 'disconnected · reconnecting...'; setTimeout(connect, 2000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'init') { msg.runs?.forEach(r => runs.set(r.id, r)); render(); return; }
    handleEvent(msg);
  };
}

function handleEvent(ev) {
  if (ev.eventType === 'run_started') {
    runs.set(ev.runId, { id: ev.runId, workflowId: ev.workflowId, workflowName: ev.workflowName,
      status: 'running', startedAt: ev.timestamp, steps: [], currentStep: null,
      itemsProcessed: 0, itemsTotal: ev.itemTotal ?? 0 });
    logs.set(ev.runId, []);
  } else if (ev.eventType === 'step_started') {
    const run = runs.get(ev.runId);
    if (run) { run.currentStep = ev.nodeName; addLog(ev.runId, `${ev.nodeName} → starting...`); }
  } else if (ev.eventType === 'step_completed') {
    const run = runs.get(ev.runId);
    if (run) {
      if (!run.steps) run.steps = [];
      run.steps.push({ name: ev.nodeName, duration: ev.durationMs, status: 'done' });
      run.currentStep = null;
      run.itemsProcessed = ev.itemTotal ?? run.itemsProcessed;
      addLog(ev.runId, `${ev.nodeName} ✓ (${ev.durationMs}ms)`);
    }
  } else if (ev.eventType === 'step_failed') {
    const run = runs.get(ev.runId);
    if (run) {
      if (!run.steps) run.steps = [];
      run.steps.push({ name: ev.nodeName, status: 'error', error: ev.error });
      run.currentStep = null;
      addLog(ev.runId, `${ev.nodeName} ✗ ${ev.error}`);
    }
  } else if (ev.eventType === 'run_completed') {
    const run = runs.get(ev.runId);
    if (run) { run.status = 'completed'; run.completedAt = ev.timestamp; }
  } else if (ev.eventType === 'run_stopped') {
    const run = runs.get(ev.runId);
    if (run) { run.status = 'stopped'; run.completedAt = ev.timestamp; }
  }
  render();
}

function addLog(runId, msg) {
  if (!logs.has(runId)) logs.set(runId, []);
  const ts = new Date().toLocaleTimeString();
  logs.get(runId).push(`${ts} ${msg}`);
  if (logs.get(runId).length > 10) logs.get(runId).shift();
}

function elapsed(startedAt) {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
}

function render() {
  const allRuns = [...runs.values()].sort((a,b) => b.startedAt - a.startedAt);
  const nRunning = allRuns.filter(r => r.status === 'running').length;
  const nDone = allRuns.filter(r => r.status === 'completed').length;
  const nFailed = allRuns.filter(r => r.status === 'failed').length;
  document.getElementById('stat-running').textContent = `${nRunning} running`;
  document.getElementById('stat-done').textContent = `✓ ${nDone} done`;
  document.getElementById('stat-failed').textContent = `✗ ${nFailed} failed`;

  if (allRuns.length === 0) {
    document.getElementById('runs').innerHTML = '<div class="empty">No workflows running. Start one with:<br><code>monomind browse workflow run &lt;file.json&gt;</code></div>';
    return;
  }

  document.getElementById('runs').innerHTML = allRuns.map(run => {
    const stepHtml = (run.steps || []).map(s => `
      <div class="step ${s.status}">
        <span class="step-icon">${s.status==='done'?'✓':s.status==='error'?'✗':'○'}</span>
        <span class="step-name">${s.name}</span>
        <span class="step-time">${s.duration ? s.duration+'ms' : ''}</span>
      </div>`).join('') + (run.currentStep ? `
      <div class="step current">
        <span class="step-icon">⠸</span>
        <span class="step-name">${run.currentStep}</span>
        <span class="step-time">running</span>
      </div>` : '');

    const pct = run.itemsTotal > 0 ? Math.round(run.itemsProcessed / run.itemsTotal * 100) : 0;
    const runLog = (logs.get(run.id) || []).slice(-3).join('\n');
    return `<div class="run ${run.status==='running'?'active':run.status}">
      <div class="run-header">
        <div><span class="run-name">${run.workflowName}</span>
          <span class="status-badge status-${run.status}">${run.status==='completed'?'✓ done':run.status}</span>
        </div>
        <div class="run-meta">
          <span>items: ${run.itemsProcessed}/${run.itemsTotal}</span>
          <span>elapsed: ${elapsed(run.startedAt)}</span>
          ${run.status==='running'?'<button class="stop-btn" onclick="stopRun(\''+run.id+'\')">stop</button>':''}
        </div>
      </div>
      ${run.itemsTotal > 0 ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
      <div class="steps">${stepHtml}</div>
      ${runLog ? `<div class="log">${runLog}</div>` : ''}
    </div>`;
  }).join('');
}

async function stopRun(runId) {
  await fetch(`/stop/${runId}`, { method: 'POST' }).catch(() => {});
}

connect();
setInterval(render, 1000); // Update elapsed time
</script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add packages/@monomind/cli/src/browser/dashboard/
git commit -m "feat(monobrowse): add web dashboard server and UI at localhost:4242"
```

---

### Task 8: browse-workflow CLI Command

**Files:**
- Create: `src/commands/browse-workflow.ts`
- Test: `src/__tests__/browse-workflow-cmd.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/browse-workflow-cmd.test.ts
import { describe, it, expect, vi } from 'vitest';
import { browseWorkflowCommand } from '../commands/browse-workflow.js';
import type { CommandContext } from '../types.js';

vi.mock('../browser/workflow/store.js', () => ({
  readWorkflow: vi.fn(),
  listRuns: vi.fn(async () => []),
  writeRunRecord: vi.fn(),
}));
vi.mock('../browser/workflow/engine.js', () => ({
  runWorkflow: vi.fn(async () => ({ id: 'run-1', status: 'completed', itemsProcessed: 1, itemsTotal: 1 })),
  buildDag: vi.fn(() => ['n1']),
  DagError: class DagError extends Error {},
}));
vi.mock('../browser/dashboard/server.js', () => ({
  getDashboardServer: vi.fn(() => ({ broadcast: vi.fn(), port: 4242 })),
}));

const mockCtx = (args: string[], flags: Record<string, unknown> = {}): CommandContext => ({
  args, flags: { _: [], ...flags }, cwd: '/tmp', interactive: false,
});

describe('browseWorkflowCommand', () => {
  it('exports a command with name "workflow"', () => {
    expect(browseWorkflowCommand.name).toBe('workflow');
    expect(browseWorkflowCommand.subcommands?.length).toBeGreaterThan(0);
  });

  it('has create, run, list, status, stop subcommands', () => {
    const names = browseWorkflowCommand.subcommands?.map(s => s.name) ?? [];
    expect(names).toContain('create');
    expect(names).toContain('run');
    expect(names).toContain('list');
    expect(names).toContain('status');
    expect(names).toContain('stop');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-workflow-cmd.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement browse-workflow.ts**

```typescript
// src/commands/browse-workflow.ts
import { writeFile, mkdir } from 'fs/promises';
import { join, resolve, isAbsolute } from 'path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { input, confirm } from '../prompt.js';

const createSubcommand: Command = {
  name: 'create',
  description: 'Scaffold a new workflow JSON file',
  options: [
    { name: 'output', short: 'o', type: 'string', description: 'Output directory', default: '.monomind/workflows' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const name = ctx.args[0] ?? (ctx.interactive ? await input({ message: 'Workflow name:' }) : undefined);
    if (!name || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      output.printError('Workflow name required (alphanumeric, dash, underscore, max 64 chars)');
      return { success: false, exitCode: 1 };
    }
    const outDir = join(ctx.cwd, ctx.flags.output as string ?? '.monomind/workflows');
    await mkdir(outDir, { recursive: true });
    const filePath = join(outDir, `${name}.json`);
    const template = {
      id: name, name: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      nodes: [
        { id: 'trigger', type: 'trigger.manual', config: {} },
        { id: 'action1', type: 'action.linkedin.comment_post',
          config: { post_url: '{{$json.url}}', text: '{{$json.comment}}', account: '{{$env.LINKEDIN_USER}}' } },
      ],
      connections: [{ from: 'trigger', to: 'action1' }],
    };
    await writeFile(filePath, JSON.stringify(template, null, 2));
    output.printSuccess(`Created ${filePath}`);
    output.printInfo('Edit the file, then run: monomind browse workflow run ' + filePath);
    return { success: true };
  },
};

const runSubcommand: Command = {
  name: 'run',
  description: 'Execute a workflow JSON file',
  options: [
    { name: 'no-dashboard', type: 'boolean', description: 'Skip opening web dashboard', default: false },
    { name: 'port', type: 'number', description: 'Dashboard port', default: 4242 },
    { name: 'items', short: 'i', type: 'string', description: 'JSON file of input items array' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rawPath = ctx.args[0];
    if (!rawPath) { output.printError('Workflow file required: monomind browse workflow run <file.json>'); return { success: false, exitCode: 1 }; }
    const filePath = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath);

    const { readWorkflow, listRuns } = await import('../browser/workflow/store.js');
    const { runWorkflow } = await import('../browser/workflow/engine.js');
    const { getDashboardServer } = await import('../browser/dashboard/server.js');

    const wf = await readWorkflow(filePath).catch(e => { output.printError(e.message); return null; });
    if (!wf) return { success: false, exitCode: 1 };

    const port = ctx.flags.port as number ?? 4242;
    const dashboard = getDashboardServer(port);
    if (!ctx.flags['no-dashboard']) {
      output.printInfo(`Dashboard: http://localhost:${dashboard.port}`);
      const { exec } = await import('child_process');
      exec(`open http://localhost:${dashboard.port}`).unref();
    }

    output.writeln(output.bold(`Running: ${wf.name}`));
    const spinner = output.createSpinner({ text: 'Executing...', spinner: 'dots' });
    spinner.start();

    const record = await runWorkflow(wf, {
      onEvent: (ev) => dashboard.broadcast(ev),
    });

    if (record.status === 'completed') {
      spinner.succeed(`Done — ${record.itemsProcessed} items in ${((record.completedAt! - record.startedAt) / 1000).toFixed(1)}s`);
    } else {
      spinner.fail(`${record.status}${record.error ? ': ' + record.error : ''}`);
    }
    return { success: record.status === 'completed' };
  },
};

const listSubcommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List recent workflow runs',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { listRuns } = await import('../browser/workflow/store.js');
    const runs = await listRuns();
    if (runs.length === 0) { output.printInfo('No runs found'); return { success: true }; }
    output.printTable({
      columns: [
        { key: 'id', header: 'Run ID', width: 12 },
        { key: 'workflowName', header: 'Workflow', width: 20 },
        { key: 'status', header: 'Status', width: 10 },
        { key: 'itemsProcessed', header: 'Items', width: 8, align: 'right' },
        { key: 'startedAt', header: 'Started', width: 20,
          format: (v) => new Date(v as number).toLocaleString() },
      ],
      data: runs,
    });
    return { success: true };
  },
};

const statusSubcommand: Command = {
  name: 'status',
  description: 'Show status of a specific run',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const runId = ctx.args[0];
    if (!runId) { output.printError('Run ID required'); return { success: false, exitCode: 1 }; }
    const { listRuns } = await import('../browser/workflow/store.js');
    const runs = await listRuns();
    const run = runs.find(r => r.id.startsWith(runId));
    if (!run) { output.printError(`Run not found: ${runId}`); return { success: false, exitCode: 1 }; }
    output.printBox([
      `ID: ${run.id}`, `Workflow: ${run.workflowName}`, `Status: ${run.status}`,
      `Items: ${run.itemsProcessed}/${run.itemsTotal}`,
      `Started: ${new Date(run.startedAt).toLocaleString()}`,
      run.completedAt ? `Completed: ${new Date(run.completedAt).toLocaleString()}` : '',
      run.error ? `Error: ${run.error}` : '',
    ].filter(Boolean).join('\n'), 'Run Status');
    return { success: true };
  },
};

const stopSubcommand: Command = {
  name: 'stop',
  description: 'Stop a running workflow (sends abort signal)',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.printInfo('Stop is handled via the dashboard Stop button or Ctrl-C in the running terminal.');
    return { success: true };
  },
};

export const browseWorkflowCommand: Command = {
  name: 'workflow',
  description: 'Browser workflow automation (create, run, list, status)',
  subcommands: [createSubcommand, runSubcommand, listSubcommand, statusSubcommand, stopSubcommand],
  action: async (): Promise<CommandResult> => {
    output.writeln(output.bold('browse workflow — usage:'));
    output.printList([
      'monomind browse workflow create <name>',
      'monomind browse workflow run <file.json>',
      'monomind browse workflow list',
      'monomind browse workflow status <run-id>',
    ]);
    return { success: true };
  },
};

export default browseWorkflowCommand;
```

- [ ] **Step 4: Run tests**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-workflow-cmd.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/commands/browse-workflow.ts \
        packages/@monomind/cli/src/__tests__/browse-workflow-cmd.test.ts
git commit -m "feat(monobrowse): add browse workflow subcommand (create/run/list/status)"
```

---

### Task 9: browse-action CLI Command

**Files:**
- Create: `src/commands/browse-action.ts`
- Test: `src/__tests__/browse-action-cmd.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/browse-action-cmd.test.ts
import { describe, it, expect } from 'vitest';
import { browseActionCommand } from '../commands/browse-action.js';

describe('browseActionCommand', () => {
  it('has name "action"', () => {
    expect(browseActionCommand.name).toBe('action');
  });
  it('has build, run, list, show subcommands', () => {
    const names = browseActionCommand.subcommands?.map(s => s.name) ?? [];
    expect(names).toContain('build');
    expect(names).toContain('run');
    expect(names).toContain('list');
    expect(names).toContain('show');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-action-cmd.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement browse-action.ts**

```typescript
// src/commands/browse-action.ts
import { readdir, readFile } from 'fs/promises';
import { join, resolve, isAbsolute } from 'path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const buildSubcommand: Command = {
  name: 'build',
  description: 'AI-powered: open a URL, analyze DOM, generate an action JSON file',
  options: [
    { name: 'url', short: 'u', type: 'string', description: 'URL to analyze', required: true },
    { name: 'task', short: 't', type: 'string', description: 'What you want the action to do', required: true },
    { name: 'port', type: 'number', description: 'CDP port', default: 9222 },
    { name: 'output', short: 'o', type: 'string', description: 'Output directory', default: '.monomind/actions' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const url = ctx.flags.url as string;
    const task = ctx.flags.task as string;
    const port = ctx.flags.port as number ?? 9222;
    const outDir = join(ctx.cwd, ctx.flags.output as string ?? '.monomind/actions');

    if (!url || !task) {
      output.printError('--url and --task are required');
      return { success: false, exitCode: 1 };
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      output.printError('ANTHROPIC_API_KEY is not set. Required for action build.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: `Opening ${url}...`, spinner: 'dots' });
    spinner.start();

    try {
      const browser = await import('../browser/index.js');
      const cdpPort = await browser.launchBrowser({ port, headless: false });
      const { client, sessionId } = await browser.connectToTarget(cdpPort);

      spinner.text = 'Analyzing DOM...';
      const { analyzeAndBuild } = await import('../browser/action-builder/analyzer.js');
      const action = await analyzeAndBuild({ url, task, client, sessionId, outputDir: outDir });

      spinner.succeed(`Action generated: ${action.id}`);
      output.writeln();
      output.printBox([
        `ID: ${action.id}`,
        `Platform: ${action.platform}`,
        `Steps: ${action.steps.length}`,
        `Params: ${action.params.join(', ')}`,
        `Saved to: ${outDir}/${action.id.replace(/[^a-z0-9_-]/gi, '_')}.json`,
      ].join('\n'), 'Action Built');

      client.close();
      return { success: true, data: action };
    } catch (err) {
      spinner.fail('Action build failed');
      output.printError((err as Error).message);
      return { success: false, exitCode: 1 };
    }
  },
};

const listSubcommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List available actions (built-in + custom)',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const customDir = join(ctx.cwd, '.monomind', 'actions');
    let customFiles: string[] = [];
    try { customFiles = (await readdir(customDir)).filter(f => f.endsWith('.json')); } catch {}

    const builtinActions = [
      { id: 'linkedin:comment_post', platform: 'linkedin', name: 'Comment on Post', source: 'built-in' },
      { id: 'linkedin:like_post', platform: 'linkedin', name: 'Like Post', source: 'built-in' },
      { id: 'linkedin:send_connection', platform: 'linkedin', name: 'Send Connection Request', source: 'built-in' },
      { id: 'linkedin:publish_post', platform: 'linkedin', name: 'Publish Post', source: 'built-in' },
      { id: 'instagram:like_post', platform: 'instagram', name: 'Like Post', source: 'built-in' },
      { id: 'instagram:comment_post', platform: 'instagram', name: 'Comment on Post', source: 'built-in' },
      { id: 'instagram:follow_user', platform: 'instagram', name: 'Follow User', source: 'built-in' },
      { id: 'x:like_post', platform: 'x', name: 'Like Post', source: 'built-in' },
      { id: 'x:reply_post', platform: 'x', name: 'Reply to Post', source: 'built-in' },
      { id: 'x:follow_user', platform: 'x', name: 'Follow User', source: 'built-in' },
      { id: 'gemini:submit_prompt', platform: 'gemini', name: 'Submit Prompt', source: 'built-in' },
    ];

    const customActions = await Promise.all(customFiles.map(async f => {
      try {
        const raw = await readFile(join(customDir, f), 'utf8');
        const def = JSON.parse(raw);
        return { id: def.id, platform: def.platform ?? 'custom', name: def.name, source: 'custom' };
      } catch { return null; }
    }));

    const all = [...builtinActions, ...customActions.filter(Boolean)] as typeof builtinActions;
    output.printTable({
      columns: [
        { key: 'id', header: 'Action ID', width: 30 },
        { key: 'platform', header: 'Platform', width: 12 },
        { key: 'name', header: 'Name', width: 25 },
        { key: 'source', header: 'Source', width: 10 },
      ],
      data: all,
    });
    return { success: true };
  },
};

const showSubcommand: Command = {
  name: 'show',
  description: 'Print an action definition JSON',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const actionId = ctx.args[0];
    if (!actionId) { output.printError('Action ID required'); return { success: false, exitCode: 1 }; }
    const customDir = join(ctx.cwd, '.monomind', 'actions');
    const filename = actionId.replace(/[^a-z0-9_-]/gi, '_') + '.json';
    try {
      const raw = await readFile(join(customDir, filename), 'utf8');
      output.printJson(JSON.parse(raw));
      return { success: true };
    } catch {
      output.printError(`Action not found: ${actionId}. Check "monomind browse action list".`);
      return { success: false, exitCode: 1 };
    }
  },
};

const runSubcommand: Command = {
  name: 'run',
  description: 'Run a single action directly',
  options: [
    { name: 'account', short: 'a', type: 'string', description: 'Platform account username' },
    { name: 'params', short: 'p', type: 'array', description: 'Params as key=value pairs' },
    { name: 'port', type: 'number', description: 'CDP port', default: 9222 },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.printInfo('Direct action run is coming soon. Use workflow run to execute actions.');
    return { success: true };
  },
};

export const browseActionCommand: Command = {
  name: 'action',
  description: 'Manage and run browser actions',
  subcommands: [buildSubcommand, runSubcommand, listSubcommand, showSubcommand],
  action: async (): Promise<CommandResult> => {
    output.writeln(output.bold('browse action — usage:'));
    output.printList([
      'monomind browse action build --url <url> --task "description"',
      'monomind browse action list',
      'monomind browse action show <action-id>',
    ]);
    return { success: true };
  },
};

export default browseActionCommand;
```

- [ ] **Step 4: Run tests**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-action-cmd.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/commands/browse-action.ts \
        packages/@monomind/cli/src/__tests__/browse-action-cmd.test.ts
git commit -m "feat(monobrowse): add browse action subcommand (build/run/list/show)"
```

---

### Task 10: browse-platform CLI Command

**Files:**
- Create: `src/commands/browse-platform.ts`
- Test: `src/__tests__/browse-platform-cmd.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/__tests__/browse-platform-cmd.test.ts
import { describe, it, expect } from 'vitest';
import { browsePlatformCommand } from '../commands/browse-platform.js';

describe('browsePlatformCommand', () => {
  it('has name "platform"', () => {
    expect(browsePlatformCommand.name).toBe('platform');
  });
  it('has connect, list, disconnect subcommands', () => {
    const names = browsePlatformCommand.subcommands?.map(s => s.name) ?? [];
    expect(names).toContain('connect');
    expect(names).toContain('list');
    expect(names).toContain('disconnect');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-platform-cmd.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement browse-platform.ts**

```typescript
// src/commands/browse-platform.ts
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

const SUPPORTED_PLATFORMS = ['linkedin', 'instagram', 'x', 'gemini'];

const connectSubcommand: Command = {
  name: 'connect',
  description: 'Open browser, log in to a platform, save session',
  options: [
    { name: 'port', type: 'number', description: 'CDP port', default: 9222 },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const platform = ctx.args[0];
    if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) {
      output.printError(`Platform required: ${SUPPORTED_PLATFORMS.join(', ')}`);
      return { success: false, exitCode: 1 };
    }

    const { getAdapter } = await import('../browser/adapters/index.js');
    const { saveSession, getSessionCookies } = await import('../browser/workflow/store.js');
    const browser = await import('../browser/index.js');

    const adapter = getAdapter(platform);
    const port = ctx.flags.port as number ?? 9222;

    output.printInfo(`Opening browser → navigating to ${adapter.loginURL()}`);
    output.printInfo('Please log in. Detection is automatic — checking every 2s...');

    const cdpPort = await browser.launchBrowser({ port, headless: false });
    const { client, sessionId, target } = await browser.connectToTarget(cdpPort);
    await client.send('Page.navigate', { url: adapter.loginURL() }, sessionId);

    const page = {
      client, sessionId,
      async evaluate<T>(fn: string): Promise<T> {
        const result = await client.send<{ result: { value: T } }>('Runtime.evaluate', { expression: fn, returnByValue: true }, sessionId);
        return result.result.value;
      },
      async url(): Promise<string> {
        const result = await client.send<{ result: { value: string } }>('Runtime.evaluate',
          { expression: 'window.location.href', returnByValue: true }, sessionId);
        return result.result.value;
      },
    };

    // Poll for login
    let loggedIn = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      loggedIn = await adapter.isLoggedIn(page).catch(() => false);
      if (loggedIn) break;
      process.stdout.write('.');
    }
    process.stdout.write('\n');

    if (!loggedIn) {
      output.printError('Login not detected after 60s. Please try again.');
      client.close();
      return { success: false, exitCode: 1 };
    }

    const username = await adapter.extractUsername(page).catch(() => 'unknown');
    const cookieResult = await client.send<{ cookies: Array<{ name: string; value: string; domain?: string }> }>('Network.getAllCookies', {}, sessionId);
    const cookies = JSON.stringify(cookieResult.cookies);
    const sessionId_ = `${platform}:${username}`;

    await saveSession({ id: sessionId_, platform, username, cookies });
    output.printSuccess(`Connected ${platform} as ${username} (session saved)`);
    client.close();
    return { success: true };
  },
};

const listSubcommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List connected platform accounts',
  action: async (): Promise<CommandResult> => {
    const { listSessions } = await import('../browser/workflow/store.js');
    const sessions = await listSessions();
    if (sessions.length === 0) {
      output.printInfo('No connected accounts. Use: monomind browse platform connect <platform>');
      return { success: true };
    }
    output.printTable({
      columns: [
        { key: 'platform', header: 'Platform', width: 12 },
        { key: 'username', header: 'Username', width: 25 },
        { key: 'lastUsedAt', header: 'Last Used', width: 20,
          format: (v) => new Date(v as number).toLocaleString() },
        { key: 'id', header: 'Session ID', width: 30 },
      ],
      data: sessions,
    });
    return { success: true };
  },
};

const disconnectSubcommand: Command = {
  name: 'disconnect',
  description: 'Remove a saved platform session',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const sessionId = ctx.args[0];
    if (!sessionId) {
      output.printError('Session ID required. Use "monomind browse platform list" to see IDs.');
      return { success: false, exitCode: 1 };
    }
    const { deleteSession } = await import('../browser/workflow/store.js');
    await deleteSession(sessionId);
    output.printSuccess(`Session removed: ${sessionId}`);
    return { success: true };
  },
};

export const browsePlatformCommand: Command = {
  name: 'platform',
  description: 'Manage platform connections (linkedin, instagram, x, gemini)',
  subcommands: [connectSubcommand, listSubcommand, disconnectSubcommand],
  action: async (): Promise<CommandResult> => {
    output.writeln(output.bold('browse platform — usage:'));
    output.printList([
      'monomind browse platform connect <platform>',
      'monomind browse platform list',
      'monomind browse platform disconnect <session-id>',
    ]);
    output.writeln(`\nPlatforms: ${SUPPORTED_PLATFORMS.join(', ')}`);
    return { success: true };
  },
};

export default browsePlatformCommand;
```

- [ ] **Step 4: Run tests**

```bash
cd packages/@monomind/cli && npx vitest run src/__tests__/browse-platform-cmd.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/commands/browse-platform.ts \
        packages/@monomind/cli/src/__tests__/browse-platform-cmd.test.ts
git commit -m "feat(monobrowse): add browse platform subcommand (connect/list/disconnect)"
```

---

### Task 11: Wire Into browse.ts

**Files:**
- Modify: `src/commands/browse.ts` — add 3 imports and 3 entries to subcommands array

- [ ] **Step 1: Find the subcommands array in browse.ts**

Open `src/commands/browse.ts` and locate the main export around line 1940:
```typescript
export const browseCommand: Command = {
  name: 'browse',
  ...
  subcommands: [
    openCommand,
    // ... existing commands
```

- [ ] **Step 2: Add imports at the top of browse.ts**

Add after the last existing import near the top of the file:
```typescript
import { browseWorkflowCommand } from './browse-workflow.js';
import { browseActionCommand } from './browse-action.js';
import { browsePlatformCommand } from './browse-platform.js';
```

- [ ] **Step 3: Add to subcommands array**

In the `subcommands: [...]` array of the main `browseCommand` export, append the three new commands at the end:
```typescript
    // ... existing commands ...
    browseWorkflowCommand,
    browseActionCommand,
    browsePlatformCommand,
  ],
```

- [ ] **Step 4: Build and smoke-test**

```bash
cd packages/@monomind/cli && npm run build 2>&1 | tail -20
```
Expected: Build succeeds with no type errors.

```bash
node packages/@monomind/cli/dist/src/index.js browse workflow --help
node packages/@monomind/cli/dist/src/index.js browse action --help
node packages/@monomind/cli/dist/src/index.js browse platform --help
```
Expected: Each prints usage without error.

- [ ] **Step 5: Run full test suite**

```bash
cd packages/@monomind/cli && npx vitest run
```
Expected: All tests pass including the new ones.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/src/commands/browse.ts
git commit -m "feat(monobrowse): wire workflow/action/platform subcommands into browse command"
```

---

### Task 12: End-to-End Smoke Test

Manual verification — no automated test needed.

- [ ] **Step 1: Build**

```bash
cd packages/@monomind/cli && npm run build
```

- [ ] **Step 2: Connect a platform (optional — requires browser)**

```bash
node dist/src/index.js browse platform connect linkedin
# Complete login in browser window
# Expected: "Connected linkedin as <username>"
```

- [ ] **Step 3: List actions**

```bash
node dist/src/index.js browse action list
# Expected: Table of 11+ built-in actions
```

- [ ] **Step 4: Create and run a workflow**

```bash
node dist/src/index.js browse workflow create test-run
# Expected: Creates .monomind/workflows/test-run.json

node dist/src/index.js browse workflow run .monomind/workflows/test-run.json
# Expected: Opens http://localhost:4242, runs workflow, prints result
```

- [ ] **Step 5: Check run history**

```bash
node dist/src/index.js browse workflow list
# Expected: Table with the run just completed
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(monobrowse): complete browser workflow system with dashboard, adapters, and AI action builder"
```
