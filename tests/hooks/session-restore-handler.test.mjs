/**
 * Tests for .claude/helpers/handlers/session-restore-handler.cjs
 * Covers: neural kill switch, daemon detection, registry surfacing,
 *         update notification, knowledge preload, stale helper warning.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const _savedHookQuiet = process.env.MONOMIND_HOOK_QUIET;

// ── Minimal hCtx factory ─────────────────────────────────────────────────────

function makeHCtx(overrides = {}) {
  const cwd = overrides.CWD || os.tmpdir();
  return {
    hookInput: {},
    session: null,
    intelligence: null,
    CWD: cwd,
    helpersDir: overrides.helpersDir || cwd, // non-existent subdir so dynamic imports fail safely
    runWithTimeout: async (fn) => {
      try {
        return await fn();
      } catch {
        return null;
      }
    },
    _openMonographDb: () => null,
    _autoIndexKnowledge: () => 0,
    _buildKnowledgeSearchFn: () => async () => [],
    getMonographSuggestions: () => [],
    get _hooksModule() {
      return null;
    },
    set _hooksModule(_) {},
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadHandler() {
  const handlerPath = path.resolve(
    __dirname,
    '../../.claude/helpers/handlers/session-restore-handler.cjs',
  );
  delete require.cache[handlerPath];
  return require(handlerPath);
}

// Capture console.log output during a handler run
async function runCapture(hCtx) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  try {
    const handler = loadHandler();
    await handler.handleRestore(hCtx);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return lines;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('session-restore-handler', () => {
  let tmpDir;

  beforeEach(() => {
    delete process.env.MONOMIND_HOOK_QUIET;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'));
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    if (_savedHookQuiet !== undefined) process.env.MONOMIND_HOOK_QUIET = _savedHookQuiet;
    else delete process.env.MONOMIND_HOOK_QUIET;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('completes without error when all subsystems are absent', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    await expect(runCapture(hCtx)).resolves.toBeInstanceOf(Array);
  });

  it('logs session restored when no session module is provided', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, session: null });
    const lines = await runCapture(hCtx);
    const sessionLine = lines.find((l) => l.includes('Session restored') || l.includes('[OK]'));
    expect(sessionLine).toBeTruthy();
  });

  it('calls session.restore() when session module is present', async () => {
    let restoreCalled = false;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      session: {
        restore: () => {
          restoreCalled = true;
          return true;
        },
      },
    });
    await runCapture(hCtx);
    expect(restoreCalled).toBe(true);
  });

  it('skips intelligence init when monomind.neural.enabled=false', async () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ monomind: { neural: { enabled: false } } }));
    let initCalled = false;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      intelligence: {
        init: () => {
          initCalled = true;
          return { nodes: 5, edges: 3 };
        },
      },
    });
    const lines = await runCapture(hCtx);
    expect(initCalled).toBe(false);
    const neuralLine = lines.find((l) => l.includes('[NEURAL]'));
    expect(neuralLine).toContain('Disabled');
  });

  it('runs intelligence init when neural kill switch is absent', async () => {
    let initCalled = false;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      intelligence: {
        init: () => {
          initCalled = true;
          return { nodes: 5, edges: 3 };
        },
      },
    });
    await runCapture(hCtx);
    expect(initCalled).toBe(true);
  });

  it('logs [INTELLIGENCE] Loaded when init returns nodes', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      intelligence: { init: () => ({ nodes: 42, edges: 10 }) },
    });
    const lines = await runCapture(hCtx);
    const intelLine = lines.find((l) => l.includes('[INTELLIGENCE]') && l.includes('42'));
    expect(intelLine).toBeTruthy();
  });

  it('surfaces [REGISTRY] count when registry.json has agents', async () => {
    const regPath = path.join(tmpDir, '.monomind', 'registry.json');
    fs.writeFileSync(regPath, JSON.stringify({ agents: ['a', 'b', 'c'] }));
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    const regLine = lines.find((l) => l.includes('[REGISTRY]'));
    expect(regLine).toBeTruthy();
    expect(regLine).toContain('3');
  });

  it('does not log [REGISTRY] when registry.json is absent', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    expect(lines.find((l) => l.includes('[REGISTRY]'))).toBeUndefined();
  });

  it('surfaces [AGENT_RUNTIMES] with installed, exec-supported runtimes from the scan cache', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'agent-runtimes.json'),
      JSON.stringify({
        v: 1,
        agents: [
          { id: 'codex', installed: true, execution_supported: true },
          { id: 'antigravity', installed: true, execution_supported: true },
          { id: 'freebuff', installed: false, execution_supported: false },
          { id: 'grok', installed: true, execution_supported: false },
        ],
      }),
    );
    const lines = await runCapture(makeHCtx({ CWD: tmpDir }));
    const rtLine = lines.find((l) => l.includes('[AGENT_RUNTIMES]'));
    expect(rtLine).toContain('codex, antigravity');
    expect(rtLine).not.toContain('freebuff');
    expect(rtLine).not.toContain('grok');
  });

  it('surfaces [UPDATE_AVAILABLE] when pending-update.json has from≠to', async () => {
    const updatePath = path.join(tmpDir, '.monomind', 'pending-update.json');
    fs.writeFileSync(updatePath, JSON.stringify({ from: '1.10.28', to: '1.10.29' }));
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    const updateLine = lines.find((l) => l.includes('[UPDATE_AVAILABLE]'));
    expect(updateLine).toBeTruthy();
    expect(updateLine).toContain('1.10.28');
  });

  it('does not log [UPDATE_AVAILABLE] when from===to', async () => {
    const updatePath = path.join(tmpDir, '.monomind', 'pending-update.json');
    fs.writeFileSync(updatePath, JSON.stringify({ from: '1.10.29', to: '1.10.29' }));
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    expect(lines.find((l) => l.includes('[UPDATE_AVAILABLE]'))).toBeUndefined();
  });

  it('logs [KNOWLEDGE_INDEXED] when _autoIndexKnowledge returns > 0', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, _autoIndexKnowledge: () => 7 });
    const lines = await runCapture(hCtx);
    const kLine = lines.find((l) => l.includes('[KNOWLEDGE_INDEXED]'));
    expect(kLine).toBeTruthy();
    expect(kLine).toContain('7');
  });

  it('does not log [KNOWLEDGE_INDEXED] when autoIndex returns 0', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, _autoIndexKnowledge: () => 0 });
    const lines = await runCapture(hCtx);
    expect(lines.find((l) => l.includes('[KNOWLEDGE_INDEXED]'))).toBeUndefined();
  });

  it('logs [KNOWLEDGE_PRELOADED] when search fn returns results', async () => {
    const mockResult = [{ key: 'c1', value: 'some text', score: 0.8, metadata: {} }];
    const hCtx = makeHCtx({
      CWD: tmpDir,
      _buildKnowledgeSearchFn: () => async () => mockResult,
    });
    const lines = await runCapture(hCtx);
    const kLine = lines.find((l) => l.includes('[KNOWLEDGE_PRELOADED]'));
    expect(kLine).toBeTruthy();
    expect(kLine).toContain('1');
  });

  it('handles session module that throws without crashing handler', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      session: {
        restore: () => {
          throw new Error('db locked');
        },
      },
    });
    await expect(runCapture(hCtx)).resolves.toBeInstanceOf(Array);
  });

  it('writes last-update-check.json on first run', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    await runCapture(hCtx);
    const checkPath = path.join(tmpDir, '.monomind', 'last-update-check.json');
    expect(fs.existsSync(checkPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(checkPath, 'utf-8'));
    expect(data.timestamp).toBeTruthy();
  });

  it('skips update check when last-update-check.json is < 24h old', async () => {
    const checkPath = path.join(tmpDir, '.monomind', 'last-update-check.json');
    fs.writeFileSync(checkPath, JSON.stringify({ timestamp: new Date().toISOString() }));
    const mtime = fs.statSync(checkPath).mtimeMs;
    const hCtx = makeHCtx({ CWD: tmpDir });
    await runCapture(hCtx);
    // File should not have been rewritten (mtime unchanged)
    expect(fs.statSync(checkPath).mtimeMs).toBe(mtime);
  });

  it('suppresses [STALE_HELPERS] when running inside the monomind dev repo', async () => {
    // Create the dev-repo sentinels the handler checks for: BOTH
    // packages/@monomind/cli/package.json AND packages/@monomind/cli/.claude/helpers.
    // The handler requires both to avoid false positives; the real dev repo has both.
    fs.mkdirSync(path.join(tmpDir, 'packages', '@monomind', 'cli', '.claude', 'helpers'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, 'packages', '@monomind', 'cli', 'package.json'),
      '{"version":"1.0.0"}',
    );
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    expect(lines.find((l) => l.includes('[STALE_HELPERS]'))).toBeUndefined();
  });

  it('does not probe [CONTROL_UI] when daemon.pid and monomind.config.json are both absent', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    expect(lines.find((l) => l.includes('[CONTROL_UI]'))).toBeUndefined();
  });

  it('completes without error when monomind.config.json exists (probe condition)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'monomind.config.json'), JSON.stringify({ daemon: {} }));
    const hCtx = makeHCtx({ CWD: tmpDir });
    // The http probe is async fire-and-forget; handler must not throw synchronously
    await expect(runCapture(hCtx)).resolves.toBeInstanceOf(Array);
  });

  // The CLI keys the knowledge store to the PROJECT ROOT, so a session started
  // in a package subdirectory finds no doc-metadata.jsonl under CWD. Before the
  // git-root fallback, that silently disabled re-ingestion forever — no error,
  // no log line, the Second Brain just stopped noticing changed documents.
  describe('knowledge reindex root resolution', () => {
    /** Metadata written LAST, so no document looks newer and no ingest spawns. */
    const seedKnowledge = (root) => {
      fs.writeFileSync(path.join(root, 'notes.md'), '# notes\n');
      const kdir = path.join(root, '.monomind', 'knowledge');
      fs.mkdirSync(kdir, { recursive: true });
      fs.writeFileSync(
        path.join(kdir, 'doc-metadata.jsonl'),
        `${JSON.stringify({
          filePath: path.join(root, 'notes.md'),
          contentHash: 'h',
          chunkCount: 1,
          indexedAt: '2026-07-28T00:00:00Z',
          scope: 'shared',
          size: 8,
        })}\n`,
      );
    };

    it('finds the knowledge base from a package subdirectory', async () => {
      const root = tmpDir;
      seedKnowledge(root);
      const sub = path.join(root, 'packages', 'cli');
      fs.mkdirSync(sub, { recursive: true });

      await runCapture(makeHCtx({ CWD: sub }));

      // The rate-limit marker is written at the resolved root before scanning —
      // its presence there (and absence under the subdir) proves the fallback ran.
      expect(fs.existsSync(path.join(root, '.monomind', 'knowledge', 'reindex-check.json'))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(sub, '.monomind', 'knowledge', 'reindex-check.json'))).toBe(
        false,
      );
    });

    it('still prefers CWD when it has its own knowledge base', async () => {
      const root = tmpDir;
      seedKnowledge(root);
      const nested = path.join(root, 'nested');
      fs.mkdirSync(nested, { recursive: true });
      seedKnowledge(nested);

      await runCapture(makeHCtx({ CWD: nested }));

      // Nearest wins: a directory with its own brain is not redirected upward.
      expect(fs.existsSync(path.join(nested, '.monomind', 'knowledge', 'reindex-check.json'))).toBe(
        true,
      );
      expect(fs.existsSync(path.join(root, '.monomind', 'knowledge', 'reindex-check.json'))).toBe(
        false,
      );
    });

    // #416: the background reindex ran `npx -y monomind@latest doc ingest .`
    // over the whole repo — a different version than installed, and 2,400
    // files incl. package READMEs, duplicates and org run logs.
    describe('reindex command', () => {
      const cmd = (root, pathEnv = '') => loadHandler().knowledgeIngestCommand(root, pathEnv);
      const layout = (root) => {
        fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
        fs.mkdirSync(path.join(root, 'doc'), { recursive: true });
        fs.mkdirSync(path.join(root, 'packages', 'x'), { recursive: true });
        fs.writeFileSync(path.join(root, 'README.md'), '# r\n');
        fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# c\n');
        fs.writeFileSync(path.join(root, 'notes.txt'), 'n\n');
        fs.writeFileSync(path.join(root, 'packages', 'x', 'README.md'), '# x\n');
      };

      it('uses the project-local binary and scoped paths', () => {
        layout(tmpDir);
        const bin = path.join(tmpDir, 'node_modules', '.bin', 'monomind');
        fs.mkdirSync(path.dirname(bin), { recursive: true });
        fs.writeFileSync(bin, '#!/bin/sh\n');
        const c = cmd(tmpDir);
        expect(c.cmd).toBe(bin);
        expect(c.args).toEqual(['doc', 'ingest', 'docs', 'doc', 'CHANGELOG.md', 'README.md']);
        expect(c.targets).toEqual(['docs', 'doc', 'CHANGELOG.md', 'README.md']);
        expect(JSON.stringify(c)).not.toContain('npx');
        expect(JSON.stringify(c)).not.toContain('@latest');
      });

      it('falls back to the monorepo CLI entry with node', () => {
        layout(tmpDir);
        const cli = path.join(tmpDir, 'packages', '@monomind', 'cli', 'bin', 'cli.js');
        fs.mkdirSync(path.dirname(cli), { recursive: true });
        fs.writeFileSync(cli, '');
        const c = cmd(tmpDir);
        expect(c.cmd).toBe(process.execPath);
        expect(c.args.slice(0, 3)).toEqual([cli, 'doc', 'ingest']);
      });

      it('returns null with no installed binary (never npx)', () => {
        layout(tmpDir);
        expect(cmd(tmpDir)).toBeNull();
      });

      it('returns null when there is nothing in scope to ingest', () => {
        const bin = path.join(tmpDir, 'node_modules', '.bin', 'monomind');
        fs.mkdirSync(path.dirname(bin), { recursive: true });
        fs.writeFileSync(bin, '#!/bin/sh\n');
        expect(cmd(tmpDir)).toBeNull();
      });
    });

    it('does nothing when no knowledge base exists anywhere', async () => {
      const root = tmpDir;
      const sub = path.join(root, 'packages', 'cli');
      fs.mkdirSync(sub, { recursive: true });

      await runCapture(makeHCtx({ CWD: sub }));

      expect(fs.existsSync(path.join(root, '.monomind', 'knowledge', 'reindex-check.json'))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(sub, '.monomind', 'knowledge', 'reindex-check.json'))).toBe(
        false,
      );
    });
  });
});

