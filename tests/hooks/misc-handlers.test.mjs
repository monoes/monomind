/**
 * Tests for:
 *   .claude/helpers/handlers/agent-start-handler.cjs
 *   .claude/helpers/handlers/adr-draft-handler.cjs
 *   .claude/helpers/handlers/graph-status-handler.cjs
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── helpers ────────────────────────────────────────────────────────────────────

function loadHandler(name) {
  const p = path.resolve(__dirname, '../../.claude/helpers/handlers/' + name);
  delete require.cache[p];
  return require(p);
}

function capture(fn) {
  const lines = [];
  const origLog = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.log = origLog; }
  return lines;
}

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-test-'));
  fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── agent-start-handler ────────────────────────────────────────────────────────

describe('agent-start-handler', () => {
  function makeCtx(overrides = {}) {
    return {
      CWD: tmpDir,
      hookInput: {},
      _openMonographDb: () => null,
      getMonographSuggestions: () => [],
      ...overrides,
    };
  }

  it('logs [OK] Agent registered', () => {
    const lines = capture(() => loadHandler('agent-start-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('[OK] Agent registered'))).toBeTruthy();
  });

  it('creates a registration file under .monomind/agents/registrations/', () => {
    loadHandler('agent-start-handler.cjs').handle(makeCtx());
    const regDir = path.join(tmpDir, '.monomind', 'agents', 'registrations');
    const files = fs.readdirSync(regDir).filter(f => f.startsWith('agent-'));
    expect(files.length).toBe(1);
    const data = JSON.parse(fs.readFileSync(path.join(regDir, files[0]), 'utf-8'));
    expect(data.agentId).toBeTruthy();
    expect(data.pid).toBe(process.pid);
  });

  it('writes swarm-activity.json with agent count', () => {
    loadHandler('agent-start-handler.cjs').handle(makeCtx());
    const actPath = path.join(tmpDir, '.monomind', 'metrics', 'swarm-activity.json');
    const act = JSON.parse(fs.readFileSync(actPath, 'utf-8'));
    expect(act.swarm.agent_count).toBe(1);
    expect(act.swarm.active).toBe(true);
  });

  it('preserves lastActive peak from previous swarm-activity.json', () => {
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(
      path.join(metricsDir, 'swarm-activity.json'),
      JSON.stringify({ swarm: { lastActive: 7 } })
    );
    loadHandler('agent-start-handler.cjs').handle(makeCtx());
    const act = JSON.parse(fs.readFileSync(path.join(metricsDir, 'swarm-activity.json'), 'utf-8'));
    expect(act.swarm.lastActive).toBe(7); // peak preserved over current count of 1
  });

  it('writes last-dispatch.json with agentType from hookInput.subagent_type', () => {
    const ctx = makeCtx({ hookInput: { subagent_type: 'coder', description: 'implement feature' } });
    loadHandler('agent-start-handler.cjs').handle(ctx);
    const dispatch = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'last-dispatch.json'), 'utf-8'));
    expect(dispatch.agentType).toBe('coder');
    expect(dispatch.description).toBe('implement feature');
  });

  it('falls back to agentType field when subagent_type is absent', () => {
    const ctx = makeCtx({ hookInput: { agentType: 'tester' } });
    loadHandler('agent-start-handler.cjs').handle(ctx);
    const dispatch = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'last-dispatch.json'), 'utf-8'));
    expect(dispatch.agentType).toBe('tester');
  });

  it('writes agentType="unknown" when hookInput has no type fields', () => {
    loadHandler('agent-start-handler.cjs').handle(makeCtx());
    const dispatch = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'last-dispatch.json'), 'utf-8'));
    expect(dispatch.agentType).toBe('unknown');
  });

  it('skips graph section when _openMonographDb returns null', () => {
    const lines = capture(() => loadHandler('agent-start-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('[MONOGRAPH_SUBAGENT_CTX]'))).toBeUndefined();
  });

  it('logs [MONOGRAPH_SUBAGENT_CTX] when db returns god rows', () => {
    const mockDb = {
      prepare: () => ({
        all: () => [{ name: 'HookHandler', label: 'Class', file: 'hook-handler.cjs', deg: 42 }],
      }),
    };
    const ctx = makeCtx({ _openMonographDb: () => mockDb });
    const lines = capture(() => loadHandler('agent-start-handler.cjs').handle(ctx));
    expect(lines.find(l => l.includes('[MONOGRAPH_SUBAGENT_CTX]'))).toBeTruthy();
    expect(lines.find(l => l.includes('HookHandler'))).toBeTruthy();
  });

  it('shows top-files hint when description is long enough and suggestions exist', () => {
    const mockDb = {
      prepare: () => ({
        all: () => [{ name: 'Router', label: 'Module', file: 'router.cjs', deg: 5 }],
      }),
    };
    const ctx = makeCtx({
      hookInput: { description: 'implement the new routing feature' },
      _openMonographDb: () => mockDb,
      getMonographSuggestions: () => [{ name: 'router.cjs', label: 'Module', file: 'router.cjs' }],
    });
    const lines = capture(() => loadHandler('agent-start-handler.cjs').handle(ctx));
    expect(lines.find(l => l.includes('Top files for this subagent task'))).toBeTruthy();
  });

  it('skips top-files hint when description is too short (<= 8 chars)', () => {
    const mockDb = {
      prepare: () => ({
        all: () => [{ name: 'Router', label: 'Module', file: 'router.cjs', deg: 5 }],
      }),
    };
    const ctx = makeCtx({
      hookInput: { description: 'fix it' },
      _openMonographDb: () => mockDb,
      getMonographSuggestions: () => [{ name: 'router.cjs', label: 'Module', file: 'router.cjs' }],
    });
    const lines = capture(() => loadHandler('agent-start-handler.cjs').handle(ctx));
    expect(lines.find(l => l.includes('Top files for this subagent task'))).toBeUndefined();
  });
});

// ── adr-draft-handler ─────────────────────────────────────────────────────────

describe('adr-draft-handler', () => {
  function makeCtx(overrides = {}) {
    return { CWD: tmpDir, ...overrides };
  }

  it('logs [ADR] no decisions when decisions.jsonl is absent', () => {
    const lines = capture(() => loadHandler('adr-draft-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('[ADR]') && l.includes('No decisions'))).toBeTruthy();
  });

  it('logs [ADR] empty when decisions.jsonl has no lines', () => {
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'decisions.jsonl'), '');
    const lines = capture(() => loadHandler('adr-draft-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('[ADR]') && l.includes('empty'))).toBeTruthy();
  });

  it('logs [ADR] no recent decisions when all entries are older than 7 days', () => {
    const old = { ts: Date.now() - 8 * 24 * 60 * 60 * 1000, excerpts: ['we chose X'], prompt: 'test' };
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'decisions.jsonl'), JSON.stringify(old) + '\n');
    const lines = capture(() => loadHandler('adr-draft-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('[ADR]') && l.includes('No decisions in the last 7 days'))).toBeTruthy();
  });

  it('writes an ADR file to docs/adrs/ and logs [ADR_DRAFT]', () => {
    const entry = { ts: Date.now(), excerpts: ['we chose SQLite over Postgres'], prompt: 'decision: use sqlite' };
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'decisions.jsonl'), JSON.stringify(entry) + '\n');
    const lines = capture(() => loadHandler('adr-draft-handler.cjs').handle(makeCtx()));
    const draftLine = lines.find(l => l.includes('[ADR_DRAFT]'));
    expect(draftLine).toBeTruthy();
    expect(draftLine).toContain('1 decision');
    // File was created
    const adrsDir = path.join(tmpDir, 'docs', 'adrs');
    const files = fs.readdirSync(adrsDir).filter(f => f.startsWith('ADR-'));
    expect(files.length).toBe(1);
  });

  it('ADR file contains decision excerpts', () => {
    const entry = { ts: Date.now(), excerpts: ['we chose Redis for caching'], prompt: '' };
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'decisions.jsonl'), JSON.stringify(entry) + '\n');
    capture(() => loadHandler('adr-draft-handler.cjs').handle(makeCtx()));
    const adrsDir = path.join(tmpDir, 'docs', 'adrs');
    const file = fs.readdirSync(adrsDir)[0];
    const content = fs.readFileSync(path.join(adrsDir, file), 'utf-8');
    expect(content).toContain('we chose Redis for caching');
    expect(content).toContain('Status:** Proposed');
  });

  it('increments ADR number based on existing files in docs/adrs/', () => {
    const adrsDir = path.join(tmpDir, 'docs', 'adrs');
    fs.mkdirSync(adrsDir, { recursive: true });
    fs.writeFileSync(path.join(adrsDir, 'ADR-0001-2025-01-01-old.md'), '');
    fs.writeFileSync(path.join(adrsDir, 'ADR-0002-2025-01-02-old.md'), '');
    const entry = { ts: Date.now(), excerpts: ['we chose X'], prompt: '' };
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'decisions.jsonl'), JSON.stringify(entry) + '\n');
    capture(() => loadHandler('adr-draft-handler.cjs').handle(makeCtx()));
    const files = fs.readdirSync(adrsDir).filter(f => f.startsWith('ADR-'));
    const newFile = files.find(f => f.startsWith('ADR-0003'));
    expect(newFile).toBeTruthy();
  });

  it('handles multiple recent decisions and logs correct count', () => {
    const now = Date.now();
    const entries = [
      { ts: now - 1000, excerpts: ['we chose X'], prompt: 'p1' },
      { ts: now - 2000, excerpts: ['let\'s go with Y'], prompt: 'p2' },
      { ts: now - 3000, excerpts: ['decision: use Z'], prompt: 'p3' },
    ];
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'decisions.jsonl'),
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );
    const lines = capture(() => loadHandler('adr-draft-handler.cjs').handle(makeCtx()));
    const draftLine = lines.find(l => l.includes('[ADR_DRAFT]'));
    expect(draftLine).toContain('3 decision');
  });

  it('skips malformed JSONL lines without crashing', () => {
    const entry = { ts: Date.now(), excerpts: ['we chose X'], prompt: '' };
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'decisions.jsonl'),
      'not-json\n' + JSON.stringify(entry) + '\n'
    );
    const lines = capture(() => loadHandler('adr-draft-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('[ADR_DRAFT]'))).toBeTruthy();
  });
});

// ── graph-status-handler ───────────────────────────────────────────────────────

describe('graph-status-handler', () => {
  function makeCtx(overrides = {}) {
    return {
      CWD: tmpDir,
      _openMonographDb: () => null,
      ...overrides,
    };
  }

  it('logs "No monograph.db found" when _openMonographDb returns null', () => {
    const lines = capture(() => loadHandler('graph-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('No monograph.db found'))).toBeTruthy();
  });

  it('logs node and edge counts when db is present', () => {
    const mockDb = {
      prepare: (sql) => ({
        get: () => sql.includes('nodes') ? { c: 123 } : { c: 456 },
      }),
    };
    const lines = capture(() => loadHandler('graph-status-handler.cjs').handle(makeCtx({
      _openMonographDb: () => mockDb,
    })));
    const line = lines.find(l => l.includes('Monograph:'));
    expect(line).toBeTruthy();
    expect(line).toContain('123');
    expect(line).toContain('456');
  });

  it('shows 0% graph when graph-usage.json is absent', () => {
    const mockDb = {
      prepare: (sql) => ({
        get: () => sql.includes('nodes') ? { c: 10 } : { c: 20 },
      }),
    };
    const lines = capture(() => loadHandler('graph-status-handler.cjs').handle(makeCtx({
      _openMonographDb: () => mockDb,
    })));
    const usageLine = lines.find(l => l.includes('Usage:'));
    expect(usageLine).toBeTruthy();
    expect(usageLine).toContain('0% graph');
  });

  it('calculates graph usage percentage from graph-usage.json', () => {
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(path.join(metricsDir, 'graph-usage.json'), JSON.stringify({
      monograph_call: 8,
      grep_call: 2,
    }));
    const mockDb = {
      prepare: (sql) => ({
        get: () => sql.includes('nodes') ? { c: 10 } : { c: 20 },
      }),
    };
    const lines = capture(() => loadHandler('graph-status-handler.cjs').handle(makeCtx({
      _openMonographDb: () => mockDb,
    })));
    const usageLine = lines.find(l => l.includes('Usage:'));
    expect(usageLine).toContain('80% graph');
    expect(usageLine).toContain('20% grep');
  });

  it('shows saved dollars when dollars_saved > 0', () => {
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(path.join(metricsDir, 'graph-usage.json'), JSON.stringify({
      dollars_saved: 1.23,
    }));
    const mockDb = {
      prepare: (sql) => ({
        get: () => sql.includes('nodes') ? { c: 5 } : { c: 10 },
      }),
    };
    const lines = capture(() => loadHandler('graph-status-handler.cjs').handle(makeCtx({
      _openMonographDb: () => mockDb,
    })));
    const usageLine = lines.find(l => l.includes('saved $'));
    expect(usageLine).toBeTruthy();
    expect(usageLine).toContain('1.23');
  });

  it('does not show saved dollars when dollars_saved is 0 or absent', () => {
    const mockDb = {
      prepare: (sql) => ({
        get: () => sql.includes('nodes') ? { c: 5 } : { c: 10 },
      }),
    };
    const lines = capture(() => loadHandler('graph-status-handler.cjs').handle(makeCtx({
      _openMonographDb: () => mockDb,
    })));
    expect(lines.find(l => l.includes('saved $'))).toBeUndefined();
  });

  it('logs Error message when db.prepare throws', () => {
    const mockDb = {
      prepare: () => { throw new Error('db locked'); },
    };
    const lines = capture(() => loadHandler('graph-status-handler.cjs').handle(makeCtx({
      _openMonographDb: () => mockDb,
    })));
    expect(lines.find(l => l.includes('Error:') && l.includes('db locked'))).toBeTruthy();
  });
});
