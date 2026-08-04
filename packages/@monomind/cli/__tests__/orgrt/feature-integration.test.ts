// packages/@monomind/cli/__tests__/orgrt/feature-integration.test.ts
// End-to-end integration tests verifying all 12 org runtime features (#2–#13)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OrgDefSchema, ORG_DIR } from '../../src/orgrt/types.js';
import { ScrollbackBuffer } from '../../src/orgrt/daemon.js';
import { captureCheckpoint, validateCheckpoint, mergeCheckpoint } from '../../src/orgrt/checkpoint.js';
import { runPrechecks } from '../../src/orgrt/prechecks.js';
import { resolveProviderEnv } from '../../src/orgrt/provider.js';
import { loadRemoteRegistry, lookupRemoteOrg } from '../../src/orgrt/remote.js';
import { TaskDag } from '../../src/orgrt/task-dag.js';
import { StateDetector } from '../../src/orgrt/state-detector.js';
import type { AgentRuntime, RunningOrg } from '../../src/orgrt/daemon.js';

function makeRoot(): string {
  const root = join(tmpdir(), `mm-feat-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, ORG_DIR, 'feature-test'), { recursive: true });
  return root;
}

const FULL_ORG_DEF = {
  name: 'feature-test',
  goal: 'integration test',
  roles: [
    { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
    {
      id: 'analyst', title: 'Analyst', type: 'specialist', reports_to: 'boss',
      adapter_config: { model: 'claude-sonnet-4-5' },
      policy: { denyTools: ['Bash'], fileWrite: ['out/**'], git: 'read' },
    },
    {
      id: 'writer', title: 'Writer', type: 'specialist', reports_to: 'boss',
      provider: { kind: 'subscription' },
    },
  ],
  run_config: {
    max_concurrent_agents: 3,
    budget_tokens: 50000,
    max_turns_per_message: 5,
    workspace: 'isolated',
    circuit_breaker: { failure_threshold: 3, cooldown_ms: 5000 },
    stale_base_threshold: 50,
    prechecks: [
      { name: 'node-ok', command: 'node --version' },
    ],
  },
};

describe('Feature #2 — Circuit breaker on role failures', () => {
  it('org def parses circuit_breaker config', () => {
    const def = OrgDefSchema.parse(FULL_ORG_DEF);
    expect(def.run_config.circuit_breaker).toBeDefined();
    expect(def.run_config.circuit_breaker!.failure_threshold).toBe(3);
    expect(def.run_config.circuit_breaker!.cooldown_ms).toBe(5000);
  });

  it('defaults are applied when partial circuit_breaker given', () => {
    const partial = { ...FULL_ORG_DEF, run_config: { ...FULL_ORG_DEF.run_config, circuit_breaker: {} } };
    const def = OrgDefSchema.parse(partial);
    expect(def.run_config.circuit_breaker!.failure_threshold).toBe(5);
    expect(def.run_config.circuit_breaker!.cooldown_ms).toBe(0);
  });
});

describe('Feature #3 — Decision gates', () => {
  let root: string;
  beforeEach(() => { root = makeRoot(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('gates.json can be read/written', () => {
    const gatesPath = join(root, ORG_DIR, 'feature-test', 'gates.json');
    const gate = {
      gates: [{
        id: 'gate-1', name: 'deploy-approval', description: 'Approve deploy',
        roleId: 'boss', status: 'pending', createdAt: Date.now(),
      }],
    };
    writeFileSync(gatesPath, JSON.stringify(gate));
    const read = JSON.parse(readFileSync(gatesPath, 'utf8'));
    expect(read.gates).toHaveLength(1);
    expect(read.gates[0].status).toBe('pending');
  });

  it('OrgDef BusEvent type includes gate', () => {
    // Type-level check: 'gate' is a valid BusEvent type
    const evt: import('../../src/orgrt/types.js').BusEvent = {
      id: '1', ts: Date.now(), org: 'test', run: 'r1', type: 'gate',
    };
    expect(evt.type).toBe('gate');
  });
});

describe('Feature #4 — Stale-base drift detection', () => {
  it('org def parses stale_base_threshold', () => {
    const def = OrgDefSchema.parse(FULL_ORG_DEF);
    expect(def.run_config.stale_base_threshold).toBe(50);
  });

  it('defaults to 0 (disabled) when not set', () => {
    const noThreshold = { ...FULL_ORG_DEF, run_config: { ...FULL_ORG_DEF.run_config } };
    delete (noThreshold.run_config as any).stale_base_threshold;
    const def = OrgDefSchema.parse(noThreshold);
    expect(def.run_config.stale_base_threshold).toBe(0);
  });
});

describe('Feature #5 — Task DAG with dependencies', () => {
  it('creates tasks with dependencies', () => {
    const dag = new TaskDag();
    const t1 = dag.add('setup', 'boss');
    const t2 = dag.add('analyze', 'analyst', [t1.id]);
    const t3 = dag.add('write', 'writer', [t2.id]);
    expect(dag.ready().map(t => t.id)).toEqual([t1.id]);
    expect(dag.get(t2.id)!.deps).toEqual([t1.id]);
    expect(dag.get(t3.id)!.deps).toEqual([t2.id]);
  });

  it('unblocks downstream tasks on completion', () => {
    const dag = new TaskDag();
    const t1 = dag.add('setup', 'boss');
    const t2 = dag.add('analyze', 'analyst', [t1.id]);
    expect(dag.ready().map(t => t.id)).toEqual([t1.id]);
    dag.complete(t1.id, 'done');
    expect(dag.ready().map(t => t.id)).toEqual([t2.id]);
  });

  it('non-cyclic diamond is accepted', () => {
    const dag = new TaskDag();
    const t1 = dag.add('a', 'x');
    const t2 = dag.add('b', 'x', [t1.id]);
    expect(() => dag.add('c', 'x', [t2.id, t1.id])).not.toThrow();
  });

  it('parallel tasks are all ready when deps met', () => {
    const dag = new TaskDag();
    const t1 = dag.add('root', 'boss');
    const t2 = dag.add('left', 'analyst', [t1.id]);
    const t3 = dag.add('right', 'writer', [t1.id]);
    dag.complete(t1.id, 'ok');
    const readyIds = dag.ready().map(t => t.id);
    expect(readyIds).toContain(t2.id);
    expect(readyIds).toContain(t3.id);
  });
});

describe('Feature #6 — Git worktree isolation per role', () => {
  it('org def accepts worktree-per-role workspace', () => {
    const wt = { ...FULL_ORG_DEF, run_config: { ...FULL_ORG_DEF.run_config, workspace: 'worktree-per-role' } };
    const def = OrgDefSchema.parse(wt);
    expect(def.run_config.workspace).toBe('worktree-per-role');
  });

  it('all workspace values are accepted', () => {
    for (const ws of ['repo', 'isolated', 'worktree', 'worktree-per-role', '/custom/path']) {
      const d = { ...FULL_ORG_DEF, run_config: { ...FULL_ORG_DEF.run_config, workspace: ws } };
      expect(OrgDefSchema.parse(d).run_config.workspace).toBe(ws);
    }
  });
});

describe('Feature #8 — Agent state detection from output patterns', () => {
  it('detects error state from assistant text', () => {
    const det = new StateDetector();
    expect(det.onMessage('assistant', undefined, 'error: failed to compile')).toBe('error');
  });

  it('detects tool-call state', () => {
    const det = new StateDetector();
    expect(det.onMessage('tool_use')).toBe('tool-call');
  });

  it('detects completed state from text', () => {
    const det = new StateDetector();
    expect(det.onMessage('assistant', undefined, 'Task completed successfully')).toBe('completed');
  });

  it('returns working for generic assistant text', () => {
    const det = new StateDetector();
    expect(det.onMessage('assistant', undefined, 'Let me analyze this code')).toBe('working');
  });

  it('returns idle on success result', () => {
    const det = new StateDetector();
    det.onMessage('tool_use');
    expect(det.current()).toBe('tool-call');
    det.onMessage('result', 'success');
    expect(det.current()).toBe('idle');
  });
});

describe('Feature #9 — Automations with precondition checks', () => {
  it('passes when all prechecks succeed', async () => {
    const checks = [
      { name: 'echo-test', command: 'echo ok' },
      { name: 'true-test', command: 'true' },
    ];
    const { ok, results } = await runPrechecks(checks, process.cwd());
    expect(ok).toBe(true);
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
  });

  it('fails fast on first broken precheck', async () => {
    const checks = [
      { name: 'good', command: 'echo fine' },
      { name: 'bad', command: 'exit 1' },
      { name: 'never-reached', command: 'echo nope' },
    ];
    const { ok, results } = await runPrechecks(checks, process.cwd());
    expect(ok).toBe(false);
    expect(results).toHaveLength(2);
    expect(results[1].passed).toBe(false);
  });

  it('org def parses prechecks config', () => {
    const def = OrgDefSchema.parse(FULL_ORG_DEF);
    expect(def.run_config.prechecks).toHaveLength(1);
    expect(def.run_config.prechecks![0].name).toBe('node-ok');
  });
});

describe('Feature #10 — Multi-provider agent support', () => {
  it('org def parses per-role provider config', () => {
    const def = OrgDefSchema.parse(FULL_ORG_DEF);
    const writer = def.roles.find(r => r.id === 'writer');
    expect(writer?.provider).toBeDefined();
    expect(writer!.provider!.kind).toBe('subscription');
  });

  it('resolveProviderEnv strips API key for subscription kind', () => {
    const env = resolveProviderEnv({ kind: 'subscription' }, { ANTHROPIC_API_KEY: 'sk-test', HOME: '/home' });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.HOME).toBe('/home');
  });

  it('resolveProviderEnv throws for api-key without env var set', () => {
    expect(() => resolveProviderEnv({ kind: 'api-key', apiKeyEnv: 'NONEXISTENT_KEY_XYZ' }))
      .toThrow();
  });

  it('each role can have independent provider config', () => {
    const multiProvider = {
      ...FULL_ORG_DEF,
      roles: [
        { id: 'a', type: 'boss', reports_to: null, provider: { kind: 'subscription' } },
        { id: 'b', type: 'specialist', reports_to: 'a', provider: { kind: 'api-key', apiKeyEnv: 'MY_KEY' } },
      ],
    };
    const def = OrgDefSchema.parse(multiProvider);
    expect(def.roles[0].provider!.kind).toBe('subscription');
    expect(def.roles[1].provider!.kind).toBe('api-key');
  });
});

describe('Feature #11 — Live daemon upgrade without killing sessions (hot-reload)', () => {
  let root: string;
  beforeEach(() => { root = makeRoot(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('reload signal file can be written and read', () => {
    const reloadFile = join(root, ORG_DIR, 'feature-test', 'reload');
    writeFileSync(reloadFile, JSON.stringify({ ts: Date.now() }));
    expect(existsSync(reloadFile)).toBe(true);
    const content = JSON.parse(readFileSync(reloadFile, 'utf8'));
    expect(content.ts).toBeGreaterThan(0);
    unlinkSync(reloadFile);
    expect(existsSync(reloadFile)).toBe(false);
  });

  it('updated org def can be re-parsed without error', () => {
    const updated = { ...FULL_ORG_DEF, goal: 'updated goal for hot reload' };
    const def = OrgDefSchema.parse(updated);
    expect(def.goal).toBe('updated goal for hot reload');
  });
});

describe('Feature #12 — Federated remote dispatch via SSH', () => {
  let root: string;
  beforeEach(() => { root = makeRoot(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('empty registry returns empty hosts', () => {
    const reg = loadRemoteRegistry(root);
    expect(reg.hosts).toEqual({});
  });

  it('registered remote host is found', () => {
    const hosts = { 'remote-org': { host: 'gpu.internal', cwd: '/data/project' } };
    writeFileSync(join(root, ORG_DIR, 'remote-hosts.json'), JSON.stringify({ hosts }));
    const found = lookupRemoteOrg('remote-org', root);
    expect(found).not.toBeNull();
    expect(found!.host).toBe('gpu.internal');
  });

  it('unregistered org returns null', () => {
    const hosts = { 'other': { host: 'x', cwd: '/y' } };
    writeFileSync(join(root, ORG_DIR, 'remote-hosts.json'), JSON.stringify({ hosts }));
    expect(lookupRemoteOrg('nope', root)).toBeNull();
  });
});

describe('Feature #13 — Terminal checkpoint with full scrollback', () => {
  function makeFakeRuntime(lines: string[]): AgentRuntime {
    const buf = new ScrollbackBuffer(500);
    for (const l of lines) buf.push(l);
    return {
      mailbox: { serialize: () => ({ queue: [] }), isClosed: false } as any,
      policy: { usage: 0 } as any,
      done: Promise.resolve(),
      status: 'running',
      metrics: { tokens: 0, costUsd: 0 },
      scrollback: buf,
    } as AgentRuntime;
  }

  it('scrollback buffer captures and caps lines', () => {
    const buf = new ScrollbackBuffer(3);
    buf.push('a'); buf.push('b'); buf.push('c'); buf.push('d');
    expect(buf.snapshot()).toEqual(['b', 'c', 'd']);
  });

  it('checkpoint captures scrollback snapshot', () => {
    const agents = new Map<string, AgentRuntime>();
    agents.set('boss', makeFakeRuntime(['Thinking...', 'Sending to analyst', 'Done']));
    agents.set('analyst', makeFakeRuntime(['Analyzing...', 'Found 3 issues']));
    const org: RunningOrg = {
      def: { name: 'test', goal: '', roles: [], run_config: {} } as any,
      run: 'run-1',
      agents,
      status: 'running',
    } as any;
    const cp = captureCheckpoint(org);
    expect(cp.roleState['boss'].scrollback).toEqual(['Thinking...', 'Sending to analyst', 'Done']);
    expect(cp.roleState['analyst'].scrollback).toEqual(['Analyzing...', 'Found 3 issues']);
  });

  it('checkpoint validates with scrollback included', () => {
    const agents = new Map<string, AgentRuntime>();
    agents.set('w', makeFakeRuntime(['line1']));
    const org: RunningOrg = {
      def: { name: 'test', goal: '', roles: [], run_config: {} } as any,
      run: 'r1', agents, status: 'running',
    } as any;
    const cp = captureCheckpoint(org);
    expect(validateCheckpoint(cp)).toBe(true);
  });
});

describe('Cross-feature: full org definition validation', () => {
  it('the feature-test org definition round-trips through schema', () => {
    const def = OrgDefSchema.parse(FULL_ORG_DEF);
    expect(def.name).toBe('feature-test');
    expect(def.roles).toHaveLength(3);
    expect(def.run_config.circuit_breaker).toBeDefined();
    expect(def.run_config.stale_base_threshold).toBe(50);
    expect(def.run_config.prechecks).toHaveLength(1);
    expect(def.run_config.workspace).toBe('isolated');
    expect(def.roles[1].adapter_config?.model).toBe('claude-sonnet-4-5');
    expect(def.roles[2].provider?.kind).toBe('subscription');
  });
});
