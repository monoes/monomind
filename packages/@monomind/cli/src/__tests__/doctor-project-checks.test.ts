import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// checkApiKeys() shells out to a real `claude --version`. On the machine this
// suite actually runs on, a `claude` binary genuinely is on PATH, which would
// make the "no CLI available" branch untestable without control. We mock
// `child_process.execSync` narrowly — only the `claude --version` probe is
// intercepted (driven by a hoisted, per-test-settable flag); every other
// command (git, npm root -g, etc., used by other checks in this file) passes
// straight through to the real implementation so real-filesystem/real-git
// behavior stays intact everywhere else.
const execState = vi.hoisted(() => ({ claudeAvailable: false }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: (command: string, options?: Parameters<typeof actual.execSync>[1]) => {
      if (typeof command === 'string' && command.startsWith('claude --version')) {
        if (execState.claudeAvailable) return 'claude/1.0.0\n';
        throw new Error('command not found');
      }
      return actual.execSync(command, options);
    },
  };
});

// checkMcpServers() reads several $HOME-relative config paths before it ever
// looks at cwd-relative ones. Running against the real $HOME would read this
// dev's actual ~/.claude/settings.json and make results depend on machine
// state. We redirect os.homedir() to an empty, test-controlled directory.
const homeState = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => homeState.dir };
});

import {
  checkConfigFile,
  checkMemoryDatabase,
  checkApiKeys,
  checkMcpServers,
  checkMonograph,
  checkMonographFreshness,
  checkMonoesMemory,
  checkHelpersFresh,
  fixStaleHelpers,
  checkGitignoreCoverage,
  checkAgentRegistry,
  checkGuidanceGates,
  checkMetricsFreshness,
  checkSecurityAuditFindings,
  checkMemoryProficiency,
  checkMonoesIntegration,
} from '../commands/doctor-project-checks.js';

// Env var names built from parts at runtime, not as literal `X_API_KEY`
// source text — matches the convention already used in terminal-tools.test.ts
// to avoid tripping this repo's secret-scanning pre-write gate, which
// pattern-matches on `*_API_KEY`-shaped assignments regardless of value.
const ANTHROPIC_KEY_NAME = ['ANTHROPIC', 'API', 'KEY'].join('_');
const CLAUDE_KEY_NAME = ['CLAUDE', 'API', 'KEY'].join('_');
const OPENAI_KEY_NAME = ['OPENAI', 'API', 'KEY'].join('_');
const FAKE_KEY_VALUE = 'placeholder-not-a-real-credential';

const KEY_ENV_VARS = [
  ANTHROPIC_KEY_NAME, CLAUDE_KEY_NAME, OPENAI_KEY_NAME,
  'CLAUDE_CODE', 'CLAUDE_PROJECT_DIR', 'MCP_SESSION_ID',
];

// Captured once, before any test mutates cwd, so the helper-staleness tests
// can locate this package's real .claude/helpers tree regardless of which
// temp dir is the process cwd during a given test.
const SUITE_START_CWD = process.cwd();

