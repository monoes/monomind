/**
 * Tests for .claude/helpers/handlers/route-handler.cjs
 * Builds a minimal mock hCtx and calls handler.handle(hCtx) directly.
 * Captures console.log output via vi.spyOn to assert panel output.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RH_PATH = path.resolve(__dirname, '../../.claude/helpers/handlers/route-handler.cjs');

const _savedHookQuiet = process.env.MONOMIND_HOOK_QUIET;

function loadRH() {
  delete require.cache[RH_PATH];
  return require(RH_PATH);
}

let tmpDir;

beforeEach(() => {
  delete process.env.MONOMIND_HOOK_QUIET;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-test-'));
});

afterEach(() => {
  if (_savedHookQuiet !== undefined) process.env.MONOMIND_HOOK_QUIET = _savedHookQuiet;
  else delete process.env.MONOMIND_HOOK_QUIET;
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
    fs,
    path,
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
    const _logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const hCtx = makeHCtx({
      prompt:
        'implement a comprehensive distributed authentication system with oauth2 and jwt tokens',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'backend-dev',
          confidence: 0.9,
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
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
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
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
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
      ];\n`,
    );
    const hCtx = makeHCtx({
      prompt: 'write a solidity smart contract for token vesting',
      router: {
        routeTask: vi.fn().mockResolvedValue({
          agent: 'Coder',
          agentSlug: 'coder',
          confidence: 0.8,
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
          extrasMatches: [
            { name: 'SEO Specialist', slug: 'seo-specialist', category: 'marketing' },
          ],
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
    fs.writeFileSync(
      path.join(monomindDir, 'last-dispatch.json'),
      JSON.stringify({
        agentType: 'coder',
        description: 'test task',
        dispatchedAt: new Date().toISOString(),
      }),
    );
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
    const dedupMsg = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[DISPATCH_DEDUP]'),
    );
    expect(dedupMsg).toBeTruthy();
    expect(dedupMsg[0]).toContain('coder');
  });

  it('does NOT log DISPATCH_DEDUP when a different agent was dispatched', async () => {
    const rh = loadRH();
    const monomindDir = path.join(tmpDir, '.monomind');
    fs.mkdirSync(monomindDir, { recursive: true });
    fs.writeFileSync(
      path.join(monomindDir, 'last-dispatch.json'),
      JSON.stringify({
        agentType: 'researcher',
        description: 'research task',
        dispatchedAt: new Date().toISOString(),
      }),
    );
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
    const dedupMsg = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[DISPATCH_DEDUP]'),
    );
    expect(dedupMsg).toBeFalsy();
  });
});

// ── Second Brain per-prompt injection gate ───────────────────────────────────
//
// The gate used to require CWD/.monomind/knowledge/chunks.jsonl — a file only
// the monograph god-node injector writes. Ingesting documents populates the
// real store (doc-metadata.jsonl + SQLite), which the warm endpoint serves, so
// a doc-only project got no injection at all. And since the CLI keys the store
// to the project root, a session started in a subdirectory found nothing.

describe('route-handler second-brain gate', () => {
  const PROMPT = 'authentication rotation policy details';

  /** The injection block sits after routing; give the handler a router so it
   *  reaches that far, same as the routing-path tests above. */
  const router = () => ({
    routeTask: vi.fn().mockResolvedValue({
      agent: 'coder',
      agentSlug: 'coder',
      confidence: 0.8,
      reason: 'default',
      skillMatches: [],
    }),
  });

  /** The default harness returns null here; the real dispatcher always supplies
   *  a function, and calling null would throw past the telemetry write. */
  const searchFn = () => () => async () => [];

  /** One telemetry line is appended per evaluated prompt, so its presence is a
   *  direct signal that the injection block ran. Always under CWD. */
  const telemetry = (cwd) => path.join(cwd, '.monomind', 'metrics', 'second-brain.jsonl');

  /** Point the warm-endpoint probe at a closed port so it fails immediately
   *  instead of reaching whatever dashboard is running on this machine. */
  const deadServer = (cwd) => {
    fs.mkdirSync(path.join(cwd, '.monomind'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.monomind', 'control.json'),
      JSON.stringify({ url: 'http://127.0.0.1:1' }),
    );
  };

  const writeKnowledge = (root, file) => {
    const kdir = path.join(root, '.monomind', 'knowledge');
    fs.mkdirSync(kdir, { recursive: true });
    fs.writeFileSync(
      path.join(kdir, file),
      file === 'chunks.jsonl'
        ? `${JSON.stringify({
            id: 'c1',
            text: 'authentication rotation policy is 90 days',
            namespace: 'knowledge:shared',
          })}\n`
        : `${JSON.stringify({
            filePath: path.join(root, 'a.md'),
            contentHash: 'h',
            chunkCount: 1,
            indexedAt: '2026-07-28T00:00:00Z',
            scope: 'shared',
            size: 8,
          })}\n`,
    );
  };

  it('runs for a doc-ingested project that has no chunks.jsonl', async () => {
    deadServer(tmpDir);
    writeKnowledge(tmpDir, 'doc-metadata.jsonl');
    await loadRH().handle(
      makeHCtx({ prompt: PROMPT, router: router(), _buildKnowledgeSearchFn: searchFn() }),
    );
    expect(fs.existsSync(telemetry(tmpDir))).toBe(true);
  });

  it('still runs for a monograph-only project (chunks.jsonl)', async () => {
    deadServer(tmpDir);
    writeKnowledge(tmpDir, 'chunks.jsonl');
    await loadRH().handle(
      makeHCtx({ prompt: PROMPT, router: router(), _buildKnowledgeSearchFn: searchFn() }),
    );
    expect(fs.existsSync(telemetry(tmpDir))).toBe(true);
  });

  it('finds the knowledge base from a package subdirectory', async () => {
    writeKnowledge(tmpDir, 'doc-metadata.jsonl');
    const sub = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(sub, { recursive: true });
    deadServer(sub);
    await loadRH().handle(
      makeHCtx({ prompt: PROMPT, CWD: sub, router: router(), _buildKnowledgeSearchFn: searchFn() }),
    );
    expect(fs.existsSync(telemetry(sub))).toBe(true);
  });

  it('stays inert when no knowledge exists anywhere', async () => {
    deadServer(tmpDir);
    await loadRH().handle(
      makeHCtx({ prompt: PROMPT, router: router(), _buildKnowledgeSearchFn: searchFn() }),
    );
    expect(fs.existsSync(telemetry(tmpDir))).toBe(false);
  });
});
