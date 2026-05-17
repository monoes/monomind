/**
 * Tests for .claude/helpers/statusline.cjs
 * Uses process.env.CLAUDE_PROJECT_DIR + delete require.cache to inject a
 * controlled CWD into the module before each test group.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const SL_PATH = path.resolve(__dirname, '../../.claude/helpers/statusline.cjs');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-test-'));
  fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
});
afterEach(() => {
  delete process.env.CLAUDE_PROJECT_DIR;
  delete require.cache[SL_PATH];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function loadSL() {
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  delete require.cache[SL_PATH];
  return require(SL_PATH);
}

// ── readJSON ──────────────────────────────────────────────────────────────────

describe('readJSON', () => {
  it('returns null when file does not exist', () => {
    const { readJSON } = loadSL();
    expect(readJSON(path.join(tmpDir, 'missing.json'))).toBeNull();
  });

  it('returns parsed object for valid JSON file', () => {
    const p = path.join(tmpDir, 'test.json');
    fs.writeFileSync(p, JSON.stringify({ foo: 42 }));
    const { readJSON } = loadSL();
    expect(readJSON(p)).toEqual({ foo: 42 });
  });

  it('returns null for malformed JSON', () => {
    const p = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(p, 'not json');
    const { readJSON } = loadSL();
    expect(readJSON(p)).toBeNull();
  });
});

// ── safeStat ──────────────────────────────────────────────────────────────────

describe('safeStat', () => {
  it('returns null for missing file', () => {
    const { safeStat } = loadSL();
    expect(safeStat(path.join(tmpDir, 'missing'))).toBeNull();
  });

  it('returns stat object for existing file', () => {
    const p = path.join(tmpDir, 'exists.txt');
    fs.writeFileSync(p, 'hello');
    const { safeStat } = loadSL();
    const stat = safeStat(p);
    expect(stat).not.toBeNull();
    expect(stat.size).toBeGreaterThan(0);
  });
});

// ── modelLabel ────────────────────────────────────────────────────────────────

describe('modelLabel', () => {
  it('returns "Opus 4.6" for model ids containing "opus"', () => {
    const { modelLabel } = loadSL();
    expect(modelLabel('claude-opus-4-6')).toBe('Opus 4.6');
  });

  it('returns "Sonnet 4.6" for model ids containing "sonnet"', () => {
    const { modelLabel } = loadSL();
    expect(modelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6');
  });

  it('returns "Haiku 4.5" for model ids containing "haiku"', () => {
    const { modelLabel } = loadSL();
    expect(modelLabel('claude-haiku-4-5')).toBe('Haiku 4.5');
  });

  it('falls back to joining second+third segments for unknown ids', () => {
    const { modelLabel } = loadSL();
    const label = modelLabel('gpt-4-turbo-preview');
    expect(label).toBe('4 turbo');
  });
});

// ── getSecurityStatus ─────────────────────────────────────────────────────────

describe('getSecurityStatus', () => {
  it('returns status=NONE when no audit data or scan files exist', () => {
    const { getSecurityStatus } = loadSL();
    const result = getSecurityStatus();
    expect(result.status).toBe('NONE');
    expect(result.cvesFixed).toBe(0);
  });

  it('returns status=PENDING when audit-status.json has no lastAudit/lastScan', () => {
    fs.mkdirSync(path.join(tmpDir, '.monomind', 'security'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'security', 'audit-status.json'),
      JSON.stringify({ status: 'CLEAN', cvesFixed: 3, totalCves: 5 })
    );
    const { getSecurityStatus } = loadSL();
    const result = getSecurityStatus();
    expect(result.status).toBe('PENDING');
  });

  it('returns status from audit-status.json when lastAudit is recent', () => {
    fs.mkdirSync(path.join(tmpDir, '.monomind', 'security'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'security', 'audit-status.json'),
      JSON.stringify({ lastAudit: new Date().toISOString(), status: 'CLEAN', cvesFixed: 2, totalCves: 3 })
    );
    const { getSecurityStatus } = loadSL();
    const result = getSecurityStatus();
    expect(result.status).toBe('CLEAN');
    expect(result.cvesFixed).toBe(2);
  });

  it('returns status=STALE when lastAudit is > 7 days ago', () => {
    fs.mkdirSync(path.join(tmpDir, '.monomind', 'security'), { recursive: true });
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'security', 'audit-status.json'),
      JSON.stringify({ lastAudit: oldDate, status: 'CLEAN', cvesFixed: 1, totalCves: 1 })
    );
    const { getSecurityStatus } = loadSL();
    expect(getSecurityStatus().status).toBe('STALE');
  });

  it('returns status=SCANNED when security-scans dir has JSON files', () => {
    const scansDir = path.join(tmpDir, '.claude', 'security-scans');
    fs.mkdirSync(scansDir, { recursive: true });
    fs.writeFileSync(path.join(scansDir, 'scan-1.json'), '{}');
    const { getSecurityStatus } = loadSL();
    expect(getSecurityStatus().status).toBe('SCANNED');
  });
});

// ── getSwarmStatus ────────────────────────────────────────────────────────────

describe('getSwarmStatus', () => {
  it('returns activeAgents=0 when no swarm data exists', () => {
    const { getSwarmStatus } = loadSL();
    const result = getSwarmStatus();
    expect(result.activeAgents).toBe(0);
    expect(result.coordinationActive).toBe(false);
  });

  it('counts live registration files for agent count', () => {
    const regDir = path.join(tmpDir, '.monomind', 'agents', 'registrations');
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(path.join(regDir, 'agent-1.json'), '{}');
    fs.writeFileSync(path.join(regDir, 'agent-2.json'), '{}');
    const { getSwarmStatus } = loadSL();
    const result = getSwarmStatus();
    expect(result.activeAgents).toBe(2);
    expect(result.coordinationActive).toBe(true);
  });

  it('reads from swarm-activity.json when no registration files (recent timestamp)', () => {
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(path.join(metricsDir, 'swarm-activity.json'), JSON.stringify({
      timestamp: new Date().toISOString(),
      swarm: { agent_count: 3, coordination_active: true, active: true },
    }));
    const { getSwarmStatus } = loadSL();
    const result = getSwarmStatus();
    expect(result.activeAgents).toBe(3);
  });

  it('ignores stale swarm-activity.json (> 5 min old)', () => {
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    fs.writeFileSync(path.join(metricsDir, 'swarm-activity.json'), JSON.stringify({
      timestamp: stale,
      swarm: { agent_count: 5, coordination_active: true },
    }));
    const { getSwarmStatus } = loadSL();
    const result = getSwarmStatus();
    expect(result.activeAgents).toBe(0);
  });
});

// ── getADRStatus ──────────────────────────────────────────────────────────────

describe('getADRStatus', () => {
  it('returns count=0 when no ADR directories exist', () => {
    const { getADRStatus } = loadSL();
    expect(getADRStatus().count).toBe(0);
  });

  it('counts ADR-*.md files in docs/adrs/', () => {
    const adrsDir = path.join(tmpDir, 'docs', 'adrs');
    fs.mkdirSync(adrsDir, { recursive: true });
    fs.writeFileSync(path.join(adrsDir, 'ADR-0001-decision.md'), '');
    fs.writeFileSync(path.join(adrsDir, 'ADR-0002-decision.md'), '');
    fs.writeFileSync(path.join(adrsDir, 'not-an-adr.md'), '');
    const { getADRStatus } = loadSL();
    expect(getADRStatus().count).toBe(2);
  });
});

// ── getHooksStatus ────────────────────────────────────────────────────────────

describe('getHooksStatus', () => {
  it('returns enabled=0 when no settings or hooks dir exist', () => {
    const { getHooksStatus } = loadSL();
    const result = getHooksStatus();
    expect(result.enabled).toBe(0);
    expect(result.total).toBe(0);
  });

  it('counts hook entries from settings.json hooks config', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo' }, { type: 'command', command: 'echo 2' }] }],
          PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo 3' }] }],
        },
      })
    );
    const { getHooksStatus } = loadSL();
    const result = getHooksStatus();
    expect(result.total).toBe(3);
    expect(result.enabled).toBe(3);
  });
});

// ── getActiveAgent ────────────────────────────────────────────────────────────

describe('getActiveAgent', () => {
  it('returns null when last-route.json does not exist', () => {
    const { getActiveAgent } = loadSL();
    expect(getActiveAgent()).toBeNull();
  });

  it('returns null when last-route.json has no agent field', () => {
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'last-route.json'), JSON.stringify({ updatedAt: new Date().toISOString() }));
    const { getActiveAgent } = loadSL();
    expect(getActiveAgent()).toBeNull();
  });

  it('returns null when last-route.json is stale (> 30 min)', () => {
    const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'last-route.json'),
      JSON.stringify({ agent: 'coder', confidence: 0.8, updatedAt: stale })
    );
    const { getActiveAgent } = loadSL();
    expect(getActiveAgent()).toBeNull();
  });

  it('returns agent info from recent last-route.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'last-route.json'),
      JSON.stringify({ agent: 'backend-dev', confidence: 0.85, updatedAt: new Date().toISOString() })
    );
    const { getActiveAgent } = loadSL();
    const result = getActiveAgent();
    expect(result).not.toBeNull();
    expect(result.slug).toBe('backend-dev');
    expect(result.confidence).toBeCloseTo(0.85, 2);
  });

  it('formats agent slug into display name', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'last-route.json'),
      JSON.stringify({ agent: 'backend-dev', updatedAt: new Date().toISOString() })
    );
    const { getActiveAgent } = loadSL();
    const result = getActiveAgent();
    expect(result.name).toBe('Backend Dev');
  });
});

// ── getAgentDBStats ───────────────────────────────────────────────────────────

describe('getAgentDBStats', () => {
  it('returns vectorCount=0 when no data files exist', () => {
    const { getAgentDBStats } = loadSL();
    const result = getAgentDBStats();
    expect(result.vectorCount).toBe(0);
    expect(result.dbSizeKB).toBe(0);
  });

  it('counts entries from auto-memory-store.json array', () => {
    const dataDir = path.join(tmpDir, '.monomind', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'auto-memory-store.json'),
      JSON.stringify([{ key: 'a' }, { key: 'b' }, { key: 'c' }])
    );
    const { getAgentDBStats } = loadSL();
    const result = getAgentDBStats();
    expect(result.vectorCount).toBe(3);
  });

  it('counts entries from ranked-context.json when larger than store', () => {
    const dataDir = path.join(tmpDir, '.monomind', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'auto-memory-store.json'), JSON.stringify([{ key: 'a' }]));
    fs.writeFileSync(path.join(dataDir, 'ranked-context.json'), JSON.stringify({
      entries: [{ k: 1 }, { k: 2 }, { k: 3 }, { k: 4 }, { k: 5 }],
    }));
    const { getAgentDBStats } = loadSL();
    const result = getAgentDBStats();
    expect(result.vectorCount).toBe(5);
  });
});

// ── getLearningStats ──────────────────────────────────────────────────────────

describe('getLearningStats', () => {
  it('returns patterns=0 sessions=0 when nothing exists', () => {
    const { getLearningStats } = loadSL();
    const result = getLearningStats();
    expect(result.patterns).toBe(0);
    expect(result.sessions).toBeGreaterThanOrEqual(0);
  });

  it('counts session JSON files in .claude/sessions/', () => {
    const sessDir = path.join(tmpDir, '.claude', 'sessions');
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 's1.json'), '{}');
    fs.writeFileSync(path.join(sessDir, 's2.json'), '{}');
    fs.writeFileSync(path.join(sessDir, 'not-json.txt'), '');
    const { getLearningStats } = loadSL();
    const result = getLearningStats();
    expect(result.sessions).toBe(2);
  });
});

// ── getTestStats ──────────────────────────────────────────────────────────────

describe('getTestStats', () => {
  it('returns testFiles=0 when no test files exist', () => {
    const { getTestStats } = loadSL();
    expect(getTestStats().testFiles).toBe(0);
  });

  it('counts .test.* files in tests/ directory', () => {
    const testsDir = path.join(tmpDir, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, 'foo.test.mjs'), '');
    fs.writeFileSync(path.join(testsDir, 'bar.test.ts'), '');
    fs.writeFileSync(path.join(testsDir, 'not-a-test.ts'), '');
    const { getTestStats } = loadSL();
    expect(getTestStats().testFiles).toBe(2);
  });

  it('counts .spec.* files as test files', () => {
    const testsDir = path.join(tmpDir, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, 'auth.spec.ts'), '');
    const { getTestStats } = loadSL();
    expect(getTestStats().testFiles).toBe(1);
  });
});

// ── getIntegrationStatus ──────────────────────────────────────────────────────

describe('getIntegrationStatus', () => {
  it('returns mcpServers.total=0 when no settings or mcp.json exist', () => {
    const { getIntegrationStatus } = loadSL();
    const result = getIntegrationStatus();
    expect(result.mcpServers.total).toBe(0);
  });

  it('counts mcpServers from settings.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { monomind: {}, 'ruv-swarm': {} } })
    );
    const { getIntegrationStatus } = loadSL();
    const result = getIntegrationStatus();
    expect(result.mcpServers.total).toBe(2);
  });

  it('detects API key from env', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-123';
    const { getIntegrationStatus } = loadSL();
    expect(getIntegrationStatus().hasApi).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('hasApi=false when no API key env vars set', () => {
    const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const savedOpenAIKey = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { getIntegrationStatus } = loadSL();
    expect(getIntegrationStatus().hasApi).toBe(false);
    if (savedAnthropicKey) process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
    if (savedOpenAIKey) process.env.OPENAI_API_KEY = savedOpenAIKey;
  });
});

// ── generateJSON smoke test ───────────────────────────────────────────────────

describe('generateJSON', () => {
  it('returns an object with expected top-level keys', () => {
    const { generateJSON } = loadSL();
    const result = generateJSON();
    expect(result).toHaveProperty('security');
    expect(result).toHaveProperty('swarm');
    expect(result).toHaveProperty('adrs');
    expect(result).toHaveProperty('hooks');
    expect(result).toHaveProperty('agentdb');
    expect(result).toHaveProperty('tests');
    expect(result).toHaveProperty('git');
    expect(result).toHaveProperty('lastUpdated');
  });

  it('returns valid ISO timestamp in lastUpdated', () => {
    const { generateJSON } = loadSL();
    const result = generateJSON();
    expect(new Date(result.lastUpdated).getTime()).toBeGreaterThan(0);
  });
});