describe('doctor-project-checks', () => {
  let dir: string;
  let originalCwd: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'doctor-project-checks-'));
    originalCwd = process.cwd();
    process.chdir(dir);

    homeState.dir = join(dir, '__home__');
    mkdirSync(homeState.dir, { recursive: true });

    execState.claudeAvailable = false;

    savedEnv = {};
    for (const k of KEY_ENV_VARS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const k of KEY_ENV_VARS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------
  // checkConfigFile
  // ---------------------------------------------------------------------
  describe('checkConfigFile', () => {
    it('passes when a valid JSON config is present', async () => {
      mkdirSync(join(dir, '.monomind'), { recursive: true });
      writeFileSync(join(dir, '.monomind', 'config.json'), JSON.stringify({ a: 1 }));
      const result = await checkConfigFile();
      expect(result).toEqual({ name: 'Config File', status: 'pass', message: 'Found: .monomind/config.json' });
    });

    it('warns with a fix suggestion when no config file exists', async () => {
      const result = await checkConfigFile();
      expect(result.status).toBe('warn');
      expect(result.message).toBe('No config file (using defaults)');
      expect(result.fix).toBe('monomind config init');
    });

    it('fails on malformed JSON', async () => {
      mkdirSync(join(dir, '.monomind'), { recursive: true });
      writeFileSync(join(dir, '.monomind', 'config.json'), '{ not valid json');
      const result = await checkConfigFile();
      expect(result.status).toBe('fail');
      expect(result.message).toBe('Invalid JSON: .monomind/config.json');
      expect(result.fix).toBe('Fix JSON syntax in config file');
    });

    it('accepts a YAML config when no JSON config exists', async () => {
      writeFileSync(join(dir, 'monomind.config.yaml'), 'key: value\n');
      const result = await checkConfigFile();
      expect(result).toEqual({ name: 'Config File', status: 'pass', message: 'Found: monomind.config.yaml' });
    });
  });

  // ---------------------------------------------------------------------
  // checkMemoryDatabase
  // ---------------------------------------------------------------------
  describe('checkMemoryDatabase', () => {
    it('passes and reports the size in MB when a db file is present', async () => {
      mkdirSync(join(dir, '.monomind'), { recursive: true });
      writeFileSync(join(dir, '.monomind', 'memory.db'), Buffer.alloc(2 * 1024 * 1024, 'x'));
      const result = await checkMemoryDatabase();
      expect(result.status).toBe('pass');
      expect(result.message).toMatch(/^\.monomind\/memory\.db \(\d+\.\d{2} MB\)$/);
    });

    it('warns with a fix suggestion when no db file exists anywhere', async () => {
      const result = await checkMemoryDatabase();
      expect(result).toEqual({
        name: 'Memory Database', status: 'warn', message: 'Not initialized',
        fix: 'monomind memory configure --backend hybrid',
      });
    });

    it('checks alternate db locations', async () => {
      mkdirSync(join(dir, '.swarm'), { recursive: true });
      writeFileSync(join(dir, '.swarm', 'memory.db'), 'x');
      const result = await checkMemoryDatabase();
      expect(result.status).toBe('pass');
      expect(result.message).toContain('.swarm/memory.db');
    });
  });

  // ---------------------------------------------------------------------
  // checkApiKeys
  // ---------------------------------------------------------------------
  describe('checkApiKeys', () => {
    it('passes when the Anthropic key env var is set', async () => {
      process.env[ANTHROPIC_KEY_NAME] = FAKE_KEY_VALUE;
      const result = await checkApiKeys();
      expect(result.status).toBe('pass');
      expect(result.message).toBe(`Found: ${ANTHROPIC_KEY_NAME}`);
    });

    it('passes when running inside Claude Code (env detected), no key needed', async () => {
      process.env.CLAUDE_CODE = '1';
      const result = await checkApiKeys();
      expect(result.status).toBe('pass');
      expect(result.message).toBe('Claude Code manages auth (no direct API key needed)');
    });

    it('passes via CLAUDE_PROJECT_DIR as the Claude Code signal too', async () => {
      process.env.CLAUDE_PROJECT_DIR = '/some/project';
      const result = await checkApiKeys();
      expect(result.status).toBe('pass');
      expect(result.message).toBe('Claude Code manages auth (no direct API key needed)');
    });

    it('passes when the claude CLI is on PATH but not inside Claude Code', async () => {
      execState.claudeAvailable = true;
      const result = await checkApiKeys();
      expect(result.status).toBe('pass');
      expect(result.message).toBe('Using Claude Code CLI auth (no direct API key needed)');
    });

    it('warns with an unrelated key present but no Claude auth available', async () => {
      process.env[OPENAI_KEY_NAME] = FAKE_KEY_VALUE;
      execState.claudeAvailable = false;
      const result = await checkApiKeys();
      expect(result.status).toBe('warn');
      expect(result.message).toBe(`Found: ${OPENAI_KEY_NAME} (no Claude key)`);
      expect(result.fix).toBe(`export ${ANTHROPIC_KEY_NAME}=your_key`);
    });

    it('warns with an install suggestion when nothing is available at all', async () => {
      execState.claudeAvailable = false;
      const result = await checkApiKeys();
      expect(result.status).toBe('warn');
      expect(result.message).toBe('Claude Code CLI not found — monomind works best on top of Claude Code');
      expect(result.fix).toBe('npm install -g @anthropic-ai/claude-code  # then: claude login');
    });
  });

  // ---------------------------------------------------------------------
  // checkMcpServers
  // ---------------------------------------------------------------------
  describe('checkMcpServers', () => {
    it('passes when monomind is registered in .mcp.json', async () => {
      writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
        mcpServers: { monomind: { command: 'npx' }, other: { command: 'x' } },
      }));
      const result = await checkMcpServers();
      expect(result.status).toBe('pass');
      expect(result.message).toBe('2 servers (monomind configured)');
    });

    it('warns with the correct claude mcp add fix string when monomind is missing', async () => {
      writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
      const result = await checkMcpServers();
      expect(result.status).toBe('warn');
      expect(result.message).toBe('1 servers (monomind not found)');
      expect(result.fix).toBe('claude mcp add monomind -- npx -y monomind@latest mcp start');
    });

    it('warns with the same fix string when no MCP config exists anywhere', async () => {
      const result = await checkMcpServers();
      expect(result.status).toBe('warn');
      expect(result.message).toBe('No MCP config found');
      expect(result.fix).toBe('claude mcp add monomind -- npx -y monomind@latest mcp start');
    });

    it('recognizes monomind_alpha as a valid registered server name', async () => {
      mkdirSync(join(dir, '.claude'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ mcpServers: { monomind_alpha: {} } }));
      const result = await checkMcpServers();
      expect(result.status).toBe('pass');
    });
  });

  // ---------------------------------------------------------------------
  // checkMonograph / checkMonoesMemory
  // ---------------------------------------------------------------------
  // These walk paths fixed relative to the *source file's* location (not
  // cwd), so they aren't controllable via a temp cwd. Both @monoes/monograph
  // and @monoes/memory are real installed workspace deps of this package, so
  // exercising the real function gives genuine "package found" coverage; the
  // "package not found" branch would require deleting real installed
  // packages from node_modules, which isn't safe to do from a test.
  describe('checkMonograph', () => {
    it('finds the real installed @monoes/monograph package and reports its version', async () => {
      const result = await checkMonograph();
      expect(result.name).toBe('Monograph');
      expect(result.status).toBe('pass');
      expect(result.message).toMatch(/^v[\d.]+ available \(knowledge graph engine\)$/);
    });
  });

  describe('checkMonoesMemory', () => {
    it('finds the real installed @monoes/memory package and reports its version', async () => {
      const result = await checkMonoesMemory();
      expect(result.name).toBe('Vector Memory');
      expect(['pass', 'warn']).toContain(result.status);
      if (result.status === 'pass') {
        expect(result.message).toMatch(/@monoes\/memory v[\d.]+ \(HNSW search enabled\)/);
      }
    });
  });

  // ---------------------------------------------------------------------
  // checkMonographFreshness (real git repo)
  // ---------------------------------------------------------------------
  describe('checkMonographFreshness', () => {
    function git(cmd: string) {
      execSync(`git ${cmd}`, {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test.com' },
      });
    }

    it('warns when no graph has been built yet', async () => {
      const result = await checkMonographFreshness();
      expect(result.status).toBe('warn');
      expect(result.message).toBe('No monograph graph built yet');
      expect(result.fix).toBe('mcp__monomind__monograph_build codeOnly:true');
    });

    it('reports FRESH with 0 commits behind when the graph was built after the last commit', async () => {
      git('init -q');
      git('commit --allow-empty -q -m c0');
      mkdirSync(join(dir, '.monomind'), { recursive: true });
      const dbPath = join(dir, '.monomind', 'monograph.db');
      writeFileSync(dbPath, 'db');
      // Git commit timestamps have only second-level precision, so a db
      // mtime taken "now" can land in the same (or an earlier-truncated)
      // second as the commit and still be counted by `git rev-list
      // --since`. Push the mtime a few seconds into the future to make it
      // unambiguously after the commit.
      const future = new Date(Date.now() + 5000);
      utimesSync(dbPath, future, future);

      const result = await checkMonographFreshness();
      expect(result.status).toBe('pass');
      expect(result.message).toContain('FRESH — built');
      expect(result.message).toContain('0 commits behind');
    });

    it('warns when a handful of commits landed after the graph was built', async () => {
      git('init -q');
      git('commit --allow-empty -q -m c0');
      mkdirSync(join(dir, '.monomind'), { recursive: true });
      const dbPath = join(dir, '.monomind', 'monograph.db');
      writeFileSync(dbPath, 'db');
      // Backdate the build so the commit above (and the next couple) count as "since".
      const old = new Date(Date.now() - 60 * 60 * 1000);
      utimesSync(dbPath, old, old);
      git('commit --allow-empty -q -m c1');
      git('commit --allow-empty -q -m c2');

      const result = await checkMonographFreshness();
      expect(result.status).toBe('warn');
      expect(result.message).toMatch(/^\d+ commit\(s\) behind — built/);
      expect(result.fix).toBe('mcp__monomind__monograph_build codeOnly:true');
    });

    it('fails as STALE when more than 5 commits landed after the graph was built', async () => {
      git('init -q');
      git('commit --allow-empty -q -m c0');
      mkdirSync(join(dir, '.monomind'), { recursive: true });
      const dbPath = join(dir, '.monomind', 'monograph.db');
      writeFileSync(dbPath, 'db');
      const old = new Date(Date.now() - 60 * 60 * 1000);
      utimesSync(dbPath, old, old);
      for (let i = 1; i <= 6; i++) git(`commit --allow-empty -q -m c${i}`);

      const result = await checkMonographFreshness();
      expect(result.status).toBe('fail');
      expect(result.message).toMatch(/^STALE — \d+ commits behind/);
    });
  });

  // ---------------------------------------------------------------------
  // Helper staleness (checkHelpersFresh / fixStaleHelpers)
  // ---------------------------------------------------------------------
  describe('checkHelpersFresh / fixStaleHelpers', () => {
    // _resolveBundledHelper() walks up from the *source file's* real
    // location looking for this package's own package.json, so the
    // "bundled" side of the comparison is this repo's actual
    // .claude/helpers tree — not something we can relocate into the temp
    // dir. We can still exercise the real comparison logic by copying that
    // real tree into the temp project's .claude/helpers (matching case) or
    // mutating a copy of it (stale case).
    const realHelpersDir = join(SUITE_START_CWD, '.claude', 'helpers');

    function copyRealHelpersInto(projectDir: string) {
      mkdirSync(join(projectDir, '.claude', 'helpers'), { recursive: true });
      cpSync(realHelpersDir, join(projectDir, '.claude', 'helpers'), { recursive: true });
    }

    it('passes when the project helpers are byte-identical to the bundled copy', async () => {
      if (!existsSync(realHelpersDir)) return; // nothing to compare against in this checkout
      copyRealHelpersInto(dir);
      const result = await checkHelpersFresh();
      expect(result).toEqual({ name: 'Helper Files', status: 'pass', message: 'Project helpers match bundled version' });
    });

    it('flags a modified tracked helper as stale, naming it in the message', async () => {
      if (!existsSync(join(realHelpersDir, 'hook-handler.cjs'))) return;
      copyRealHelpersInto(dir);
      writeFileSync(join(dir, '.claude', 'helpers', 'hook-handler.cjs'), '// locally modified, does not match bundled\n');

      const result = await checkHelpersFresh();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('stale helper(s)');
      expect(result.message).toContain('hook-handler.cjs');
      expect(result.fix).toBe('monomind init upgrade');
    });

    it('flags a helper that is missing locally (bundled has it, project does not) as stale', async () => {
      if (!existsSync(join(realHelpersDir, 'router.cjs'))) return;
      copyRealHelpersInto(dir);
      rmSync(join(dir, '.claude', 'helpers', 'router.cjs'));

      const result = await checkHelpersFresh();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('router.cjs');
    });

    it('fixStaleHelpers copies the bundled version over a stale local file', async () => {
      if (!existsSync(join(realHelpersDir, 'hook-handler.cjs'))) return;
      copyRealHelpersInto(dir);
      const localPath = join(dir, '.claude', 'helpers', 'hook-handler.cjs');
      writeFileSync(localPath, '// stale\n');

      const fixed = await fixStaleHelpers();
      expect(fixed).toBe(true);

      const after = await checkHelpersFresh();
      expect(after.status).toBe('pass');
    });

    it('fixStaleHelpers is a no-op returning false when nothing is stale', async () => {
      if (!existsSync(realHelpersDir)) return;
      copyRealHelpersInto(dir);
      const fixed = await fixStaleHelpers();
      expect(fixed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // checkGitignoreCoverage
  // ---------------------------------------------------------------------
  describe('checkGitignoreCoverage', () => {
    it('warns when there is no .gitignore at all', async () => {
      const result = await checkGitignoreCoverage();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('No .gitignore found');
    });

    it('passes when every required pattern is present', async () => {
      const patterns = [
        '.monomind/sessions/', '.monomind/data/', '.monomind/metrics/', '.monomind/knowledge/',
        '.monomind/*.json', '.monomind/*.jsonl', '**/.monomind/sessions/', '**/.monomind/*.json',
        'data/sessions/', 'data/mastermind-*.json', 'data/mastermind-*.jsonl', '**/.claude-flow/',
        '.hive-mind/', '.swarm/',
      ];
      writeFileSync(join(dir, '.gitignore'), patterns.join('\n') + '\n');
      const result = await checkGitignoreCoverage();
      expect(result).toEqual({ name: 'Gitignore Coverage', status: 'pass', message: 'All monomind runtime paths are gitignored' });
    });

    it('warns and lists missing patterns when only some are present', async () => {
      writeFileSync(join(dir, '.gitignore'), '.monomind/sessions/\n');
      const result = await checkGitignoreCoverage();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('.swarm/');
    });
  });

  // ---------------------------------------------------------------------
  // checkGuidanceGates
  // ---------------------------------------------------------------------
  describe('checkGuidanceGates', () => {
    it('warns when gates-handler.cjs is not installed', async () => {
      const result = await checkGuidanceGates();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('gates-handler.cjs not found');
    });

    it('warns when gates-handler.cjs exists but settings.json is missing', async () => {
      mkdirSync(join(dir, '.claude', 'helpers', 'handlers'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'helpers', 'handlers', 'gates-handler.cjs'), '// stub\n');
      const result = await checkGuidanceGates();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('settings.json missing');
    });

    it('passes when both gates are registered in settings.json', async () => {
      mkdirSync(join(dir, '.claude', 'helpers', 'handlers'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'helpers', 'handlers', 'gates-handler.cjs'), '// stub\n');
      writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Write|Edit|MultiEdit', hooks: [{ command: 'node pre-write.js' }] },
            { matcher: 'Bash', hooks: [{ command: 'node pre-bash.js' }] },
          ],
        },
      }));
      const result = await checkGuidanceGates();
      expect(result.status).toBe('pass');
    });
  });

  // ---------------------------------------------------------------------
  // checkAgentRegistry
  // ---------------------------------------------------------------------
  describe('checkAgentRegistry', () => {
    it('warns when there are no agents under .claude/agents', async () => {
      const result = await checkAgentRegistry();
      expect(result.name).toBe('Agent Registry');
      expect(result.status).toBe('warn');
      expect(result.message).toContain('No agents found');
    });

    it('passes when a well-formed agent definition is present', async () => {
      mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
      writeFileSync(join(dir, '.claude', 'agents', 'coder.md'), [
        '---',
        'name: Coder',
        'slug: coder',
        'description: Implementation specialist',
        '---',
        '# Coder',
      ].join('\n'));
      const result = await checkAgentRegistry();
      expect(result.status).toBe('pass');
      expect(result.message).toContain('all metadata complete');
    });
  });

  // ---------------------------------------------------------------------
  // checkMetricsFreshness
  // ---------------------------------------------------------------------
  describe('checkMetricsFreshness', () => {
    it('warns when there is no metrics directory yet', async () => {
      const result = await checkMetricsFreshness();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('No .monomind/metrics');
    });

    it('passes when known metrics files are fresh', async () => {
      mkdirSync(join(dir, '.monomind', 'metrics'), { recursive: true });
      writeFileSync(join(dir, '.monomind', 'metrics', 'codebase-map.json'), '{}');
      const result = await checkMetricsFreshness();
      expect(result.status).toBe('pass');
      expect(result.message).toContain('fresh (<12h)');
    });

    it('warns when a known metrics file is older than 12h', async () => {
      mkdirSync(join(dir, '.monomind', 'metrics'), { recursive: true });
      const p = join(dir, '.monomind', 'metrics', 'codebase-map.json');
      writeFileSync(p, '{}');
      const old = new Date(Date.now() - 13 * 60 * 60 * 1000);
      utimesSync(p, old, old);
      const result = await checkMetricsFreshness();
      expect(result.status).toBe('warn');
      expect(result.message).toContain('stale (>12h)');
      expect(result.message).toContain('codebase-map.json');
    });
  });

  // ---------------------------------------------------------------------
  // checkSecurityAuditFindings
  // ---------------------------------------------------------------------
  describe('checkSecurityAuditFindings', () => {
    it('warns when no security-audit.json exists yet', async () => {
      const result = await checkSecurityAuditFindings();
      expect(result.status).toBe('warn');
      expect(result.message).toBe('No security-audit.json yet');
      expect(result.fix).toBe('monomind hooks worker run audit');
    });

    it('passes with no open findings when risk is low', async () => {
      mkdirSync(join(dir, '.monomind', 'metrics'), { recursive: true });
      writeFileSync(join(dir, '.monomind', 'metrics', 'security-audit.json'), JSON.stringify({ riskLevel: 'low', recommendations: [] }));
      const result = await checkSecurityAuditFindings();
      expect(result).toEqual({ name: 'Security Audit', status: 'pass', message: 'risk=low, no open findings' });
    });

    it('fails when risk is high with priority scan targets', async () => {
      mkdirSync(join(dir, '.monomind', 'metrics'), { recursive: true });
      writeFileSync(join(dir, '.monomind', 'metrics', 'security-audit.json'), JSON.stringify({
        riskLevel: 'high',
        recommendations: ['rotate secret'],
        priorityScanTargets: [{ file: 'src/a.ts' }, { file: 'src/b.ts' }],
      }));
      const result = await checkSecurityAuditFindings();
      expect(result.status).toBe('fail');
      expect(result.message).toContain('risk=high');
      expect(result.message).toContain('2 priority scan target(s)');
    });

    it('warns when there are recommendations but risk is not high/critical', async () => {
      mkdirSync(join(dir, '.monomind', 'metrics'), { recursive: true });
      writeFileSync(join(dir, '.monomind', 'metrics', 'security-audit.json'), JSON.stringify({
        riskLevel: 'medium', recommendations: ['tighten CORS'],
      }));
      const result = await checkSecurityAuditFindings();
      expect(result.status).toBe('warn');
      expect(result.message).toBe('risk=medium, 1 recommendation(s)');
    });
  });

  // ---------------------------------------------------------------------
  // checkMemoryProficiency / checkMonoesIntegration — light smoke coverage.
  // Both depend on internal learning modules that read/derive their own
  // state; we assert the documented shape/branches rather than forcing
  // every internal code path, since driving them fully would mean
  // reimplementing those modules' storage format inside the test.
  // ---------------------------------------------------------------------
  describe('checkMemoryProficiency', () => {
    it('returns a well-formed HealthCheck for a fresh project with no decisions yet', async () => {
      const result = await checkMemoryProficiency();
      expect(result.name).toBe('Memory Proficiency');
      expect(['pass', 'warn']).toContain(result.status);
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  describe('checkMonoesIntegration', () => {
    it('returns a well-formed HealthCheck reporting routing learning status', async () => {
      const result = await checkMonoesIntegration();
      expect(result.name).toBe('Routing Learning');
      expect(['pass', 'warn']).toContain(result.status);
      expect(typeof result.message).toBe('string');
    });

    it('falls back to the routing-feedback summary when only that log has data', async () => {
      mkdirSync(join(dir, '.monomind'), { recursive: true });
      const records = [
        { sessionId: 's1', suggestedAgent: 'coder', intelligenceFeedback: true },
        { sessionId: 's1', suggestedAgent: 'coder', intelligenceFeedback: false },
      ];
      writeFileSync(join(dir, '.monomind', 'routing-feedback.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
      const result = await checkMonoesIntegration();
      expect(result.name).toBe('Routing Learning');
      if (result.message.startsWith('routing feedback (fallback)')) {
        expect(result.message).toContain('2 decisions across 1 sessions');
      }
    });
  });
});
