/**
 * route-handler.cjs delivers the pick: one `[PICK] …` line into Claude's
 * context on UserPromptSubmit, even with MONOMIND_HOOK_QUIET=1, naming only
 * registry agents (by frontmatter name) — never router.cjs's hardcoded table.
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

// The legacy table would send a security prompt to "tester": it must not leak.
const legacyRouter = {
  routeTask: () => ({ agent: 'Tester', agentSlug: 'tester', confidence: 0.95, skillMatches: [] }),
  matchSkills: () => [],
};

function makeHCtx(prompt, extra) {
  return {
    hookInput: { session_id: 'sess-1', ...(extra || {}) },
    toolInput: {},
    prompt,
    args: [],
    CWD: tmpDir,
    router: legacyRouter,
    intelligence: null,
    isSimpleCommand: () => false,
    _getBudgetStatus: () => null,
    _buildKnowledgeSearchFn: () => null,
    getMonographSuggestions: () => [],
    runWithTimeout: async (fn) => fn(),
    _recordGraphTelemetry: () => {},
    _recordDecisionMarkers: () => {},
    _openMonographDb: () => null,
    _getRecentEdits: () => [],
    _isGraphFresh: () => false,
  };
}

const outcomes = () => {
  const f = path.join(tmpDir, '.monomind', 'route-outcomes.jsonl');
  return fs.existsSync(f)
    ? fs
        .readFileSync(f, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
};

function jevAnswer(agentChoice, skillChoice) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          answers: {
            agent: {
              type: 'choice',
              choice: agentChoice,
              confidence: 0.9,
              probabilities: { [agentChoice]: 0.9, coder: 0.1 },
            },
            skill: {
              type: 'choice',
              choice: skillChoice,
              confidence: 0.85,
              probabilities: { [skillChoice]: 0.85, __none__: 0.15 },
            },
          },
        }),
        { status: 200 },
      ),
  );
}

beforeEach(() => {
  process.env.MONOMIND_HOOK_QUIET = '1';
  vi.stubEnv('TYPESAFE_API_KEY', '');
  vi.stubEnv('MONOMIND_JEV_URL', '');
  vi.stubEnv('MONOMIND_SKILL_AUTO', '');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-pick-'));
  fs.mkdirSync(path.join(tmpDir, '.monomind'));
  fs.mkdirSync(path.join(tmpDir, '.claude', 'helpers'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, '.monomind', 'registry.json'),
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
    path.join(tmpDir, '.claude', 'helpers', 'skill-registry.json'),
    JSON.stringify({
      skills: [
        {
          skill: 'security-review',
          invoke: 'Skill("security-review")',
          description: 'Security review',
          nameTerms: ['security'],
        },
      ],
    }),
  );
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
});

afterEach(() => {
  delete process.env.MONOMIND_HOOK_QUIET;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('route-handler [PICK] delivery', () => {
  it('prints exactly one [PICK] line under HOOK_QUIET when Jev picks, with the frontmatter name', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    vi.stubGlobal('fetch', jevAnswer('engineering-security-engineer', 'security-review'));
    await loadRH().handle(makeHCtx('check the login handler for injection bugs'));
    expect(logs).toEqual(['[PICK] agent: Security Engineer · skill: Skill("security-review")']);
    const rec = outcomes().at(-1);
    expect(rec).toMatchObject({
      sessionId: 'sess-1',
      agentName: 'Security Engineer',
      agentId: 'engineering-security-engineer',
      method: 'jev',
      provider: 'custom',
      shown: true,
    });
    expect(rec.task).not.toBeUndefined();
    expect(rec.candidates[0]).toEqual({ name: 'Security Engineer', score: 0.9 });
  });

  it('prints nothing without Jev when no keyword match is strong, and never the legacy table agent', async () => {
    await loadRH().handle(makeHCtx('check the login handler for injection bugs'));
    expect(logs).toEqual([]);
    const rec = outcomes().at(-1);
    expect(rec).toMatchObject({ agentName: null, method: 'none', shown: false });
    expect(JSON.stringify(rec)).not.toMatch(/tester/i);
    const last = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.monomind', 'last-route.json'), 'utf-8'),
    );
    expect(last.agent).toBeNull();
  });

  it('prints a strong keyword pick over the registry without Jev', async () => {
    await loadRH().handle(makeHCtx('set up the devops automator for our CI/CD pipelines'));
    expect(logs).toEqual(['[PICK] agent: DevOps Automator']);
    expect(outcomes().at(-1)).toMatchObject({ method: 'keyword', agentId: 'devops-automator' });
  });

  it('picks a keyword skill from the shared catalog, Org skills included, not router.cjs', async () => {
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
        ],
        orgSkills: [
          {
            name: 'zorbling-tuning',
            description: 'Tune zorbling flux capacitors for throughput',
            tags: ['zorbling'],
          },
        ],
      }),
    );
    const matchSkills = vi.fn(() => [{ skill: 'legacy', invoke: '/legacy', score: 9 }]);
    const hCtx = makeHCtx('tune the zorbling flux capacitors');
    hCtx.router = { ...legacyRouter, matchSkills };
    await loadRH().handle(hCtx);
    expect(logs).toEqual([
      '[PICK] skill: mcp__monomind__org_skill_show {"name":"zorbling-tuning"}',
    ]);
    expect(matchSkills).not.toHaveBeenCalled();
    expect(outcomes().at(-1)).toMatchObject({
      method: 'keyword',
      skill: 'mcp__monomind__org_skill_show {"name":"zorbling-tuning"}',
    });
  });

  it('refreshes a stale skill index before picking, so a removed skill is never named', async () => {
    const skillMd = (name, description) => {
      fs.mkdirSync(path.join(tmpDir, '.claude', 'skills', name), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.claude', 'skills', name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${description}\n---\n`,
      );
    };
    skillMd('browser-testing', 'Browser UI testing with screenshots and flows');
    require('../../.claude/helpers/build-skill-registry.cjs').write(tmpDir, { user: false });
    // The skill is removed after the index was written; nothing rebuilt it.
    fs.rmSync(path.join(tmpDir, '.claude', 'skills', 'browser-testing'), { recursive: true });
    await loadRH().handle(makeHCtx('browser UI testing with screenshots of the flows'));
    expect(logs.join('\n')).not.toContain('browser-testing');

    // A skill added after the index was written is picked on the next prompt.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(tmpDir, '.claude', 'helpers', 'skill-registry.json'), past, past);
    skillMd('invoice-parsing', 'Parse invoice PDFs into line items and totals');
    logs = [];
    await loadRH().handle(makeHCtx('parse the invoice PDFs into line items and totals'));
    expect(logs.join('\n')).toContain('[PICK] skill: Skill("invoice-parsing")');
  });

  it('prints and records nothing for a task notification', async () => {
    vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
    const fetchSpy = jevAnswer('engineering-security-engineer', 'security-review');
    vi.stubGlobal('fetch', fetchSpy);
    await loadRH().handle(
      makeHCtx(
        '<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n</task-notification>',
      ),
    );
    expect(logs).toEqual([]);
    expect(outcomes()).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'last-route.json'))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    'hi',
    'thanks!',
    'ok',
    'looks good',
    'anything else pending rather than release',
    'is there anything pending?',
  ])(
    'makes no pick and no record for the trivial prompt %j, keeping the earlier route',
    async (prompt) => {
      await loadRH().handle(makeHCtx('set up the devops automator for our CI/CD pipelines'));
      const before = outcomes();
      logs.length = 0;
      vi.stubEnv('MONOMIND_JEV_URL', 'http://127.0.0.1:3999');
      const fetchSpy = jevAnswer('coder', 'security-review');
      vi.stubGlobal('fetch', fetchSpy);
      await loadRH().handle(makeHCtx(prompt));
      expect(logs).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(outcomes()).toEqual(before);
      const own = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.monomind', 'routes', 'sess-1.json'), 'utf-8'),
      );
      expect(own.agent).toBe('DevOps Automator');
    },
  );

  it('keeps the route per session', async () => {
    await loadRH().handle(makeHCtx('set up the devops automator for our CI/CD pipelines'));
    const own = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.monomind', 'routes', 'sess-1.json'), 'utf-8'),
    );
    expect(own).toMatchObject({ sessionId: 'sess-1', agent: 'DevOps Automator' });
    expect(own.routeId).toBe(outcomes().at(-1).routeId);
  });

  it('works without .monomind/registry.json (no agent, no crash)', async () => {
    fs.rmSync(path.join(tmpDir, '.monomind', 'registry.json'));
    await loadRH().handle(makeHCtx('set up the devops automator for our CI/CD pipelines'));
    expect(logs).toEqual([]);
    expect(outcomes().at(-1)).toMatchObject({ agentName: null });
  });
});
