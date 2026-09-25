/**
 * route-handler.cjs with the Jev decision model: Jev picks first; keyword
 * routing stands when Jev is not configured or fails.
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

let tmpDir;
let logs;

function loadRH() {
  delete require.cache[RH_PATH];
  return require(RH_PATH);
}

function keywordRouter() {
  return {
    routeTask: () => ({
      agent: 'coder',
      agentSlug: 'coder',
      confidence: 0.5,
      reason: 'Default routing — no strong keyword match',
      semanticRouting: false,
      specificAgents: [],
      skillMatches: [],
      extrasMatches: [],
    }),
  };
}

function makeHCtx(prompt) {
  return {
    hookInput: {},
    toolInput: {},
    toolName: 'UserPromptSubmit',
    prompt,
    args: [],
    CWD: tmpDir,
    session: null,
    router: keywordRouter(),
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
  };
}

const lastRoute = () =>
  JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'last-route.json'), 'utf-8'));

beforeEach(() => {
  delete process.env.MONOMIND_HOOK_QUIET;
  vi.stubEnv('TYPESAFE_API_KEY', '');
  // The skill box only prints with MONOMIND_SKILL_AUTO=1 (route-handler.cjs ~383).
  vi.stubEnv('MONOMIND_SKILL_AUTO', '1');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-jev-'));
  fs.mkdirSync(path.join(tmpDir, '.monomind'));
  fs.mkdirSync(path.join(tmpDir, '.claude', 'helpers'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, '.monomind', 'registry.json'),
    JSON.stringify({
      agents: [
        { slug: 'coder', name: 'coder', category: 'core', description: 'Writes code' },
        {
          slug: 'security-engineer',
          name: 'security-engineer',
          category: 'security',
          description: 'Security audits',
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(tmpDir, '.claude', 'helpers', 'skill-registry.json'),
    JSON.stringify({
      skills: [
        {
          skill: 'security-review',
          invoke: 'Skill("security-review")',
          description: 'Security review',
          nameTerms: ['security'],
        },
        {
          skill: 'monodesign',
          invoke: '/monodesign',
          description: 'Frontend design',
          nameTerms: ['monodesign'],
        },
      ],
    }),
  );
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('route-handler with Jev', () => {
  it('uses the agent and skill Jev picks', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              answers: {
                agent: {
                  type: 'choice',
                  choice: 'security-engineer',
                  confidence: 0.9,
                  probabilities: { 'security-engineer': 0.9, coder: 0.1 },
                },
                skill: {
                  type: 'choice',
                  choice: 'security-review',
                  confidence: 0.85,
                  probabilities: { 'security-review': 0.85, __none__: 0.15 },
                },
              },
            }),
            { status: 200 },
          ),
      ),
    );
    await loadRH().handle(makeHCtx('check the login handler for injection bugs'));
    expect(lastRoute()).toMatchObject({ agentSlug: 'security-engineer' });
    const outcomes = fs
      .readFileSync(path.join(tmpDir, '.monomind', 'route-outcomes.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    expect(JSON.parse(outcomes[outcomes.length - 1]).routingMethod).toBe('jev');
    const out = logs.join('\n');
    expect(out).toContain('SKILL AUTO-ACTIVATED');
    expect(out).toContain('Skill("security-review")');
  });

  it('shows no pick when Jev answers "no agent fits" and a skill below its bar', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            answers: {
              agent: { type: 'choice', choice: '__none__', confidence: 0.9 },
              skill: { type: 'choice', choice: 'security-review', confidence: 0.3 },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchImpl);
    // Keyword ranking alone picks security-engineer and Skill("security-review") here.
    await loadRH().handle(makeHCtx('security review of the security engineer audits'));
    const sent = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(sent.questions.agent.criteria).toHaveProperty('__none__');
    expect(logs.join('\n')).not.toContain('[PICK]');
    expect(logs.join('\n')).not.toContain('SKILL AUTO-ACTIVATED');
    expect(lastRoute()).toMatchObject({ agentSlug: null, skill: null, reason: 'jev (custom)' });
  });

  it('falls back to keyword routing (no confident match here) when Jev fails', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('ECONNREFUSED');
      }),
    );
    await loadRH().handle(makeHCtx('check the login handler for injection bugs'));
    expect(lastRoute()).toMatchObject({ agentSlug: null });
    expect(logs.join('\n')).toContain('[JEV] custom: request failed');
  });

  it('still decides (and records) the route in quiet mode, printing only the pick', async () => {
    process.env.MONOMIND_HOOK_QUIET = '1';
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            answers: {
              agent: {
                type: 'choice',
                choice: 'security-engineer',
                confidence: 0.9,
                probabilities: { 'security-engineer': 0.9 },
              },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await loadRH().handle(makeHCtx('check the login handler for injection bugs'));
    } finally {
      delete process.env.MONOMIND_HOOK_QUIET;
    }
    expect(fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/v1/systemone'))).toHaveLength(
      1,
    );
    expect(lastRoute()).toMatchObject({ agentSlug: 'security-engineer' });
    const outcomes = fs
      .readFileSync(path.join(tmpDir, '.monomind', 'route-outcomes.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    expect(JSON.parse(outcomes[outcomes.length - 1]).routingMethod).toBe('jev');
    // Quiet silences every banner; the pick itself still reaches Claude.
    expect(logs).toEqual(['[PICK] agent: security-engineer']);
  });

  it('skips Jev for five minutes after a failed pick', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', fetchSpy);
    await loadRH().handle(makeHCtx('check the login handler for injection bugs'));
    const jevCalls = () =>
      fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/v1/systemone')).length;
    const first = jevCalls();
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'jev-breaker.json'))).toBe(true);
    await loadRH().handle(makeHCtx('check the login handler for injection bugs'));
    expect(jevCalls()).toBe(first);
    expect(lastRoute()).toMatchObject({ agentSlug: null });
  });

  it('persists the route inside the hook exit after a timed-out Jev pick and a slow intelligence lookup', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    vi.stubEnv('MONOMIND_JEV_HOOK_TIMEOUT_MS', '4000');
    // Jev never answers; the request only ends when its signal aborts.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    // An intelligence bridge that answers well after the 2 s race it used to get.
    const bridge = path.join(tmpDir, 'packages', '@monomind', 'cli', 'dist', 'src', 'mcp-tools');
    fs.mkdirSync(bridge, { recursive: true });
    fs.writeFileSync(path.join(bridge, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(
      path.join(bridge, 'hooks-embedding.js'),
      'export const suggestAgentsFromIntelligence = () => new Promise((r) => setTimeout(() => r({ agents: ["tester"], confidence: 0.99 }), 1900));\n',
    );
    const rh = loadRH();
    const started = Date.now();
    await rh.handle(makeHCtx('check the login handler for injection bugs'));
    const elapsed = Date.now() - started;
    // Designed to finish 500 ms before the hook exit; the bound keeps scheduler slack.
    expect(elapsed).toBeLessThan(rh.routeDeadlineMs(process.env) - 50);
    expect(lastRoute()).toMatchObject({ agentSlug: null });
  }, 15000);

  it('makes no request when Jev is not configured', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', '');
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);
    await loadRH().handle(makeHCtx('check the login handler for injection bugs'));
    // Other enrichment in the hook may use fetch; only Jev's endpoint must stay untouched.
    const jevCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/v1/systemone'));
    expect(jevCalls).toHaveLength(0);
    expect(lastRoute()).toMatchObject({ agentSlug: null });
  });
});