// ── Skill registry freshness ────────────────────────────────────────────────

describe('session-restore skill registry refresh', () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srh-skillreg-'));
    const skill = path.join(tmp, '.claude', 'skills', 'alpha-skill');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(
      path.join(skill, 'SKILL.md'),
      '---\nname: alpha-skill\ndescription: Alpha things\n---\n# Alpha\n',
    );
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('builds skill-registry.json when it is missing, without a registry.json', async () => {
    process.env.MONOMIND_HOOK_QUIET = '1';
    try {
      await loadHandler().handleRestore(makeHCtx({ CWD: tmp }));
    } finally {
      if (_savedHookQuiet !== undefined) process.env.MONOMIND_HOOK_QUIET = _savedHookQuiet;
      else delete process.env.MONOMIND_HOOK_QUIET;
    }
    const reg = JSON.parse(
      fs.readFileSync(path.join(tmp, '.claude', 'helpers', 'skill-registry.json'), 'utf-8'),
    );
    expect(reg.skills.map((s) => s.skill)).toContain('alpha-skill');
  });
});

// ── Token summary stays off the hot path (#403) ─────────────────────────────

describe('session-restore token summary (#403)', () => {
  let tmp;
  const savedConfigDir = process.env.CLAUDE_CONFIG_DIR;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srh-tokens-'));
  });
  afterEach(() => {
    if (savedConfigDir !== undefined) process.env.CLAUDE_CONFIG_DIR = savedConfigDir;
    else delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('writes token-summary.json from the cache without reading any transcript', async () => {
    // A large transcript tree: parsing it synchronously is what hung SessionStart.
    const home = path.join(tmp, 'claude-home');
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ type: 'user', timestamp: now, message: { role: 'user', content: 'hi' } }),
    ];
    for (let i = 0; i < 2000; i++) {
      lines.push(
        JSON.stringify({
          type: 'assistant',
          timestamp: now,
          message: {
            id: `m${i}`,
            model: 'claude-sonnet-4-5',
            usage: { input_tokens: 100, output_tokens: 50 },
            content: [{ type: 'text', text: 'x' }],
          },
        }),
      );
    }
    for (let f = 0; f < 20; f++) {
      const dir = path.join(home, 'projects', `proj-${f % 4}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `t${f}.jsonl`), `${lines.join('\n')}\n`);
    }
    const totals = { todayCost: 1.23, todayCalls: 7, monthCost: 45.6, monthCalls: 89 };
    fs.writeFileSync(
      path.join(home, '.monomind-token-summary.json'),
      JSON.stringify({ computedAt: Date.now(), totals }),
    );
    process.env.CLAUDE_CONFIG_DIR = home;

    // Only the real token tracker in helpersDir, so nothing else is pulled in.
    const helpersDir = path.join(tmp, 'helpers');
    fs.mkdirSync(helpersDir);
    fs.copyFileSync(
      path.resolve(__dirname, '../../.claude/helpers/token-tracker.cjs'),
      path.join(helpersDir, 'token-tracker.cjs'),
    );
    const cwd = path.join(tmp, 'project');
    fs.mkdirSync(path.join(cwd, '.monomind'), { recursive: true });

    let transcriptReads = 0;
    const cjsFs = require('node:fs');
    const cjsOrig = cjsFs.readFileSync;
    cjsFs.readFileSync = (file, ...rest) => {
      if (String(file).endsWith('.jsonl')) transcriptReads++;
      return cjsOrig.call(cjsFs, file, ...rest);
    };
    const started = Date.now();
    try {
      await runCapture(makeHCtx({ CWD: cwd, helpersDir }));
    } finally {
      cjsFs.readFileSync = cjsOrig;
    }
    expect(Date.now() - started).toBeLessThan(2000);
    expect(transcriptReads).toBe(0);

    const written = JSON.parse(
      fs.readFileSync(path.join(cwd, '.monomind', 'metrics', 'token-summary.json'), 'utf-8'),
    );
    expect(written).toMatchObject(totals);
  });
});
