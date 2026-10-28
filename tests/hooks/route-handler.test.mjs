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
    // A command is the route's skill, never an agent recommendation.
    expect(data).toMatchObject({ agent: null, skill: 'help' });
  });
});

// ── complex prompt with router ─────────────────────────────────────────────────

describe('route-handler routing path', () => {
  it('does not use router.routeTask as the agent selector', async () => {
    const rh = loadRH();
    const mockRoute = vi.fn().mockResolvedValue({ agent: 'coder', confidence: 0.9 });
    const hCtx = makeHCtx({
      prompt: 'implement a new authentication module with JWT support',
      router: { routeTask: mockRoute, matchSkills: () => [] },
    });
    await rh.handle(hCtx);
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it("never persists the router's agent: only a registry pick names an agent", async () => {
    const rh = loadRH();
    const hCtx = makeHCtx({
      prompt: 'implement authentication module',
      router: {
        routeTask: vi.fn().mockResolvedValue({ agent: 'backend-dev', confidence: 0.88 }),
      },
    });
    await rh.handle(hCtx);
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    const data = JSON.parse(fs.readFileSync(routeFile, 'utf-8'));
    expect(data.agent).toBeNull();
    expect(data.routeId).toBeDefined();
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

  // #417: the per-prompt [INTELLIGENCE] lookup matched nothing in practice
  // and rewrote ranked-context.json on every prompt.
  it('does not run the intelligence lookup or rewrite ranked-context.json', async () => {
    const rh = loadRH();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const intelligence = {
      init: vi.fn(),
      bootstrapFromDb: vi.fn(),
      getContext: vi.fn().mockReturnValue('[INTELLIGENCE] Relevant patterns: auth pattern'),
    };
    await rh.handle(makeHCtx({ prompt: 'implement auth module', intelligence }));
    expect(intelligence.init).not.toHaveBeenCalled();
    expect(intelligence.bootstrapFromDb).not.toHaveBeenCalled();
    expect(intelligence.getContext).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).not.toContain('[INTELLIGENCE]');
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'data', 'ranked-context.json'))).toBe(
      false,
    );
  });

  it('handles missing router gracefully (no throw)', async () => {
    const rh = loadRH();
    const hCtx = makeHCtx({
      prompt: 'implement something complex',
      router: null,
    });
    await expect(rh.handle(hCtx)).resolves.not.toThrow();
  });

  it('does not override the pick with the @monoes/routing keyword table', async () => {
    const rh = loadRH();
    const routingDist = path.join(tmpDir, 'packages', '@monomind', 'routing', 'dist');
    fs.mkdirSync(routingDist, { recursive: true });
    fs.writeFileSync(
      path.join(routingDist, 'keyword-pre-filter.js'),
      `export const DEFAULT_KEYWORD_ROUTES = [
        { pattern: /\\bsolidity\\b/i, agentSlug: 'engineering-solidity-smart-contract-engineer', routeName: 'solidity' },
      ];\n`,
    );
    await rh.handle(makeHCtx({ prompt: 'write a solidity smart contract for token vesting' }));
    const data = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.monomind', 'last-route.json'), 'utf-8'),
    );
    expect(data.agentSlug).toBeNull();
  });

  it('logs DISPATCH_DEDUP when same agent was recently dispatched', async () => {
    const rh = loadRH();
    // Write last-dispatch.json as if agent-start-handler just dispatched "coder"
    const monomindDir = path.join(tmpDir, '.monomind');
    fs.mkdirSync(monomindDir, { recursive: true });
    fs.writeFileSync(
      path.join(monomindDir, 'registry.json'),
      JSON.stringify({
        agents: [
          { slug: 'coder', name: 'coder', description: 'Writes code' },
          {
            slug: 'engineering-security-engineer',
            name: 'Security Engineer',
            description: 'Threat modeling and vulnerability assessment',
          },
          { slug: 'devops-automator', name: 'DevOps Automator', description: 'CI/CD pipelines' },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(monomindDir, 'last-dispatch.json'),
      JSON.stringify({
        agentType: 'DevOps Automator',
        description: 'test task',
        dispatchedAt: new Date().toISOString(),
      }),
    );
    const logSpy = vi.spyOn(console, 'log');
    const hCtx = makeHCtx({ prompt: 'ask the devops automator to fix the CI/CD pipelines' });
    await rh.handle(hCtx);
    const dedupMsg = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[DISPATCH_DEDUP]'),
    );
    expect(dedupMsg).toBeTruthy();
    expect(dedupMsg[0]).toContain('DevOps Automator');
  });

  it("does NOT log DISPATCH_DEDUP for another session's dispatch", async () => {
    const rh = loadRH();
    const monomindDir = path.join(tmpDir, '.monomind');
    fs.mkdirSync(monomindDir, { recursive: true });
    fs.writeFileSync(
      path.join(monomindDir, 'registry.json'),
      JSON.stringify({
        agents: [
          { slug: 'coder', name: 'coder', description: 'Writes code' },
          {
            slug: 'engineering-security-engineer',
            name: 'Security Engineer',
            description: 'Threat modeling and vulnerability assessment',
          },
          { slug: 'devops-automator', name: 'DevOps Automator', description: 'CI/CD pipelines' },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(monomindDir, 'last-dispatch.json'),
      JSON.stringify({
        agentType: 'DevOps Automator',
        dispatchedAt: new Date().toISOString(),
        sessionId: 'other-session',
      }),
    );
    const logSpy = vi.spyOn(console, 'log');
    await rh.handle(
      makeHCtx({
        prompt: 'ask the devops automator to fix the CI/CD pipelines',
        hookInput: { session_id: 'mine' },
      }),
    );
    const dedupMsg = logSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('[DISPATCH_DEDUP]'),
    );
    expect(dedupMsg).toBeFalsy();
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

  // #402: the prompt is POSTed to control.json's url, so that url must be
  // loopback or a tampered control.json would exfiltrate every prompt.
  const controlUrl = (cwd, url) => {
    fs.mkdirSync(path.join(cwd, '.monomind'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.monomind', 'control.json'), JSON.stringify({ url }));
  };
  const knowledgeCalls = (spy) =>
    spy.mock.calls.filter((c) => String(c[0]).includes('/api/knowledge/search'));

  it.each(['http://evil.example:4242', 'http://10.0.0.5', 'http://127.0.0.1.evil.com'])(
    'does not send the prompt to non-loopback %s',
    async (url) => {
      controlUrl(tmpDir, url);
      writeKnowledge(tmpDir, 'doc-metadata.jsonl');
      const fetchSpy = vi.fn(async () => new Response('{}', { status: 404 }));
      vi.stubGlobal('fetch', fetchSpy);
      await loadRH().handle(
        makeHCtx({ prompt: PROMPT, router: router(), _buildKnowledgeSearchFn: searchFn() }),
      );
      vi.unstubAllGlobals();
      expect(knowledgeCalls(fetchSpy)).toHaveLength(0);
      expect(fs.existsSync(telemetry(tmpDir))).toBe(true);
    },
  );

  it('sends the prompt to a loopback control url', async () => {
    controlUrl(tmpDir, 'http://127.0.0.1:4242');
    writeKnowledge(tmpDir, 'doc-metadata.jsonl');
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);
    await loadRH().handle(
      makeHCtx({ prompt: PROMPT, router: router(), _buildKnowledgeSearchFn: searchFn() }),
    );
    vi.unstubAllGlobals();
    const calls = knowledgeCalls(fetchSpy);
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toBe('http://127.0.0.1:4242/api/knowledge/search');
  });

  // #416: a dead or hung dashboard server must not cost every prompt ~900 ms,
  // and weak excerpts must not be injected at all.
  const writeControl = (cwd, ctl) => {
    fs.mkdirSync(path.join(cwd, '.monomind'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.monomind', 'control.json'), JSON.stringify(ctl));
  };
  const lastTelemetry = (cwd) => {
    const lines = fs.readFileSync(telemetry(cwd), 'utf-8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  };
  const serve = (results) =>
    vi.fn(async (url) =>
      String(url).includes('/api/knowledge/search')
        ? new Response(JSON.stringify({ method: 'semantic', results }), { status: 200 })
        : new Response('{}', { status: 404 }),
    );
  const hit = (key, score) => ({
    key,
    content: `excerpt ${key}`,
    score,
    tags: [`src:/p/${key}.md`],
  });
  const runCaptured = async (fetchSpy) => {
    const lines = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
    vi.stubGlobal('fetch', fetchSpy);
    await loadRH().handle(
      makeHCtx({ prompt: PROMPT, router: router(), _buildKnowledgeSearchFn: searchFn() }),
    );
    vi.unstubAllGlobals();
    return lines.join('\n');
  };

  it('skips the lookup when control.json names a dead pid', async () => {
    const { spawnSync } = await import('node:child_process');
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    writeControl(tmpDir, { url: 'http://127.0.0.1:4242', pid: deadPid });
    writeKnowledge(tmpDir, 'doc-metadata.jsonl');
    const fetchSpy = serve([hit('a', 0.9)]);
    await runCaptured(fetchSpy);
    expect(knowledgeCalls(fetchSpy)).toHaveLength(0);
    expect(fs.existsSync(telemetry(tmpDir))).toBe(true);
  });

  it('still queries when control.json names a live pid', async () => {
    writeControl(tmpDir, { url: 'http://127.0.0.1:4242', pid: process.pid });
    writeKnowledge(tmpDir, 'doc-metadata.jsonl');
    const fetchSpy = serve([]);
    await runCaptured(fetchSpy);
    expect(knowledgeCalls(fetchSpy)).toHaveLength(1);
  });

  it('gives up on a hung server well before the old 900 ms timeout', async () => {
    writeControl(tmpDir, { url: 'http://127.0.0.1:4242', pid: process.pid });
    writeKnowledge(tmpDir, 'doc-metadata.jsonl');
    const fetchSpy = vi.fn((url, opts) =>
      String(url).includes('/api/knowledge/search')
        ? new Promise((_, reject) =>
            opts.signal.addEventListener('abort', () => reject(new Error('aborted'))),
          )
        : Promise.resolve(new Response('{}', { status: 404 })),
    );
    const t0 = Date.now();
    await runCaptured(fetchSpy);
    expect(knowledgeCalls(fetchSpy)).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(700);
  });

  it('injects nothing when every result is below the relevance floor', async () => {
    writeControl(tmpDir, { url: 'http://127.0.0.1:4242', pid: process.pid });
    writeKnowledge(tmpDir, 'doc-metadata.jsonl');
    const out = await runCaptured(serve([hit('a', 0.6), hit('b', 0.55), hit('c', 0.5)]));
    expect(out).not.toContain('relevant excerpt(s)');
    expect(out).toContain('[SECOND_BRAIN] no match for this prompt');
    expect(lastTelemetry(tmpDir)).toMatchObject({ injected: false, hits: 0 });
  });

  it('says so once per session when the project has no knowledge store', async () => {
    const run = async (sessionId) => {
      const lines = [];
      vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
      await loadRH().handle(
        makeHCtx({
          prompt: PROMPT,
          hookInput: { session_id: sessionId },
          router: router(),
          _buildKnowledgeSearchFn: searchFn(),
        }),
      );
      return lines.join('\n');
    };
    expect(await run('sess-a')).toContain('[SECOND_BRAIN] skipped: no knowledge store');
    expect(await run('sess-a')).not.toContain('[SECOND_BRAIN]');
    expect(await run('sess-b')).toContain('[SECOND_BRAIN] skipped: no knowledge store');
  });

  it('prints no [SECOND_BRAIN] line for a no-match over the project-instructions fallback', async () => {
    // chunks.jsonl only (no doc-metadata.jsonl) and no reachable server: the
    // keyword fallback over CLAUDE.md-style chunks ran and found nothing.
    deadServer(tmpDir);
    writeKnowledge(tmpDir, 'chunks.jsonl');
    const out = await runCaptured(serve([]));
    expect(out).not.toContain('[SECOND_BRAIN]');
    expect(fs.existsSync(telemetry(tmpDir))).toBe(true);
  });

  it('injects exactly one excerpt when only the top result is strong', async () => {
    writeControl(tmpDir, { url: 'http://127.0.0.1:4242', pid: process.pid });
    writeKnowledge(tmpDir, 'doc-metadata.jsonl');
    const out = await runCaptured(serve([hit('a', 0.82), hit('b', 0.7), hit('c', 0.68)]));
    expect(out).toContain('[SECOND_BRAIN] 1 relevant excerpt(s)');
    expect(out).toContain('excerpt a');
    expect(out).not.toContain('excerpt b');
    expect(lastTelemetry(tmpDir)).toMatchObject({ injected: true, hits: 1, topScore: 0.82 });
  });

  it('keeps a second excerpt only when its score is close to the top', async () => {
    writeControl(tmpDir, { url: 'http://127.0.0.1:4242', pid: process.pid });
    writeKnowledge(tmpDir, 'doc-metadata.jsonl');
    const out = await runCaptured(serve([hit('a', 0.8), hit('b', 0.79), hit('c', 0.7)]));
    expect(out).toContain('[SECOND_BRAIN] 2 relevant excerpt(s)');
    expect(out).not.toContain('excerpt c');
  });

  describe('under MONOMIND_HOOK_QUIET=1 (exception: injection is always active)', () => {
    beforeEach(() => {
      process.env.MONOMIND_HOOK_QUIET = '1';
    });

    it('still delivers a relevant excerpt from the real store', async () => {
      writeControl(tmpDir, { url: 'http://127.0.0.1:4242', pid: process.pid });
      writeKnowledge(tmpDir, 'doc-metadata.jsonl');
      const out = await runCaptured(serve([hit('a', 0.82)]));
      expect(out).toContain('[SECOND_BRAIN] 1 relevant excerpt(s)');
      expect(out).toContain('excerpt a');
      expect(lastTelemetry(tmpDir)).toMatchObject({ injected: true, hits: 1 });
    });

    it('keeps the relevance floor: weak hits inject nothing and print no no-match line', async () => {
      writeControl(tmpDir, { url: 'http://127.0.0.1:4242', pid: process.pid });
      writeKnowledge(tmpDir, 'doc-metadata.jsonl');
      const out = await runCaptured(serve([hit('a', 0.6)]));
      expect(out).not.toContain('[SECOND_BRAIN]');
      expect(lastTelemetry(tmpDir)).toMatchObject({ injected: false, hits: 0 });
    });

    it('stays silent about a missing store and does not burn the once-per-session notice', async () => {
      const run = async () => {
        const lines = [];
        vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
        await loadRH().handle(
          makeHCtx({
            prompt: PROMPT,
            hookInput: { session_id: 'sess-q' },
            router: router(),
            _buildKnowledgeSearchFn: searchFn(),
          }),
        );
        vi.restoreAllMocks();
        return lines.join('\n');
      };
      expect(await run()).not.toContain('[SECOND_BRAIN]');
      delete process.env.MONOMIND_HOOK_QUIET;
      expect(await run()).toContain('[SECOND_BRAIN] skipped: no knowledge store');
    });

    it('does not run the rest of the enrichment (budget, banners)', async () => {
      writeControl(tmpDir, { url: 'http://127.0.0.1:4242', pid: process.pid });
      writeKnowledge(tmpDir, 'doc-metadata.jsonl');
      const budget = vi.fn(() => null);
      const lines = [];
      vi.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
      vi.stubGlobal('fetch', serve([hit('a', 0.9)]));
      await loadRH().handle(
        makeHCtx({
          prompt: PROMPT,
          router: router(),
          _buildKnowledgeSearchFn: searchFn(),
          _getBudgetStatus: budget,
        }),
      );
      vi.unstubAllGlobals();
      expect(budget).not.toHaveBeenCalled();
    });
  });
});

describe('route-handler isLoopbackUrl', () => {
  it.each([
    'http://evil.example:4242',
    'http://10.0.0.5',
    'http://127.0.0.1.evil.com',
    'http://localhost.evil.com:4242',
    'http://user@localhost:4242',
    'ftp://localhost',
    'file:///etc/passwd',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(loadRH().isLoopbackUrl(url)).toBe(false);
  });

  it.each([
    'http://127.0.0.1:4242',
    'http://localhost:4242',
    'http://[::1]:4242',
    'https://localhost',
  ])('accepts %s', (url) => {
    expect(loadRH().isLoopbackUrl(url)).toBe(true);
  });
});
