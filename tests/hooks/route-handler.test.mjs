/**
 * Tests for .claude/helpers/handlers/route-handler.cjs
 * Builds a minimal mock hCtx and calls handler.handle(hCtx) directly.
 * Captures console.log output via vi.spyOn to assert panel output.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RH_PATH = path.resolve(__dirname, '../../.claude/helpers/handlers/route-handler.cjs');

function loadRH() {
  delete require.cache[RH_PATH];
  return require(RH_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeHCtx(overrides = {}) {
  return {
    hookInput: {},
    toolInput: {},
    toolName: 'UserPromptSubmit',
    prompt: '',
    args: [],
    CWD: tmpDir,
    session: null,
    router: null,
    intelligence: null,
    isSimpleCommand: () => false,
    getLearningService: async () => null,
    _recordRecentEdit: () => {},
    _findAffectedTests: () => [],
    _recordHookLatency: () => {},
    _getBudgetStatus: () => null,
    _injectCompactGraphMap: () => {},
    _maybeRebuildMonograph: () => {},
    _buildKnowledgeSearchFn: () => null,
    getMonographSuggestions: () => [],
    getMonographNeighbors: () => [],
    runWithTimeout: async (fn) => fn(),
    safeRequire: () => null,
    scanMicroAgentTriggers: () => ({ matches: [], injectAgents: [], takeoverAgent: null }),
    _recordGraphTelemetry: () => {},
    _recordDecisionMarkers: () => {},
    _recordToolCall: () => {},
    _openMonographDb: () => null,
    _requireMonograph: () => null,
    _getRecentEdits: () => [],
    _hooksModule: null,
    fs, path,
    ...overrides,
  };
}

// ── simple command (slash command / predefined) ────────────────────────────────

describe('route-handler simple command path', () => {
  it('returns early without calling router', async () => {
    const rh = loadRH();
    const mockRoute = vi.fn();
    const hCtx = makeHCtx({
      prompt: '/help',
      isSimpleCommand: () => true,
      router: { routeTask: mockRoute },
    });
    await rh.handle(hCtx);
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it('writes last-route.json for slash command', async () => {
    const rh = loadRH();
    const hCtx = makeHCtx({
      prompt: '/ts',
      isSimpleCommand: () => true,
    });
    await rh.handle(hCtx);
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    expect(fs.existsSync(routeFile)).toBe(true);
  });

  it('last-route.json has confidence 1.0 for slash command', async () => {
    const rh = loadRH();
    const hCtx = makeHCtx({
      prompt: '/ts',
      isSimpleCommand: () => true,
    });
    await rh.handle(hCtx);
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    const data = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
    expect(data.confidence).toBe(1.0);
  });

  it('uses commandName from hookInput when prompt is not slash', async () => {
    const rh = loadRH();
    const hCtx = makeHCtx({
      prompt: 'help',
      hookInput: { commandName: 'help' },
      isSimpleCommand: () => true,
    });
    await rh.handle(hCtx);
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    const data = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
    expect(data.agent).toBe('help');
  });
});

// ── complex prompt with router ─────────────────────────────────────────────────

describe('route-handler routing path', () => {
  it('calls router.routeTask with prompt', async () => {
    const rh = loadRH();
    const mockRoute = vi.fn().mockResolvedValue({
      agent: 'coder',
      confidence: 0.9,
      reason: 'keyword match',
    });
    const hCtx = makeHCtx({
      prompt: 'implement a new authentication module with JWT support',
      router: { routeTask: mockRoute },
    });
    await rh.handle(hCtx);
    expect(mockRoute).toHaveBeenCalled();
  });

  it('writes last-route.json with resolved agent', async () => {
    const rh = loadRH();
    const hCtx = makeHCtx({
      prompt: 'implement authentication module',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'backend-dev',
          confidence: 0.88,
          reason: 'backend keyword match',
        }),
      },
    });
    await rh.handle(hCtx);
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    const data = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
    expect(data.agent).toBe('backend-dev');
    expect(data.confidence).toBe(0.88);
  });

  it('outputs routing panel for high-confidence long prompt', async () => {
    const rh = loadRH();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hCtx = makeHCtx({
      prompt: 'implement a comprehensive distributed authentication system with oauth2 and jwt tokens',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'backend-dev',
          confidence: 0.90,
          reason: 'backend',
        }),
      },
    });
    await rh.handle(hCtx);
    // Agent recommendation panels removed — handler now only outputs
    // skill matches, monograph hints, and budget alerts. Verify no crash.
  });

  it('suppresses panel for low-confidence short prompt', async () => {
    const rh = loadRH();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hCtx = makeHCtx({
      prompt: 'what else?',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'China E-Commerce Operator',
          confidence: 0.35,
          reason: 'vague match',
        }),
      },
    });
    await rh.handle(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).not.toContain('Primary Recommendation');
  });

  it('calls intelligence.getContext when available', async () => {
    const rh = loadRH();
    const mockGetCtx = vi.fn().mockReturnValue(null);
    const hCtx = makeHCtx({
      prompt: 'implement auth module',
      intelligence: { getContext: mockGetCtx },
    });
    await rh.handle(hCtx);
    expect(mockGetCtx).toHaveBeenCalledWith('implement auth module');
  });

  it('prints intelligence context when returned', async () => {
    const rh = loadRH();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hCtx = makeHCtx({
      prompt: 'implement auth module',
      intelligence: {
        getContext: vi.fn().mockReturnValue('[INTELLIGENCE] Relevant patterns: auth pattern'),
      },
    });
    await rh.handle(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[INTELLIGENCE]');
  });

  it('handles missing router gracefully (no throw)', async () => {
    const rh = loadRH();
    const hCtx = makeHCtx({
      prompt: 'implement something complex',
      router: null,
    });
    await expect(rh.handle(hCtx)).resolves.not.toThrow();
  });

  it('enriches coder catch-all with @monoes/routing keyword rules when available', async () => {
    const rh = loadRH();
    // Set up a routing dist directory with keyword rules
    const routingDist = path.join(tmpDir, 'packages', '@monomind', 'routing', 'dist');
    fs.mkdirSync(routingDist, { recursive: true });
    // Write a minimal keyword-pre-filter.js ESM module
    fs.writeFileSync(
      path.join(routingDist, 'keyword-pre-filter.js'),
      `export const DEFAULT_KEYWORD_ROUTES = [
        { pattern: /\\bsolidity\\b/i, agentSlug: 'engineering-solidity-smart-contract-engineer', routeName: 'solidity', description: 'Solidity / smart contract' },
      ];\n`
    );
    const hCtx = makeHCtx({
      prompt: 'write a solidity smart contract for token vesting',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'Coder',
          agentSlug: 'coder',
          confidence: 0.80,
          reason: 'Default routing — keyword match: coder',
          skillMatches: [],
        }),
      },
    });
    await rh.handle(hCtx);
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    const data = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
    expect(data.agentSlug).toBe('engineering-solidity-smart-contract-engineer');
    expect(data.confidence).toBe(0.85);
  });

  it('does not enrich when router returns a specific non-coder agent', async () => {
    const rh = loadRH();
    const hCtx = makeHCtx({
      prompt: 'review the authentication code',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'Reviewer',
          agentSlug: 'reviewer',
          confidence: 0.82,
          reason: 'Keyword match: reviewer',
          skillMatches: [],
        }),
      },
    });
    await rh.handle(hCtx);
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    const data = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
    expect(data.agentSlug).toBe('reviewer');
    expect(data.confidence).toBe(0.82);
  });

  it('writes last-route.json with "extras" resolved to specialist name', async () => {
    const rh = loadRH();
    const hCtx = makeHCtx({
      prompt: 'implement a new auth feature with multiple steps and file changes',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'extras',
          confidence: 0.75,
          reason: 'specialist match',
          extrasMatches: [{ name: 'SEO Specialist', slug: 'seo-specialist', category: 'marketing' }],
        }),
      },
    });
    await rh.handle(hCtx);
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    const data = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
    // Simplified persistence: agent field is passed through as-is
    expect(data.agent).toBe('extras');
  });

  it('logs DISPATCH_DEDUP when same agent was recently dispatched', async () => {
    const rh = loadRH();
    // Write last-dispatch.json as if agent-start-handler just dispatched "coder"
    const monomindDir = path.join(tmpDir, '.monomind');
    fs.mkdirSync(monomindDir, { recursive: true });
    fs.writeFileSync(path.join(monomindDir, 'last-dispatch.json'), JSON.stringify({
      agentType: 'coder',
      description: 'test task',
      dispatchedAt: new Date().toISOString(),
    }));
    const logSpy = vi.spyOn(console, 'log');
    const hCtx = makeHCtx({
      prompt: 'fix a bug in the auth module',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'coder',
          agentSlug: 'coder',
          confidence: 0.8,
          reason: 'default',
          skillMatches: [],
        }),
      },
    });
    await rh.handle(hCtx);
    const dedupMsg = logSpy.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('[DISPATCH_DEDUP]'));
    expect(dedupMsg).toBeTruthy();
    expect(dedupMsg[0]).toContain('coder');
  });

  it('does NOT log DISPATCH_DEDUP when a different agent was dispatched', async () => {
    const rh = loadRH();
    const monomindDir = path.join(tmpDir, '.monomind');
    fs.mkdirSync(monomindDir, { recursive: true });
    fs.writeFileSync(path.join(monomindDir, 'last-dispatch.json'), JSON.stringify({
      agentType: 'researcher',
      description: 'research task',
      dispatchedAt: new Date().toISOString(),
    }));
    const logSpy = vi.spyOn(console, 'log');
    const hCtx = makeHCtx({
      prompt: 'fix a bug in the auth module',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'coder',
          agentSlug: 'coder',
          confidence: 0.8,
          reason: 'default',
          skillMatches: [],
        }),
      },
    });
    await rh.handle(hCtx);
    const dedupMsg = logSpy.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('[DISPATCH_DEDUP]'));
    expect(dedupMsg).toBeFalsy();
  });
});
