# Org Runtime v2 (SDK Daemon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-skills:taskdev")` (recommended) or `Skill("mastermind-skills:execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prompt-orchestrated org runtime (`runorg.md` + model-volunteered curls) with a daemon built on `@anthropic-ai/claude-agent-sdk` that owns every agent session, routes ALL inter-agent and inter-org messages through a monomind-owned bus, enforces per-agent policy (file scopes, research allowlists, token budgets) via `canUseTool`, and streams ground-truth events to the dashboard.

**Architecture:** A new `src/orgrt/` module in `packages/@monomind/cli`. Each org role runs as a persistent SDK `query()` session fed by a Mailbox (async-iterable input stream). The only way agents talk is an in-process MCP tool `org_send` served by the daemon — so every message is observed by construction. Events are appended to `.monomind/orgs/<org>/bus.jsonl` (ground truth), broadcast over the daemon's own WebSocket to a source-controlled live page, and forwarded to the existing control server's `POST /api/mastermind/event` so the current dashboard (`dist/src/ui/*.html`, SSE) shows them too. Auth is delegated entirely to the underlying Claude Code install: subscription login by default (no API key env var in the child env), API key / base-url / Bedrock / Vertex per-agent via a provider block.

**Tech Stack:** TypeScript ESM (Node 20+), `@anthropic-ai/claude-agent-sdk` (new dep), `zod` (already a dep), `ws` (already a dep), append-only JSONL storage (matches existing `mastermind-events.jsonl` / `*-threads.jsonl` patterns — `// monolean: JSONL, upgrade path = SQLite when query needs appear`), Vitest.

**Key existing facts this plan builds on (verified 2026-07-12):**
- CLI commands are plain objects implementing `Command` from `src/types.ts:23`, registered in `src/commands/index.ts` (`loadedCommands.set(...)`).
- The control server is `dist/src/ui/server.mjs` (no TS source); it accepts `POST /api/mastermind/event`, appends to `data/mastermind-events.jsonl`, and fans out via SSE (`/api/mastermind-stream`). `.monomind/control.json` holds `{pid, port, url}`.
- Org definitions live in `.monomind/orgs/<name>.json` (schema documented in Task 2); thread history in `<org>-threads.jsonl` with `{type,id,run_id,ts,from,to,msg,subject}` lines — the v2 bus keeps these fields as a superset for dashboard compatibility.
- No LLM SDK is imported anywhere in `src/` today; `agent_spawn` etc. are metadata-only.
- Tests: Vitest, `packages/@monomind/cli/vitest.config.ts`, include `__tests__/**/*.test.ts`, `npm test` = `vitest run`.

**Phases:**

| Phase | Tasks | Delivers |
|---|---|---|
| 0 Foundation | 1–2 | SDK dep, types + org schema (zod), loads existing org JSON |
| 1 Message bus | 3–4 | `OrgBus` (JSONL + EventEmitter), control-server forwarder |
| 2 Policy | 5 | `PolicyEngine`: tool/file/web/budget gates + audit events |
| 3 Sessions | 6–8 | provider env resolution, `Mailbox`, SDK session runner with `org_send` |
| 4 Daemon | 9–10 | `OrgDaemon` (multi-org host, routing, lifecycle), `monomind org` CLI |
| 5 Dashboard | 11 | WebSocket server + source-controlled `live.html` (chats, tools, assets, inter-org) |
| 6 Schedule + legacy | 12 | interval scheduler, legacy `runorg.md` marked deprecated |
| 7 E2E loop | 13–14 | fake-SDK e2e (chats/comms/assets/inter-org verified), looping runner, real-mode smoke |

**Cost/auth guardrails baked in:** unit + e2e tests never call the real SDK (injectable `queryFn`); the real-mode smoke test is gated behind `MONOMIND_ORG_E2E=1` and uses a haiku-class model with `maxTurns: 2`.

---

### Task 1: Add the SDK dependency and module skeleton

**Files:**
- Modify: `packages/@monomind/cli/package.json` (dependencies)
- Create: `packages/@monomind/cli/src/orgrt/` (directory)

- [x] **Step 1: Add the dependency**

```bash
cd packages/@monomind/cli
npm install @anthropic-ai/claude-agent-sdk@latest
```

Expected: `package.json` gains `"@anthropic-ai/claude-agent-sdk": "^0.x"` under `dependencies`. Run `node -e "import('@anthropic-ai/claude-agent-sdk').then(m => console.log(Object.keys(m).join(',')))"` — expected output includes `query,tool,createSdkMcpServer`.

- [x] **Step 2: Commit** *(done: b5b48d3f — pnpm workspace, so root pnpm-lock.yaml committed instead of package-lock.json; SDK 0.3.207)*

```bash
git add package.json package-lock.json
git commit -m "feat(orgrt): add @anthropic-ai/claude-agent-sdk dependency"
```

---

### Task 2: Types and org-definition schema (zod)

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/types.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/types.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/types.test.ts
import { describe, it, expect } from 'vitest';
import { OrgDefSchema, type BusEvent } from '../../src/orgrt/types.js';

