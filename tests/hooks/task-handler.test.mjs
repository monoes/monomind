/**
 * Tests for .claude/helpers/handlers/task-handler.cjs
 * Builds a minimal mock hCtx and calls handlePreTask / handlePostTask directly.
 * Verifies: model tier recommendation, ADR generation, and the [OK] completion
 * messages.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TH_PATH = path.resolve(__dirname, '../../.claude/helpers/handlers/task-handler.cjs');

function loadTH() {
  delete require.cache[TH_PATH];
  return require(TH_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-test-'));
  fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeHCtx(overrides = {}) {
  return {
    hookInput: {},
    prompt: '',
    CWD: tmpDir,
    session: null,
    router: null,
    intelligence: null,
    _requireMonograph: () => null,
    _hooksModule: null,
    ...overrides,
  };
}

describe('task-handler.handlePreTask', () => {
  it('does not print AUTO_RETRY_ENABLED (removed)', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({
      hookInput: { swarmCoordinator: true },
      prompt: 'do task',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).not.toContain('[AUTO_RETRY_ENABLED]');
  });

  it('does not print [OK] Task started (removed)', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'do something', router: null });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).not.toContain('[OK] Task started');
  });

  it('does not route task or log result (routing removed from pre-task)', async () => {
    const th = loadTH();
    const mockRoute = vi.fn().mockResolvedValue({ agent: 'coder', confidence: 0.88 });
    const hCtx = makeHCtx({
      prompt: 'implement new feature',
      router: { routeTask: mockRoute },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    expect(mockRoute).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).not.toContain('Task routed');
  });
});

// ── handlePostTask — completion message ────────────────────────────────────────

describe('task-handler.handlePostTask completion', () => {
  it('prints [OK] Task completed', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'done' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[OK] Task completed');
  });
});

// ── handlePostTask — agent registration cleanup ────────────────────────────────

describe('task-handler.handlePostTask agent registration', () => {
  it('removes oldest registration file matching the completing agent type when no exact type match exists', async () => {
    const th = loadTH();
    const regDir = path.join(tmpDir, '.monomind', 'agents', 'registrations');
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(path.join(regDir, 'agent-001.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(regDir, 'agent-002.json'), '{}', 'utf-8');

    // P3-15: post-task only touches registrations when the event carries an
    // agent-identifying field (subagent_type/agentSlug/etc) — a real
    // subagent completion always carries one (mirrors what agent-start-handler
    // stamps into the registration). These legacy '{}' registrations have no
    // stored agentType, so no exact match is possible — falls back to oldest.
    const hCtx = makeHCtx({ prompt: 'task done', hookInput: { agentSlug: 'coder' } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);

    const remaining = fs.readdirSync(regDir).filter(f => f.endsWith('.json'));
    expect(remaining.length).toBe(1); // one removed (oldest, no type match found)
  });

  it('removes the registration matching the completing agent type, not just the oldest', async () => {
    const th = loadTH();
    const regDir = path.join(tmpDir, '.monomind', 'agents', 'registrations');
    fs.mkdirSync(regDir, { recursive: true });
    // Oldest registration is a 'researcher' — should survive since the
    // completing agent is a 'coder' and a type-matching registration exists.
    fs.writeFileSync(path.join(regDir, 'agent-001.json'), JSON.stringify({ agentType: 'researcher' }), 'utf-8');
    fs.writeFileSync(path.join(regDir, 'agent-002.json'), JSON.stringify({ agentType: 'coder' }), 'utf-8');

    const hCtx = makeHCtx({ prompt: 'task done', hookInput: { agentSlug: 'coder' } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);

    const remaining = fs.readdirSync(regDir).filter(f => f.endsWith('.json'));
    expect(remaining).toEqual(['agent-001.json']); // the matching 'coder' registration was removed, not the oldest
  });

  it('does not touch registrations when the event carries no agent-identifying field (main-session task)', async () => {
    const th = loadTH();
    const regDir = path.join(tmpDir, '.monomind', 'agents', 'registrations');
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(path.join(regDir, 'agent-001.json'), JSON.stringify({ agentType: 'researcher' }), 'utf-8');
    fs.writeFileSync(path.join(regDir, 'agent-002.json'), JSON.stringify({ agentType: 'coder' }), 'utf-8');

    // hookInput has no subagent_type/agentSlug/etc — this simulates the lead's
    // own TaskCompleted/TeammateIdle event, which never registered an agent.
    const hCtx = makeHCtx({ prompt: 'task done', hookInput: {} });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);

    const remaining = fs.readdirSync(regDir).filter(f => f.endsWith('.json'));
    expect(remaining.length).toBe(2); // untouched — no correlating identity on this event
  });

  it('does not throw when regDir does not exist', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'task done' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(th.handlePostTask(hCtx)).resolves.not.toThrow();
  });

  it('updates swarm-activity.json with agent count', async () => {
    const th = loadTH();
    const regDir = path.join(tmpDir, '.monomind', 'agents', 'registrations');
    fs.mkdirSync(regDir, { recursive: true });
    // Also create the metrics dir (code writes directly without mkdirSync)
    fs.mkdirSync(path.join(tmpDir, '.monomind', 'metrics'), { recursive: true });
    fs.writeFileSync(path.join(regDir, 'agent-a.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(regDir, 'agent-b.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(regDir, 'agent-c.json'), '{}', 'utf-8');

    const hCtx = makeHCtx({ prompt: 'task done' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);

    const actPath = path.join(tmpDir, '.monomind', 'metrics', 'swarm-activity.json');
    expect(fs.existsSync(actPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(actPath, 'utf-8'));
    expect(data.swarm).toHaveProperty('agent_count');
  });
});

// ── handlePostTask — intelligence feedback ────────────────────────────────────

describe('task-handler.handlePostTask intelligence feedback', () => {
  it('calls intelligence.feedback(true) after task', async () => {
    const th = loadTH();
    const mockFeedback = vi.fn();
    const hCtx = makeHCtx({
      prompt: 'complete task',
      intelligence: { feedback: mockFeedback },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    expect(mockFeedback).toHaveBeenCalledWith(true);
  });

  it('does not throw when intelligence is null', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'done', intelligence: null });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(th.handlePostTask(hCtx)).resolves.not.toThrow();
  });
});