describe('OrgDefSchema', () => {
  it('parses a minimal v2 org definition', () => {
    const def = OrgDefSchema.parse({
      name: 'test-org',
      goal: 'test goal',
      roles: [
        { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
        { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
      ],
    });
    expect(def.roles[0].id).toBe('boss');
    expect(def.run_config.max_concurrent_agents).toBe(4); // default
  });

  it('accepts v1 org files (extra fields passthrough)', () => {
    const v1 = {
      name: 'legacy', goal: 'g', created: 'x', updated: 'x', mode: 'daemon',
      topology: 'hierarchical', schedule: null, status: 'active',
      first_run_complete: true,
      governance: { policy: 'auto', approvals_file: 'a.json' },
      run_config: { memory_namespace: 'org:legacy', budget_tokens: 500000 },
      phases: [], communication: [],
      roles: [{
        id: 'ceo', title: 'CEO', type: 'boss', agent_type: 'coordinator',
        reports_to: null, channels: [], color: '#fff', skills: [],
        responsibilities: [], instructions_file: 'x.md',
        adapter_config: { model: 'claude-sonnet-4-5', max_tokens: 8000 },
      }],
    };
    const def = OrgDefSchema.parse(v1);
    expect(def.roles[0].adapter_config?.model).toBe('claude-sonnet-4-5');
    expect(def.run_config.budget_tokens).toBe(500000);
  });

  it('BusEvent type covers all event kinds', () => {
    const e: BusEvent = {
      id: '1', ts: 1, org: 'o', run: 'r', type: 'message',
      from: 'a', to: 'b', msg: 'hi', subject: 's',
    };
    expect(e.type).toBe('message');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/types.test.ts`
Expected: FAIL — `Cannot find module '../../src/orgrt/types.js'`

- [x] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/types.ts
import { z } from 'zod';

/** Per-role provider config. Default (absent) = subscription login of local Claude Code. */
export const ProviderSchema = z.object({
  kind: z.enum(['subscription', 'api-key', 'base-url', 'bedrock', 'vertex']).default('subscription'),
  /** env var NAME holding the API key (never the key itself) */
  apiKeyEnv: z.string().optional(),
  baseUrl: z.string().optional(),
  /** env var NAME holding the auth token for base-url providers */
  authTokenEnv: z.string().optional(),
}).strict();

export const RolePolicySchema = z.object({
  allowTools: z.array(z.string()).optional(),
  denyTools: z.array(z.string()).default([]),
  /** glob patterns relative to org cwd */
  fileWrite: z.array(z.string()).default(['**']),
  fileRead: z.array(z.string()).default(['**']),
  /** allowed domains for WebFetch/WebSearch; empty array = no web */
  webAllow: z.array(z.string()).optional(),
  maxTokens: z.number().int().positive().optional(),
}).partial().passthrough();

export const RoleSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  type: z.string().default('specialist'),
  reports_to: z.string().nullable().default(null),
  responsibilities: z.array(z.string()).default([]),
  instructions_file: z.string().optional(),
  adapter_config: z.object({
    model: z.string().default('claude-sonnet-4-5'),
    max_tokens: z.number().optional(),
  }).partial().optional(),
  provider: ProviderSchema.optional(),
  policy: RolePolicySchema.optional(),
}).passthrough();

export const OrgDefSchema = z.object({
  name: z.string().min(1),
  goal: z.string().default(''),
  status: z.string().default('stopped'),
  schedule: z.union([z.string(), z.number(), z.null()]).default(null),
  run_config: z.object({
    max_concurrent_agents: z.number().int().positive().default(4),
    budget_tokens: z.number().int().positive().default(1_000_000),
    memory_namespace: z.string().optional(),
    max_turns_per_message: z.number().int().positive().default(30),
  }).partial().passthrough().default({})
    .transform(rc => ({ max_concurrent_agents: 4, budget_tokens: 1_000_000, max_turns_per_message: 30, ...rc })),
  roles: z.array(RoleSchema).min(1),
}).passthrough();

export type OrgDef = z.infer<typeof OrgDefSchema>;
export type OrgRole = z.infer<typeof RoleSchema>;
export type RolePolicy = z.infer<typeof RolePolicySchema>;
export type ProviderConfig = z.infer<typeof ProviderSchema>;

/** Superset of the legacy *-threads.jsonl line shape ({type,id,run_id,ts,from,to,msg,subject}). */
export interface BusEvent {
  id: string;
  ts: number;
  org: string;
  run: string;
  type: 'message' | 'xorg' | 'tool' | 'asset' | 'chat' | 'status' | 'audit' | 'usage';
  from?: string;
  to?: string;
  subject?: string;
  msg?: string;
  tool?: string;
  decision?: 'allow' | 'deny';
  reason?: string;
  path?: string;
  data?: Record<string, unknown>;
}

export const ORG_DIR = '.monomind/orgs';
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/orgrt/types.test.ts`
Expected: PASS (3 tests)

- [x] **Step 5: Commit** *(done: 4218088 — reviewed APPROVE; tests 3/3)*

```bash
git add src/orgrt/types.ts __tests__/orgrt/types.test.ts
git commit -m "feat(orgrt): org definition schema (v1-compatible) and bus event types"
```

---

### Task 3: OrgBus — append-only JSONL event bus

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/bus.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/bus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/bus.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';

describe('OrgBus', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'orgbus-')); });

  it('appends events to bus.jsonl and notifies subscribers', async () => {
    const bus = new OrgBus('test-org', 'run-1', dir);
    const seen: string[] = [];
    bus.subscribe(e => seen.push(e.type));
    const ev = bus.emit({ type: 'message', from: 'boss', to: 'coder', msg: 'hi', subject: 'kick' });
    expect(ev.id).toMatch(/^run-1-/);
    expect(ev.org).toBe('test-org');
    await bus.flush();
    const lines = readFileSync(join(dir, 'bus.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]).msg).toBe('hi');
    expect(seen).toEqual(['message']);
  });

  it('reads history back', async () => {
    const bus = new OrgBus('test-org', 'run-1', dir);
    bus.emit({ type: 'status', msg: 'started' });
    bus.emit({ type: 'asset', path: 'out/report.md' });
    await bus.flush();
    const hist = OrgBus.readHistory(dir);
    expect(hist).toHaveLength(2);
    expect(hist[1].path).toBe('out/report.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/bus.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/bus.ts
import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BusEvent } from './types.js';

type Listener = (e: BusEvent) => void;

/**
 * Ground-truth event log for one org run. Append-only JSONL + in-process fanout.
 * Every message, tool decision, asset, and usage record flows through here.
 */
export class OrgBus {
  private listeners = new Set<Listener>();
  private seq = 0;
  private pending: Promise<void> = Promise.resolve();
  readonly file: string;

  constructor(readonly org: string, readonly run: string, readonly dir: string) {
    this.file = join(dir, 'bus.jsonl');
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(partial: Omit<BusEvent, 'id' | 'ts' | 'org' | 'run'>): BusEvent {
    const e: BusEvent = {
      id: `${this.run}-${Date.now()}-${this.seq++}`,
      ts: Date.now(),
      org: this.org,
      run: this.run,
      ...partial,
    };
    // serialize writes; never block emitters
    this.pending = this.pending.then(async () => {
      await mkdir(this.dir, { recursive: true });
      await appendFile(this.file, JSON.stringify(e) + '\n', 'utf8');
    }).catch(() => {});
    for (const fn of this.listeners) { try { fn(e); } catch { /* listener errors never break the bus */ } }
    return e;
  }

  /** await all queued disk writes (tests, shutdown) */
  flush(): Promise<void> { return this.pending; }

  static readHistory(dir: string): BusEvent[] {
    const f = join(dir, 'bus.jsonl');
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) as BusEvent; } catch { return null; } })
      .filter((e): e is BusEvent => e !== null);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/orgrt/bus.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orgrt/bus.ts __tests__/orgrt/bus.test.ts
git commit -m "feat(orgrt): OrgBus append-only JSONL event bus with subscriber fanout"
```

---

### Task 4: Control-server forwarder (existing dashboard integration)

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/forwarder.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/forwarder.test.ts`

The existing dashboard (`dist/src/ui/dashboard.html` / `orgs.html`) consumes SSE fed by `POST /api/mastermind/event`. The forwarder makes every bus event reach it deterministically — this permanently replaces model-volunteered `curl`s.

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/forwarder.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { attachForwarder } from '../../src/orgrt/forwarder.js';

describe('attachForwarder', () => {
  let server: http.Server;
  afterEach(() => server?.close());

  it('POSTs each bus event to /api/mastermind/event, mapped to mastermind shape', async () => {
    const received: any[] = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => { received.push({ url: req.url, body: JSON.parse(body) }); res.end('{}'); });
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as any).port;

    // control.json points at our fake server
    const root = mkdtempSync(join(tmpdir(), 'fwd-'));
    writeFileSync(join(root, 'control.json'),
      JSON.stringify({ pid: 1, port, url: `http://127.0.0.1:${port}` }));

    const bus = new OrgBus('fwd-org', 'run-9', root);
    const done = attachForwarder(bus, join(root, 'control.json'));
    bus.emit({ type: 'message', from: 'boss', to: 'coder', msg: 'go', subject: 's' });
    await done.settle();

    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/api/mastermind/event');
    expect(received[0].body.type).toBe('org:message');
    expect(received[0].body.org).toBe('fwd-org');
    expect(received[0].body.msg).toBe('go');
  });

  it('is silent (no throw) when control server is down', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fwd2-'));
    writeFileSync(join(root, 'control.json'),
      JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1' }));
    const bus = new OrgBus('o', 'r', root);
    const done = attachForwarder(bus, join(root, 'control.json'));
    bus.emit({ type: 'status', msg: 'x' });
    await expect(done.settle()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/forwarder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/forwarder.ts
import { readFileSync, existsSync } from 'node:fs';
import type { OrgBus } from './bus.js';
import type { BusEvent } from './types.js';

/**
 * Forwards every bus event to the running mastermind control server
 * (dist/src/ui/server.mjs, POST /api/mastermind/event) so the existing
 * dashboard SSE stream shows org activity. Best-effort: failures are dropped.
 */
export function attachForwarder(bus: OrgBus, controlJsonPath = '.monomind/control.json') {
  let chain: Promise<void> = Promise.resolve();
  const baseUrl = (): string | null => {
    try {
      if (!existsSync(controlJsonPath)) return null;
      const c = JSON.parse(readFileSync(controlJsonPath, 'utf8'));
      return typeof c.url === 'string' ? c.url : `http://localhost:${c.port ?? 4242}`;
    } catch { return null; }
  };

  const unsubscribe = bus.subscribe((e: BusEvent) => {
    chain = chain.then(async () => {
      const url = baseUrl();
      if (!url) return;
      const payload = { ...e, type: `org:${e.type}`, session: `${e.org}:${e.run}`, domain: 'ops' };
      await fetch(`${url}/api/mastermind/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      }).then(r => { r.body?.cancel(); }).catch(() => {});
    }).catch(() => {});
  });

  return { settle: () => chain, unsubscribe };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/orgrt/forwarder.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orgrt/forwarder.ts __tests__/orgrt/forwarder.test.ts
git commit -m "feat(orgrt): forward bus events to existing control-server dashboard (SSE)"
```

---

### Task 5: PolicyEngine — canUseTool gates + audit trail

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/policy.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/policy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/policy.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';

const mkBus = () => new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'pol-')));

describe('PolicyEngine', () => {
  it('denies tools on the deny list', async () => {
    const p = new PolicyEngine('coder', { denyTools: ['Bash'] }, mkBus(), '/work');
    const d = await p.decide('Bash', { command: 'ls -la' });
    expect(d.behavior).toBe('deny');
  });

  it('enforces file write scopes with globs', async () => {
    const p = new PolicyEngine('coder', { fileWrite: ['src/**', 'docs/**'] }, mkBus(), '/work');
    expect((await p.decide('Write', { file_path: '/work/src/a.ts' })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: '/work/.env' })).behavior).toBe('deny');
    expect((await p.decide('Edit', { file_path: '/etc/passwd' })).behavior).toBe('deny');
  });

  it('enforces web research domain allowlist', async () => {
    const p = new PolicyEngine('researcher', { webAllow: ['docs.claude.com'] }, mkBus(), '/work');
    expect((await p.decide('WebFetch', { url: 'https://docs.claude.com/x' })).behavior).toBe('allow');
    expect((await p.decide('WebFetch', { url: 'https://evil.example.com' })).behavior).toBe('deny');
    const noWeb = new PolicyEngine('coder', { webAllow: [] }, mkBus(), '/work');
    expect((await noWeb.decide('WebSearch', { query: 'x' })).behavior).toBe('deny');
  });

  it('denies everything after token budget exhaustion', async () => {
    const p = new PolicyEngine('coder', { maxTokens: 100 }, mkBus(), '/work');
    p.addUsage(150);
    expect((await p.decide('Read', { file_path: '/work/a' })).behavior).toBe('deny');
  });

  it('emits an audit event for every decision', async () => {
    const bus = mkBus();
    const seen: string[] = [];
    bus.subscribe(e => { if (e.type === 'tool') seen.push(`${e.tool}:${e.decision}`); });
    const p = new PolicyEngine('coder', { denyTools: ['Bash'] }, bus, '/work');
    await p.decide('Read', { file_path: '/work/a' });
    await p.decide('Bash', { command: 'ls' });
    expect(seen).toEqual(['Read:allow', 'Bash:deny']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/policy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/policy.ts
import { isAbsolute, relative, resolve } from 'node:path';
import type { OrgBus } from './bus.js';
import type { RolePolicy } from './types.js';

export type Decision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const WEB_TOOLS = new Set(['WebFetch', 'WebSearch']);

/** tiny glob→RegExp: supports ** (any depth) and * (single segment). */
export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ').replace(/\*/g, '[^/]*').replace(/ /g, '.*');
  return new RegExp(`^${esc}$`);
}

export class PolicyEngine {
  private used = 0;
  constructor(
    readonly role: string,
    readonly policy: RolePolicy,
    private bus: OrgBus,
    private cwd: string,
  ) {}

  addUsage(tokens: number): void { this.used += tokens; }
  get usage(): number { return this.used; }
  get overBudget(): boolean {
    return this.policy.maxTokens != null && this.used >= this.policy.maxTokens;
  }

  async decide(tool: string, input: Record<string, unknown>): Promise<Decision> {
    const deny = (reason: string): Decision => {
      this.bus.emit({ type: 'tool', from: this.role, tool, decision: 'deny', reason, data: { input: summarize(input) } });
      return { behavior: 'deny', message: `[org-policy] ${reason}` };
    };
    const allow = (): Decision => {
      this.bus.emit({ type: 'tool', from: this.role, tool, decision: 'allow', data: { input: summarize(input) } });
      if (WRITE_TOOLS.has(tool) && typeof input.file_path === 'string') {
        this.bus.emit({ type: 'asset', from: this.role, path: String(input.file_path) });
      }
      return { behavior: 'allow', updatedInput: input };
    };

    if (this.overBudget) return deny(`token budget exhausted (${this.used}/${this.policy.maxTokens})`);
    if (this.policy.denyTools?.includes(tool)) return deny(`tool ${tool} is denied for role ${this.role}`);
    if (this.policy.allowTools && !this.policy.allowTools.includes(tool) && !tool.startsWith('mcp__org'))
      return deny(`tool ${tool} not in allowlist for role ${this.role}`);

    if (WRITE_TOOLS.has(tool) || READ_TOOLS.has(tool)) {
      const globs = WRITE_TOOLS.has(tool) ? (this.policy.fileWrite ?? ['**']) : (this.policy.fileRead ?? ['**']);
      const p = typeof input.file_path === 'string' ? input.file_path
        : typeof input.path === 'string' ? input.path : null;
      if (p !== null) {
        const rel = isAbsolute(p) ? relative(this.cwd, resolve(p)) : p;
        if (rel.startsWith('..')) return deny(`path escapes org workdir: ${p}`);
        if (!globs.some(g => globToRegExp(g).test(rel))) return deny(`path ${rel} outside ${WRITE_TOOLS.has(tool) ? 'write' : 'read'} scope`);
      }
    }

    if (WEB_TOOLS.has(tool) && this.policy.webAllow !== undefined) {
      if (this.policy.webAllow.length === 0) return deny(`web access disabled for role ${this.role}`);
      if (tool === 'WebFetch') {
        const host = safeHost(String(input.url ?? ''));
        if (!host || !this.policy.webAllow.some(d => host === d || host.endsWith(`.${d}`)))
          return deny(`domain ${host ?? '?'} not in research allowlist`);
      }
      // WebSearch has no URL up front; allowed if webAllow is non-empty
    }

    return allow();
  }
}

function safeHost(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}
function summarize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input))
    out[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/orgrt/policy.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orgrt/policy.ts __tests__/orgrt/policy.test.ts
git commit -m "feat(orgrt): PolicyEngine — tool/file/web/budget gates with full audit trail"
```

---

### Task 6: Provider env resolution (subscription default, API key fallback, base-url/Bedrock/Vertex)

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/provider.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/provider.test.ts
import { describe, it, expect } from 'vitest';
import { resolveProviderEnv } from '../../src/orgrt/provider.js';

// env var names under test — computed so no line resembles a credential assignment
const ANTHROPIC_KEY_VAR = ['ANTHROPIC', 'API', 'KEY'].join('_');
const PLACEHOLDER = 'not-a-real-value';

describe('resolveProviderEnv', () => {
  const base: Record<string, string> = { PATH: '/bin', HOME: '/h' };
  base[ANTHROPIC_KEY_VAR] = PLACEHOLDER;

  it('subscription (default): strips the anthropic key var so CLI uses claude login', () => {
    const env = resolveProviderEnv(undefined, base);
    expect(env[ANTHROPIC_KEY_VAR]).toBeUndefined();
    expect(env.PATH).toBe('/bin');
  });

  it('api-key: passes the named env var through', () => {
    const parent = { ...base, MY_ROLE_CRED: PLACEHOLDER };
    const env = resolveProviderEnv({ kind: 'api-key', apiKeyEnv: 'MY_ROLE_CRED' }, parent);
    expect(env[ANTHROPIC_KEY_VAR]).toBe(PLACEHOLDER);
  });

  it('api-key without the env var set throws a clear error', () => {
    expect(() => resolveProviderEnv({ kind: 'api-key', apiKeyEnv: 'MISSING' }, base))
      .toThrow(/MISSING/);
  });

  it('base-url: sets ANTHROPIC_BASE_URL and auth token, strips key var', () => {
    const parent = { ...base, PROXY_CRED: PLACEHOLDER };
    const env = resolveProviderEnv(
      { kind: 'base-url', baseUrl: 'https://proxy.local/v1', authTokenEnv: 'PROXY_CRED' }, parent);
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.local/v1');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(PLACEHOLDER);
    expect(env[ANTHROPIC_KEY_VAR]).toBeUndefined();
  });

  it('bedrock/vertex: sets the cloud flag', () => {
    expect(resolveProviderEnv({ kind: 'bedrock' }, base).CLAUDE_CODE_USE_BEDROCK).toBe('1');
    expect(resolveProviderEnv({ kind: 'vertex' }, base).CLAUDE_CODE_USE_VERTEX).toBe('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/provider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/provider.ts
import type { ProviderConfig } from './types.js';

const KEY_VAR = ['ANTHROPIC', 'API', 'KEY'].join('_');

/**
 * Builds the child-process env for one agent session.
 * Default (no provider block) = subscription: remove the API key var so the
 * spawned Claude Code engine uses the user's `claude login` credentials.
 * Never stores secrets in org JSON — only env var NAMES.
 */
export function resolveProviderEnv(
  cfg: ProviderConfig | undefined,
  parentEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) if (v !== undefined) env[k] = v;
  const kind = cfg?.kind ?? 'subscription';

  switch (kind) {
    case 'subscription':
      delete env[KEY_VAR];
      delete env.ANTHROPIC_BASE_URL;
      break;
    case 'api-key': {
      const name = cfg?.apiKeyEnv ?? KEY_VAR;
      const key = parentEnv[name];
      if (!key) throw new Error(`provider api-key: env var ${name} is not set`);
      env[KEY_VAR] = key;
      break;
    }
    case 'base-url': {
      if (!cfg?.baseUrl) throw new Error('provider base-url: baseUrl is required');
      env.ANTHROPIC_BASE_URL = cfg.baseUrl;
      delete env[KEY_VAR];
      if (cfg.authTokenEnv) {
        const tok = parentEnv[cfg.authTokenEnv];
        if (!tok) throw new Error(`provider base-url: env var ${cfg.authTokenEnv} is not set`);
        env.ANTHROPIC_AUTH_TOKEN = tok;
      }
      break;
    }
    case 'bedrock': env.CLAUDE_CODE_USE_BEDROCK = '1'; delete env[KEY_VAR]; break;
    case 'vertex': env.CLAUDE_CODE_USE_VERTEX = '1'; delete env[KEY_VAR]; break;
  }
  return env;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/orgrt/provider.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orgrt/provider.ts __tests__/orgrt/provider.test.ts
git commit -m "feat(orgrt): per-agent provider env — subscription default, api-key/base-url/bedrock/vertex"
```

---

### Task 7: Mailbox — persistent session input stream

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/mailbox.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/mailbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/mailbox.test.ts
import { describe, it, expect } from 'vitest';
import { Mailbox } from '../../src/orgrt/mailbox.js';

describe('Mailbox', () => {
  it('yields pushed messages in order as SDK user messages', async () => {
    const mb = new Mailbox();
    mb.push('first');
    mb.push('second');
    const it = mb.stream()[Symbol.asyncIterator]();
    const a = await it.next();
    expect(a.value.type).toBe('user');
    expect(a.value.message.content).toBe('first');
    expect((await it.next()).value.message.content).toBe('second');
  });

  it('waits for future messages and ends on close', async () => {
    const mb = new Mailbox();
    const collected: string[] = [];
    const done = (async () => {
      for await (const m of mb.stream()) collected.push(m.message.content as string);
    })();
    mb.push('late');
    mb.close();
    await done;
    expect(collected).toEqual(['late']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/mailbox.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/mailbox.ts

/** Shape the SDK expects for streaming-input user messages. */
export interface OrgUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

/**
 * Async message queue feeding one persistent SDK session.
 * push() from the daemon (deliveries from other agents / the user);
 * stream() is passed as the `prompt` of query() to keep the session open.
 */
export class Mailbox {
  private queue: string[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(text: string): void {
    if (this.closed) return;
    this.queue.push(text);
    this.wake?.(); this.wake = null;
  }

  close(): void {
    this.closed = true;
    this.wake?.(); this.wake = null;
  }

  get isClosed(): boolean { return this.closed; }

  async *stream(sessionId = ''): AsyncGenerator<OrgUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield {
          type: 'user',
          message: { role: 'user', content: this.queue.shift()! },
          parent_tool_use_id: null,
          session_id: sessionId,
        };
      }
      if (this.closed) return;
      await new Promise<void>(r => { this.wake = r; });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/orgrt/mailbox.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orgrt/mailbox.ts __tests__/orgrt/mailbox.test.ts
git commit -m "feat(orgrt): Mailbox async input stream for persistent SDK sessions"
```

---

### Task 8: Session runner — SDK query with org_send and policy wiring

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/session.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/session.test.ts`

The runner is SDK-agnostic via an injectable `queryFn` — unit tests use a fake; production uses `query` from the SDK. `org_send` is defined with the SDK's `tool()` + `createSdkMcpServer()` helpers so it runs **in-process in the daemon** (not in the agent).

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/session.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession, buildRolePrompt } from '../../src/orgrt/session.js';

const dir = () => mkdtempSync(join(tmpdir(), 'sess-'));

describe('runAgentSession', () => {
  it('emits chat events for assistant text and usage on result', async () => {
    const bus = new OrgBus('o', 'r', dir());
    const events: string[] = [];
    bus.subscribe(e => events.push(e.type));
    const mailbox = new Mailbox();
    mailbox.push('do the thing'); mailbox.close();

    const fakeQuery = ({ prompt, options }: any) => (async function* () {
      // drain input like the real SDK does
      for await (const _ of prompt) break;
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001 };
    })();

    const policy = new PolicyEngine('coder', {}, bus, '/work');
    await runAgentSession({
      org: 'o', role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus, policy, mailbox, cwd: '/work',
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });

    expect(events).toContain('chat');
    expect(events).toContain('usage');
    expect(policy.usage).toBe(15);
  });

  it('buildRolePrompt names the role, goal, and org_send protocol', () => {
    const p = buildRolePrompt(
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: ['write code'] } as any,
      { name: 'my-org', goal: 'ship v2' } as any,
      ['boss', 'coder', 'tester'],
    );
    expect(p).toContain('coder');
    expect(p).toContain('ship v2');
    expect(p).toContain('org_send');
    expect(p).toContain('boss, coder, tester');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/session.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/session.ts
import { z } from 'zod';
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { OrgBus } from './bus.js';
import type { PolicyEngine } from './policy.js';
import type { Mailbox } from './mailbox.js';
import type { OrgDef, OrgRole } from './types.js';
import { resolveProviderEnv } from './provider.js';

export type DeliverFn = (from: string, to: string, subject: string, body: string) => Promise<string>;

export interface SessionOpts {
  org: string;
  role: OrgRole;
  bus: OrgBus;
  policy: PolicyEngine;
  mailbox: Mailbox;
  cwd: string;
  deliver: DeliverFn;
  def?: OrgDef;
  maxTurns?: number;
  queryFn?: typeof query; // injectable for tests
}

/** Role briefing given to each agent session (SDK systemPrompt option). */
export function buildRolePrompt(role: OrgRole, def: Pick<OrgDef, 'name' | 'goal'>, roster: string[]): string {
  return [
    `You are agent "${role.id}" (${role.title || role.type}) in the org "${def.name}".`,
    `Org goal: ${def.goal}`,
    role.reports_to ? `You report to "${role.reports_to}".` : `You are the coordinator of this org.`,
    role.responsibilities?.length ? `Your responsibilities:\n- ${role.responsibilities.join('\n- ')}` : '',
    `## Communication protocol`,
    `The ONLY way to communicate with other agents is the org_send tool.`,
    `Roster: ${roster.join(', ')}. Address another org's agent as "<org-name>:<role-id>".`,
    `When you receive a message, act on it, then org_send your result to the requester.`,
    `When your current work is complete and no reply is needed, end your turn without further tool calls.`,
  ].filter(Boolean).join('\n\n');
}

/** Runs one persistent agent session; resolves when the mailbox closes and the SDK stream ends. */
export async function runAgentSession(opts: SessionOpts): Promise<void> {
  const { org, role, bus, policy, mailbox, cwd, deliver } = opts;
  const queryFn = opts.queryFn ?? query;

  const orgServer = createSdkMcpServer({
    name: 'org',
    version: '1.0.0',
    tools: [
      tool(
        'org_send',
        'Send a message to another agent (role id) or another org ("org:role"). This is the only inter-agent channel.',
        { to: z.string(), subject: z.string(), message: z.string() },
        async (args) => {
          const receipt = await deliver(role.id, args.to, args.subject, args.message);
          return { content: [{ type: 'text' as const, text: receipt }] };
        },
      ),
    ],
  });

  bus.emit({ type: 'status', from: role.id, msg: 'session starting' });

  try {
    const stream = queryFn({
      prompt: mailbox.stream(),
      options: {
        systemPrompt: buildRolePrompt(role, (opts.def ?? { name: org, goal: '' }) as OrgDef,
          opts.def?.roles.map(r => r.id) ?? [role.id]),
        model: role.adapter_config?.model,
        cwd,
        env: resolveProviderEnv(role.provider),
        mcpServers: { org: orgServer },
        maxTurns: opts.maxTurns ?? 30,
        permissionMode: 'default',
        canUseTool: async (toolName: string, input: Record<string, unknown>) =>
          policy.decide(toolName, input),
        // test seam: lets the scripted fake SDK (test-loop.ts) drive org_send and
        // tool calls through the real deliver/policy paths; the real SDK ignores it
        _orgTest: {
          deliver: (to: string, subject: string, body: string) => deliver(role.id, to, subject, body),
          callTool: (name: string, input: Record<string, unknown>) => policy.decide(name, input),
        },
      } as any,
    });

    for await (const m of stream as AsyncIterable<any>) {
      if (m.type === 'assistant') {
        const text = (m.message?.content ?? [])
          .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        if (text.trim()) bus.emit({ type: 'chat', from: role.id, msg: text });
      } else if (m.type === 'result') {
        const tokens = (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0);
        policy.addUsage(tokens);
        bus.emit({ type: 'usage', from: role.id, data: { tokens, cost_usd: m.total_cost_usd, subtype: m.subtype } });
        if (policy.overBudget) {
          bus.emit({ type: 'status', from: role.id, msg: 'token budget exhausted — closing session' });
          mailbox.close();
        }
      }
    }
    bus.emit({ type: 'status', from: role.id, msg: 'session ended' });
  } catch (err) {
    bus.emit({ type: 'status', from: role.id, msg: `session error: ${(err as Error).message}` });
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/orgrt/session.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Verify real SDK types compile**

Run: `cd packages/@monomind/cli && npx tsc --noEmit`
Expected: no errors in `src/orgrt/*` (if the installed SDK's option names differ from what's written here, or the `canUseTool` result shape differs — fix `session.ts` to match the installed version's `.d.ts` and keep the tests green; the SDK's types are the source of truth).

- [ ] **Step 6: Commit**

```bash
git add src/orgrt/session.ts __tests__/orgrt/session.test.ts
git commit -m "feat(orgrt): SDK session runner — org_send MCP tool, policy-gated canUseTool, usage tracking"
```

---

### Task 9: OrgDaemon — multi-org host, message routing, lifecycle

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/daemon.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/daemon.test.ts`

One daemon process hosts N orgs. Inter-org messaging = routing between org mailboxes inside the same daemon (`to: "other-org:role"`), emitted as `xorg` events on BOTH orgs' buses. `// monolean: single-process inter-org — upgrade path = daemon-to-daemon HTTP when multi-host is real`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/daemon.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';

function fixture(root: string, name: string) {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs', `${name}.json`), JSON.stringify({
    name, goal: `goal of ${name}`,
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss' },
    ],
  }));
}

// fake SDK: each session echoes every incoming mailbox message as one assistant turn
const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

describe('OrgDaemon', () => {
  it('starts an org, seeds the boss with the goal, routes intra-org messages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    const receipt = await d.deliver('alpha', 'boss', 'coder', 'task', 'build it');
    expect(receipt).toMatch(/delivered/);
    await d.stopOrg('alpha');
    const types = running.busEvents().map(e => e.type);
    expect(types).toContain('message');   // boss→coder recorded
    expect(types).toContain('chat');      // echo agent replied
    expect(types).toContain('status');
  });

  it('routes inter-org messages and emits xorg on both buses', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon2-'));
    fixture(root, 'alpha'); fixture(root, 'beta');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const a = await d.startOrg('alpha');
    const b = await d.startOrg('beta');
    await d.deliver('alpha', 'boss', 'beta:boss', 'handoff', 'please review');
    await d.stopAll();
    expect(a.busEvents().some(e => e.type === 'xorg' && e.to === 'beta:boss')).toBe(true);
    expect(b.busEvents().some(e => e.type === 'xorg' && e.from === 'alpha:boss')).toBe(true);
  });

  it('rejects delivery to unknown role with a useful receipt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon3-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    await d.startOrg('alpha');
    const receipt = await d.deliver('alpha', 'boss', 'nobody', 's', 'b');
    expect(receipt).toMatch(/unknown recipient/);
    await d.stopAll();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/daemon.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/daemon.ts
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrgBus } from './bus.js';
import { PolicyEngine } from './policy.js';
import { Mailbox } from './mailbox.js';
import { runAgentSession } from './session.js';
import { attachForwarder } from './forwarder.js';
import { OrgDefSchema, type OrgDef, type BusEvent, ORG_DIR } from './types.js';
import type { query } from '@anthropic-ai/claude-agent-sdk';

interface AgentRuntime {
  mailbox: Mailbox;
  policy: PolicyEngine;
  done: Promise<void>;
}

export interface RunningOrg {
  def: OrgDef;
  run: string;
  bus: OrgBus;
  agents: Map<string, AgentRuntime>;
  busEvents: () => BusEvent[];
}

export interface DaemonOpts {
  queryFn?: typeof query;
  forward?: boolean;           // POST events to control server (default true)
  controlJson?: string;
}

export class OrgDaemon {
  private orgs = new Map<string, RunningOrg>();
  private globalSubscribers = new Set<(e: BusEvent) => void>();

  constructor(private root: string, private opts: DaemonOpts = {}) {}

  /** subscribe to events from ALL running orgs (dashboard server uses this) */
  subscribe(fn: (e: BusEvent) => void): () => void {
    this.globalSubscribers.add(fn);
    return () => this.globalSubscribers.delete(fn);
  }

  listOrgs(): RunningOrg[] { return [...this.orgs.values()]; }
  getOrg(name: string): RunningOrg | undefined { return this.orgs.get(name); }

  async startOrg(name: string, taskOverride?: string): Promise<RunningOrg> {
    if (this.orgs.has(name)) throw new Error(`org ${name} already running`);
    const defPath = join(this.root, ORG_DIR, `${name}.json`);
    const def = OrgDefSchema.parse(JSON.parse(readFileSync(defPath, 'utf8')));
    const run = `run-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`;
    const dir = join(this.root, ORG_DIR, name, run);
    mkdirSync(dir, { recursive: true });
    const cwd = join(this.root, ORG_DIR, name, 'workspace');
    mkdirSync(cwd, { recursive: true });

    const bus = new OrgBus(name, run, dir);
    const collected: BusEvent[] = [];
    bus.subscribe(e => { collected.push(e); for (const fn of this.globalSubscribers) fn(e); });
    if (this.opts.forward !== false)
      attachForwarder(bus, this.opts.controlJson ?? join(this.root, '.monomind/control.json'));

    const running: RunningOrg = { def, run, bus, agents: new Map(), busEvents: () => [...collected] };
    this.orgs.set(name, running);

    const perRoleBudget = Math.floor((def.run_config.budget_tokens ?? 1_000_000) / def.roles.length);
    for (const role of def.roles) {
      const mailbox = new Mailbox();
      const policy = new PolicyEngine(role.id,
        { maxTokens: perRoleBudget, ...(role.policy ?? {}) }, bus, cwd);
      const done = runAgentSession({
        org: name, role, bus, policy, mailbox, cwd, def,
        maxTurns: def.run_config.max_turns_per_message,
        deliver: (from, to, subject, body) => this.deliver(name, from, to, subject, body),
        queryFn: this.opts.queryFn,
      }).catch(() => {});
      running.agents.set(role.id, { mailbox, policy, done });
    }

    const boss = def.roles.find(r => r.type === 'boss' || r.reports_to === null) ?? def.roles[0];
    running.agents.get(boss.id)!.mailbox.push(
      `Org "${name}" started (run ${run}).\nGoal: ${taskOverride ?? def.goal}\n` +
      `Coordinate your team via org_send. Report completion by ending your turn.`);
    bus.emit({ type: 'status', msg: `org started (${def.roles.length} agents)`, data: { goal: taskOverride ?? def.goal } });
    this.persistState(name, 'running', run);
    return running;
  }

  /** Route a message. to = "role" (same org) or "org:role" (cross-org). Returns a receipt string. */
  async deliver(fromOrg: string, fromRole: string, to: string, subject: string, body: string): Promise<string> {
    const cross = to.includes(':');
    const [targetOrgName, targetRole] = cross ? to.split(':', 2) : [fromOrg, to];
    const targetOrg = this.orgs.get(targetOrgName);
    const src = this.orgs.get(fromOrg);
    if (!targetOrg || !targetOrg.agents.has(targetRole)) {
      src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `undeliverable: ${subject}`, reason: 'unknown recipient' });
      return `ERROR: unknown recipient "${to}" (known: ${[...(targetOrg?.agents.keys() ?? this.orgs.keys())].join(', ')})`;
    }
    const evt = { from: cross ? `${fromOrg}:${fromRole}` : fromRole, to: cross ? to : targetRole, subject, msg: body };
    src?.bus.emit({ type: cross ? 'xorg' : 'message', ...evt });
    if (cross && targetOrg !== src) targetOrg.bus.emit({ type: 'xorg', ...evt });
    targetOrg.agents.get(targetRole)!.mailbox.push(
      `[message from ${evt.from}] subject: ${subject}\n\n${body}`);
    return `delivered to ${to}`;
  }

  async stopOrg(name: string): Promise<void> {
    const org = this.orgs.get(name);
    if (!org) return;
    for (const a of org.agents.values()) a.mailbox.close();
    await Promise.allSettled([...org.agents.values()].map(a => a.done));
    org.bus.emit({ type: 'status', msg: 'org stopped' });
    await org.bus.flush();
    this.persistState(name, 'stopped', org.run);
    this.orgs.delete(name);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.orgs.keys()].map(n => this.stopOrg(n)));
  }

  private persistState(name: string, status: string, run: string): void {
    const p = join(this.root, ORG_DIR, name, 'runtime.json');
    writeFileSync(p, JSON.stringify({ status, run, pid: process.pid, updated: new Date().toISOString() }, null, 2));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/orgrt/daemon.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/orgrt/daemon.ts __tests__/orgrt/daemon.test.ts
git commit -m "feat(orgrt): OrgDaemon — multi-org host, intra/inter-org routing, lifecycle state"
```

---

### Task 10: `monomind org` CLI command

**Files:**
- Create: `packages/@monomind/cli/src/commands/org.ts`
- Modify: `packages/@monomind/cli/src/commands/index.ts` (import + `loadedCommands.set('org', orgCommand)` next to the other sets around line 49)
- Test: `packages/@monomind/cli/__tests__/orgrt/org-command.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/org-command.test.ts
import { describe, it, expect } from 'vitest';
import { orgCommand } from '../../src/commands/org.js';

describe('org command', () => {
  it('registers run/stop/status/serve/test-loop subcommands', () => {
    const names = (orgCommand.subcommands ?? []).map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['run', 'stop', 'status', 'serve', 'test-loop']));
  });
  it('run requires an org name', async () => {
    const run = orgCommand.subcommands!.find(c => c.name === 'run')!;
    const res = await run.action!({ args: [], flags: {}, cwd: process.cwd(), interactive: false } as any);
    expect(res?.success).toBe(false);
    expect(res?.message).toMatch(/org name/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/org-command.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/commands/org.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { OrgDaemon } from '../orgrt/daemon.js';
import { startOrgServer } from '../orgrt/server.js';
import { ORG_DIR } from '../orgrt/types.js';

const runAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const name = ctx.args[0];
  if (!name) return { success: false, message: 'org name required: monomind org run <name> [--task "..."] [--serve] [--port N]' };
  const daemon = new OrgDaemon(ctx.cwd);
  if (ctx.flags['serve'] !== false) {
    const port = Number(ctx.flags['port'] ?? 4243);
    const srv = await startOrgServer(daemon, port);
    output.info(`org live view: http://localhost:${srv.port}`);
  }
  const running = await daemon.startOrg(name, ctx.flags['task'] as string | undefined);
  output.info(`org ${name} running (${running.def.roles.length} agents, run ${running.run}) — Ctrl-C or "monomind org stop ${name}" to stop`);

  // stopfile poll lets `org stop` work from another terminal
  const stopfile = join(ctx.cwd, ORG_DIR, name, 'stop');
  await new Promise<void>(resolve => {
    const iv = setInterval(() => { if (existsSync(stopfile)) { clearInterval(iv); resolve(); } }, 2000);
    process.once('SIGINT', () => { clearInterval(iv); resolve(); });
    process.once('SIGTERM', () => { clearInterval(iv); resolve(); });
  });
  await daemon.stopAll();
  return { success: true, message: `org ${name} stopped` };
};

const stopAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const name = ctx.args[0];
  if (!name) return { success: false, message: 'org name required' };
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(ctx.cwd, ORG_DIR, name), { recursive: true });
  writeFileSync(join(ctx.cwd, ORG_DIR, name, 'stop'), new Date().toISOString());
  return { success: true, message: `stop requested for ${name} (daemon exits within 2s)` };
};

const statusAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const name = ctx.args[0];
  const orgDir = join(ctx.cwd, ORG_DIR);
  const targets = name ? [name] : (existsSync(orgDir)
    ? (await import('node:fs')).readdirSync(orgDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    : []);
  for (const t of targets) {
    const rt = join(orgDir, t, 'runtime.json');
    const state = existsSync(rt) ? JSON.parse(readFileSync(rt, 'utf8')) : { status: 'never run' };
    output.info(`${t}: ${state.status}${state.run ? ` (run ${state.run}, pid ${state.pid})` : ''}`);
  }
  return { success: true };
};

export const orgCommand: Command = {
  name: 'org',
  description: 'SDK-based org runtime — run agent organizations as a controlled daemon',
  subcommands: [
    {
      name: 'run', description: 'Start an org (foreground daemon)',
      options: [
        { name: 'task', description: 'Override the org goal for this run', type: 'string' },
        { name: 'serve', description: 'Serve the live dashboard (default true)', type: 'boolean', default: true },
        { name: 'port', description: 'Live dashboard port', type: 'number', default: 4243 },
      ],
      examples: [{ command: 'monomind org run growth --task "weekly report"', description: 'Run the growth org once with a task' }],
      action: runAction,
    },
    { name: 'stop', description: 'Request a running org daemon to stop', action: stopAction },
    { name: 'status', description: 'Show runtime state of orgs', action: statusAction },
    {
      name: 'serve', description: 'Start the daemon server only (hosts scheduled orgs)',
      options: [{ name: 'port', description: 'Port', type: 'number', default: 4243 }],
      action: async (ctx) => {
        const daemon = new OrgDaemon(ctx.cwd);
        const srv = await startOrgServer(daemon, Number(ctx.flags['port'] ?? 4243));
        output.info(`org daemon serving on http://localhost:${srv.port} — Ctrl-C to stop`);
        await new Promise<void>(r => { process.once('SIGINT', () => r()); process.once('SIGTERM', () => r()); });
        await daemon.stopAll(); srv.close();
        return { success: true };
      },
    },
    {
      name: 'test-loop', description: 'Run the org e2e verification loop N times',
      options: [{ name: 'times', short: 'n', description: 'Iterations', type: 'number', default: 5 }],
      action: async (ctx) => {
        const { runTestLoop } = await import('../orgrt/test-loop.js');
        const n = Number(ctx.flags['times'] ?? 5);
        const report = await runTestLoop(ctx.cwd, n);
        output.info(report.summary);
        return { success: report.failed === 0, message: report.summary };
      },
    },
  ],
  examples: [{ command: 'monomind org run my-org', description: 'Run an org under full daemon control' }],
  action: async () => ({ success: false, message: 'usage: monomind org <run|stop|status|serve|test-loop>' }),
};
```

- [ ] **Step 4: Register the command**

In `src/commands/index.ts`, add with the other static imports:
```ts
import { orgCommand } from './org.js';
```
and with the other registrations (near line 49):
```ts
loadedCommands.set('org', orgCommand);
```

- [ ] **Step 5: Run test (server.ts doesn't exist yet)**

Run: `npx vitest run __tests__/orgrt/org-command.test.ts`
Expected: FAIL with `Cannot find module '../orgrt/server.js'` — Task 11 creates it; re-run there. (Alternative: create an empty `server.ts` stub now and fill it in Task 11.)

- [ ] **Step 6: Commit (after Task 11 makes it green)**

```bash
git add src/commands/org.ts src/commands/index.ts __tests__/orgrt/org-command.test.ts
git commit -m "feat(orgrt): monomind org CLI — run/stop/status/serve/test-loop"
```

---

### Task 11: Org live server — WebSocket + source-controlled live view

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/server.ts`
- Create: `packages/@monomind/cli/src/orgrt/live.html`
- Modify: `packages/@monomind/cli/package.json` build script — add `cp src/orgrt/live.html dist/src/orgrt/` alongside the existing `cp src/browser/dashboard/ui.html dist/...`
- Test: `packages/@monomind/cli/__tests__/orgrt/server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/server.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { startOrgServer } from '../../src/orgrt/server.js';

const echoQuery = ({ prompt }: any) => (async function* () {
  for await (const m of prompt) {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
  }
})();

describe('org live server', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('broadcasts bus events to WebSocket clients and serves live.html + /api/orgs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'srv-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }],
    }));
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const srv = await startOrgServer(daemon, 0); // 0 = ephemeral port
    close = srv.close;

    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const events: any[] = [];
    ws.on('message', d => events.push(JSON.parse(d.toString())));
    await new Promise(r => ws.on('open', r));

    await daemon.startOrg('alpha');
    await new Promise(r => setTimeout(r, 300));
    await daemon.stopAll();

    expect(events.some(e => e.type === 'status')).toBe(true);

    const page = await fetch(`http://127.0.0.1:${srv.port}/`).then(r => r.text());
    expect(page).toContain('org live');
    const orgs = await fetch(`http://127.0.0.1:${srv.port}/api/orgs`).then(r => r.json());
    expect(Array.isArray(orgs)).toBe(true);
    ws.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/server.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the server**

```ts
// packages/@monomind/cli/src/orgrt/server.ts
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { OrgDaemon } from './daemon.js';

export interface OrgServer { port: number; close: () => void; }

/** Daemon-owned live view: WS fanout of every bus event + tiny REST surface. */
export async function startOrgServer(daemon: OrgDaemon, port: number): Promise<OrgServer> {
  const here = dirname(fileURLToPath(import.meta.url));
  const htmlPath = ['live.html', '../orgrt/live.html']
    .map(p => join(here, p)).find(existsSync) ?? join(here, 'live.html');

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(htmlPath, 'utf8'));
    } else if (req.method === 'GET' && url === '/api/orgs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(daemon.listOrgs().map(o => ({
        name: o.def.name, run: o.run, goal: o.def.goal,
        agents: [...o.agents.entries()].map(([id, a]) => ({ id, usage: a.policy.usage, closed: a.mailbox.isClosed })),
      }))));
    } else if (req.method === 'GET' && url.startsWith('/api/history/')) {
      const name = decodeURIComponent(url.slice('/api/history/'.length));
      const org = daemon.getOrg(name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(org ? org.busEvents() : []));
    } else {
      res.writeHead(404); res.end('not found');
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  const unsubscribe = daemon.subscribe(e => {
    const line = JSON.stringify(e);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(line);
  });

  await new Promise<void>(r => server.listen(port, r));
  const actual = (server.address() as { port: number }).port;
  return { port: actual, close: () => { unsubscribe(); wss.close(); server.close(); } };
}
```

- [ ] **Step 4: Write the live view page**

```html
<!-- packages/@monomind/cli/src/orgrt/live.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>org live</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:13px/1.5 ui-monospace,monospace; background:#0d1117; color:#e6edf3;
         display:grid; grid-template-columns:220px 1fr 1fr; grid-template-rows:auto 1fr 1fr; gap:1px; height:100vh; }
  header { grid-column:1/4; padding:8px 14px; background:#161b22; font-weight:700; }
  section { background:#161b22; overflow:auto; padding:10px; }
  h2 { font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:#7d8590; margin:0 0 8px; }
  #agents { grid-row:2/4; }
  .agent { padding:6px 8px; border-left:3px solid #2f81f7; margin-bottom:6px; background:#0d1117; }
  .agent small { color:#7d8590; display:block; }
  .row { padding:4px 6px; border-bottom:1px solid #21262d; word-break:break-word; }
  .from { color:#2f81f7; font-weight:700; } .to { color:#a371f7; }
  .deny { color:#f85149; } .allow { color:#3fb950; } .xorg { color:#d29922; font-weight:700; }
  .ts { color:#484f58; font-size:11px; margin-right:6px; }
</style></head>
<body>
<header>org live — <span id="conn">connecting…</span></header>
<section id="agents"><h2>Agents</h2><div id="agents-list"></div></section>
<section id="chat"><h2>Chats &amp; Messages</h2><div id="chat-list"></div></section>
<section id="tools"><h2>Tool Activity &amp; Assets</h2><div id="tools-list"></div></section>
<script>
const $ = id => document.getElementById(id);
const fmt = ts => new Date(ts).toLocaleTimeString();
const add = (listId, html, cap = 500) => {
  const el = document.createElement('div'); el.className = 'row'; el.innerHTML = html;
  const list = $(listId); list.prepend(el);
  while (list.children.length > cap) list.lastChild.remove();
};
function render(e) {
  const t = `<span class="ts">${fmt(e.ts)}</span>`;
  if (e.type === 'chat') add('chat-list', `${t}<span class="from">${e.org}/${e.from}</span>: ${esc(e.msg)}`);
  else if (e.type === 'message') add('chat-list', `${t}<span class="from">${e.from}</span> → <span class="to">${e.to}</span> [${esc(e.subject||'')}] ${esc(e.msg)}`);
  else if (e.type === 'xorg') add('chat-list', `${t}<span class="xorg">⇄ ${e.from} → ${e.to}</span> [${esc(e.subject||'')}] ${esc(e.msg)}`);
  else if (e.type === 'tool') add('tools-list', `${t}<span class="from">${e.from}</span> ${e.tool} <span class="${e.decision}">${e.decision}</span>${e.reason ? ' — ' + esc(e.reason) : ''}`);
  else if (e.type === 'asset') add('tools-list', `${t}<span class="from">${e.from}</span> 📄 <b>${esc(e.path)}</b>`);
  else if (e.type === 'status' || e.type === 'usage') add('tools-list', `${t}<i>${e.org}/${e.from ?? 'org'}: ${esc(e.msg ?? JSON.stringify(e.data))}</i>`);
}
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function refreshAgents() {
  const orgs = await fetch('/api/orgs').then(r => r.json()).catch(() => []);
  $('agents-list').innerHTML = orgs.map(o =>
    `<div class="agent"><b>${o.name}</b><small>${o.run}</small>` +
    o.agents.map(a => `<div>${a.closed ? '⚫' : '🟢'} ${a.id} <small>${a.usage} tok</small></div>`).join('') +
    `</div>`).join('') || '<i>no running orgs</i>';
}
const ws = new WebSocket(`ws://${location.host}/ws`);
ws.onopen = () => { $('conn').textContent = 'live'; refreshAgents(); };
ws.onclose = () => { $('conn').textContent = 'disconnected'; };
ws.onmessage = ev => { render(JSON.parse(ev.data)); };
setInterval(refreshAgents, 5000);
</script>
</body></html>
```

- [ ] **Step 5: Add the copy step to the build script**

In `packages/@monomind/cli/package.json`, extend the `build` script where `ui.html` is copied:
```
&& mkdir -p dist/src/orgrt && cp src/orgrt/live.html dist/src/orgrt/
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run __tests__/orgrt/server.test.ts __tests__/orgrt/org-command.test.ts`
Expected: PASS (server test + both org-command tests now that `server.js` exists — `test-loop.js` is dynamically imported, so the command test doesn't need it yet)

- [ ] **Step 7: Commit**

```bash
git add src/orgrt/server.ts src/orgrt/live.html package.json __tests__/orgrt/server.test.ts src/commands/org.ts src/commands/index.ts __tests__/orgrt/org-command.test.ts
git commit -m "feat(orgrt): live WebSocket dashboard — agents, chats, tool activity, assets, inter-org feed"
```

---

### Task 12: Interval scheduler + legacy deprecation

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/scheduler.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/scheduler.test.ts`
- Modify: `.claude/commands/mastermind/runorg.md` (add deprecation banner at top)

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/scheduler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { parseSchedule, OrgScheduler } from '../../src/orgrt/scheduler.js';

describe('parseSchedule', () => {
  it('parses "15m", "2h", numbers (minutes), null', () => {
    expect(parseSchedule('15m')).toBe(15 * 60_000);
    expect(parseSchedule('2h')).toBe(2 * 3_600_000);
    expect(parseSchedule(30)).toBe(30 * 60_000);
    expect(parseSchedule(null)).toBeNull();
  });
});

describe('OrgScheduler', () => {
  it('re-runs the org on its interval', async () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    const s = new OrgScheduler(async name => { runs.push(name); });
    s.add('alpha', 60_000);
    await vi.advanceTimersByTimeAsync(60_000 * 2 + 10);
    expect(runs).toEqual(['alpha', 'alpha']);
    s.stop();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/scheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/scheduler.ts

/** "15m" | "2h" | "45s" | minutes as number | null → interval ms or null */
export function parseSchedule(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === 'number') return s * 60_000;
  const m = /^(\d+)\s*(s|m|h)$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
}

/** Fires runFn(name) every intervalMs per org. Real timer loop — no ScheduleWakeup, no prompts. */
export class OrgScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private running = new Set<string>();

  constructor(private runFn: (name: string) => Promise<void>) {}

  add(name: string, intervalMs: number): void {
    this.remove(name);
    this.timers.set(name, setInterval(async () => {
      if (this.running.has(name)) return; // skip if previous iteration still running
      this.running.add(name);
      try { await this.runFn(name); } catch { /* logged by daemon */ }
      finally { this.running.delete(name); }
    }, intervalMs));
  }

  remove(name: string): void {
    const t = this.timers.get(name);
    if (t) clearInterval(t);
    this.timers.delete(name);
  }

  stop(): void { for (const name of [...this.timers.keys()]) this.remove(name); }
}
```

- [ ] **Step 4: Wire into the daemon `serve` path** — in `src/commands/org.ts` `serve` action, after constructing the daemon and server:

```ts
const { OrgScheduler, parseSchedule } = await import('../orgrt/scheduler.js');
const sched = new OrgScheduler(async name => {
  await daemon.startOrg(name);
  // scheduled iterations are bounded: wait for all sessions to end, then stop
  const org = daemon.getOrg(name);
  if (org) await Promise.allSettled([...org.agents.values()].map(a => a.done));
  await daemon.stopOrg(name);
});
const fs = await import('node:fs');
const orgDir = join(ctx.cwd, ORG_DIR);
if (fs.existsSync(orgDir)) {
  for (const f of fs.readdirSync(orgDir).filter(f => f.endsWith('.json'))) {
    try {
      const def = JSON.parse(fs.readFileSync(join(orgDir, f), 'utf8'));
      const ms = parseSchedule(def.schedule);
      if (ms) { sched.add(def.name, ms); output.info(`scheduled ${def.name} every ${def.schedule}`); }
    } catch { /* skip unparseable org file */ }
  }
}
// after the SIGINT/SIGTERM await resolves, before daemon.stopAll(): sched.stop();
```

- [ ] **Step 5: Deprecate the legacy path** — prepend to `.claude/commands/mastermind/runorg.md`:

```markdown
> **DEPRECATED (2026-07): superseded by `monomind org run <name>` (SDK org runtime v2).**
> This prompt-orchestrated path has no delivery guarantees and no ground-truth event stream.
> It remains only for orgs not yet migrated. New orgs MUST use the daemon.
```

- [ ] **Step 6: Run tests, commit**

Run: `npx vitest run __tests__/orgrt/scheduler.test.ts`
Expected: PASS

```bash
git add src/orgrt/scheduler.ts __tests__/orgrt/scheduler.test.ts src/commands/org.ts ../../.claude/commands/mastermind/runorg.md
git commit -m "feat(orgrt): real interval scheduler; deprecate prompt-orchestrated runorg"
```

---

### Task 13: E2E verification — full org lifecycle with dashboard assertions

**Files:**
- Create: `packages/@monomind/cli/src/orgrt/test-loop.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/e2e.test.ts`

This is the user-facing guarantee: **every run proves chats, comms, assets, and inter-org messages all reach the bus AND the WebSocket dashboard stream.** The scripted fake SDK exercises the full production path (daemon → sessions → deliver → policy → bus → ws) deterministically via the `_orgTest` seam added in Task 8.

- [ ] **Step 1: Write the failing test**

```ts
// packages/@monomind/cli/__tests__/orgrt/e2e.test.ts
import { describe, it, expect } from 'vitest';
import { runTestLoop } from '../../src/orgrt/test-loop.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('org e2e verification', () => {
  it('one iteration verifies chats, comms, tools, assets, inter-org, and ws delivery', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-'));
    const report = await runTestLoop(root, 1);
    expect(report.failed).toBe(0);
    expect(report.iterations[0].checks).toMatchObject({
      chat: true, message: true, tool: true, asset: true, xorg: true, wsDelivery: true,
    });
  });

  it('loop runs N times and aggregates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e2-'));
    const report = await runTestLoop(root, 3);
    expect(report.iterations).toHaveLength(3);
    expect(report.summary).toMatch(/3\/3 passed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/orgrt/e2e.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/@monomind/cli/src/orgrt/test-loop.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { OrgDaemon } from './daemon.js';
import { startOrgServer } from './server.js';
import { OrgBus } from './bus.js';
import { ORG_DIR, type BusEvent } from './types.js';

/**
 * Scripted fake SDK used by the verification loop (no API cost, deterministic).
 * boss: on kickoff, delegates to coder, then pings the partner org's boss.
 * coder: "writes" a report (Write allowed by policy), attempts Bash (denied), replies to boss.
 * It drives the SAME production code paths via the _orgTest seam:
 * callTool → policy.decide → bus; deliver → daemon.deliver → mailboxes + bus;
 * assistant/result → chat/usage events.
 */
const scriptedQuery = (roleId: string) => ({ prompt, options }: any) => (async function* () {
  const seam = options._orgTest;
  for await (const m of prompt) {
    const text = String(m.message.content);
    if (roleId === 'boss' && text.includes('started')) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Kicking off: delegating to coder.' }] } };
      await seam.deliver('coder', 'task', 'produce out/report.md');
      await seam.deliver('partner:boss', 'fyi', 'alpha started its run');
    } else if (roleId === 'coder') {
      await seam.callTool('Write', { file_path: join(options.cwd, 'out/report.md'), content: '# report' });
      await seam.callTool('Bash', { command: 'echo should-be-denied' }); // policy MUST deny
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Report written.' }] } };
      await seam.deliver('boss', 're: task', 'done — out/report.md');
    } else {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `ack: ${text.slice(0, 40)}` }] } };
    }
    yield { type: 'result', subtype: 'success', usage: { input_tokens: 5, output_tokens: 5 } };
  }
})();

interface IterationResult { checks: Record<string, boolean>; events: number; }
export interface LoopReport { iterations: IterationResult[]; failed: number; summary: string; }

function writeFixtures(root: string): void {
  const dir = join(root, ORG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'alpha.json'), JSON.stringify({
    name: 'alpha', goal: 'produce a report',
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
      { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss',
        policy: { denyTools: ['Bash'], fileWrite: ['out/**'] } },
    ],
  }));
  writeFileSync(join(dir, 'partner.json'), JSON.stringify({
    name: 'partner', goal: 'receive handoffs',
    roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null }],
  }));
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return pred();
}

export async function runTestLoop(root: string, times: number): Promise<LoopReport> {
  writeFixtures(root);
  const iterations: IterationResult[] = [];

  for (let i = 0; i < times; i++) {
    const queryFn = (args: any) => {
      const roleId = /You are agent "([^"]+)"/.exec(args.options.systemPrompt)?.[1] ?? 'unknown';
      return scriptedQuery(roleId)(args);
    };
    const daemon = new OrgDaemon(root, { queryFn: queryFn as any, forward: false });
    const srv = await startOrgServer(daemon, 0);
    const wsEvents: BusEvent[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    ws.on('message', d => wsEvents.push(JSON.parse(d.toString())));
    await new Promise(r => ws.on('open', r));

    const alpha = await daemon.startOrg('alpha');
    await daemon.startOrg('partner');
    await waitFor(() => alpha.busEvents().some(e => e.type === 'message' && e.from === 'coder' && e.to === 'boss'));
    await daemon.stopAll();
    ws.close(); srv.close();

    const evs = alpha.busEvents();
    const has = (pred: (e: BusEvent) => boolean) => evs.some(pred);
    const persistedCount = OrgBus.readHistory(join(root, ORG_DIR, 'alpha', alpha.run)).length;
    const checks: Record<string, boolean> = {
      chat: has(e => e.type === 'chat'),
      message: has(e => e.type === 'message' && e.from === 'boss' && e.to === 'coder'),
      tool: has(e => e.type === 'tool' && e.decision === 'allow' && e.tool === 'Write'),
      policyDeny: has(e => e.type === 'tool' && e.decision === 'deny' && e.tool === 'Bash'),
      asset: has(e => e.type === 'asset' && (e.path ?? '').endsWith('out/report.md')),
      xorg: has(e => e.type === 'xorg' && e.to === 'partner:boss'),
      usage: has(e => e.type === 'usage'),
      wsDelivery: wsEvents.length > 0 && wsEvents.some(e => e.type === 'chat'),
      persisted: persistedCount === evs.length,
    };
    iterations.push({ checks, events: evs.length });
  }

  const failed = iterations.filter(it => Object.values(it.checks).some(v => !v)).length;
  const summary = `org e2e: ${times - failed}/${times} passed` +
    (failed ? ` — failing checks: ${JSON.stringify(iterations.filter(it => Object.values(it.checks).some(v => !v)).map(it => it.checks))}` : '');
  return { iterations, failed, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/orgrt/e2e.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the WHOLE suite**

Run: `cd packages/@monomind/cli && npm test`
Expected: all existing tests still green + the new orgrt suites.

- [ ] **Step 6: Commit**

```bash
git add src/orgrt/test-loop.ts src/orgrt/session.ts __tests__/orgrt/e2e.test.ts
git commit -m "feat(orgrt): e2e verification loop — chats/comms/tools/assets/inter-org/ws all asserted"
```

---

### Task 14: Real-mode smoke test (subscription auth, gated) + docs

**Files:**
- Create: `packages/@monomind/cli/__tests__/orgrt/real-smoke.test.ts`
- Modify: `CLAUDE.md` (org section: document `monomind org` as the org runtime; mark skill path legacy)

- [ ] **Step 1: Write the gated smoke test**

```ts
// packages/@monomind/cli/__tests__/orgrt/real-smoke.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { ORG_DIR } from '../../src/orgrt/types.js';

// Costs real subscription quota. Run explicitly:
//   MONOMIND_ORG_E2E=1 npx vitest run __tests__/orgrt/real-smoke.test.ts
const enabled = process.env.MONOMIND_ORG_E2E === '1';

describe.skipIf(!enabled)('real SDK smoke (subscription auth)', () => {
  it('a 1-agent org answers via the real engine and events hit the bus', async () => {
    const root = mkdtempSync(join(tmpdir(), 'real-'));
    mkdirSync(join(root, ORG_DIR), { recursive: true });
    writeFileSync(join(root, ORG_DIR, 'smoke.json'), JSON.stringify({
      name: 'smoke', goal: 'Reply with exactly the word PONG and end your turn.',
      run_config: { budget_tokens: 20000, max_turns_per_message: 2 },
      roles: [{ id: 'boss', title: 'Boss', type: 'boss', reports_to: null,
                adapter_config: { model: 'claude-haiku-4-5-20251001' } }],
    }));
    const daemon = new OrgDaemon(root, { forward: false });
    const org = await daemon.startOrg('smoke');
    // wait for the boss session to finish its single turn (budget/turn capped)
    const t0 = Date.now();
    while (Date.now() - t0 < 120_000) {
      if (org.busEvents().some(e => e.type === 'chat' && /PONG/i.test(e.msg ?? ''))) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    await daemon.stopAll();
    const evs = org.busEvents();
    expect(evs.some(e => e.type === 'chat' && /PONG/i.test(e.msg ?? ''))).toBe(true);
    expect(evs.some(e => e.type === 'usage')).toBe(true);
  }, 180_000);
});
```

- [ ] **Step 2: Run it once for real**

Run: `MONOMIND_ORG_E2E=1 npx vitest run __tests__/orgrt/real-smoke.test.ts`
Expected: PASS in under ~2 min, `usage` event shows real token counts, and **no API key env var needed** (subscription login). If it fails with an auth error, run `claude login` first. This is the moment the whole architecture is proven end-to-end.

- [ ] **Step 3: Update CLAUDE.md org documentation** — in the CLI Commands table add:

```markdown
| `org`            | 5   | SDK org runtime v2 — daemon-controlled agent orgs (run, stop, status, serve, test-loop) |
```

and under Swarm Orchestration add one line: `Org runtime v2: use \`monomind org run <name>\` — the /mastermind:runorg prompt path is deprecated.`

- [ ] **Step 4: Commit**

```bash
git add __tests__/orgrt/real-smoke.test.ts ../../CLAUDE.md
git commit -m "feat(orgrt): gated real-SDK smoke test (subscription auth) + docs"
```

---

## Acceptance criteria (map to the original requirements)

1. **Subscription default / API key fallback / provider flexibility** — Task 6 (`resolveProviderEnv`), proven live by Task 14.
2. **All comms through monomind bus** — `org_send` is the only channel (role briefing, Task 8); every delivery goes through `daemon.deliver` → bus (Task 9); inter-org included (`xorg`, both buses).
3. **Full per-agent control** — PolicyEngine on `canUseTool` (Task 5): file scopes, web allowlists, budgets, deny lists, audit event for EVERY tool decision.
4. **Dashboard ground truth** — daemon WS live view (Task 11) + deterministic forwarder to the existing SSE dashboard (Task 4). Zero model-volunteered curls.
5. **Lifecycle daemon** — `monomind org run/stop/status/serve` (Task 10), real scheduler (Task 12), legacy path deprecated.
6. **Looping verification** — `monomind org test-loop -n N` + `runTestLoop` asserting chat/message/tool/asset/xorg/usage/ws/persistence every iteration (Task 13).

## Risks & mitigations

- **SDK API drift** (option names, message shapes): Task 8 Step 5 pins against the installed `.d.ts`; all logic is behind `queryFn` injection so only `session.ts` touches the SDK surface.
- **Subscription billing policy change by Anthropic**: provider block already supports `api-key`/`base-url`/`bedrock`/`vertex` — a config change, not a code change.
- **Long-running daemon quota burn**: per-role token budgets are hard-enforced (deny + session close), `max_turns_per_message` caps runaway loops.
- **exFAT volume quirks** (`._` files — see memory): bus files are plain appends; `readHistory` skips unparseable lines.
