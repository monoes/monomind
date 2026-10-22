/**
 * Rev 16 init targets for the coder-mode runtimes: `--target cline` writes
 * `.clinerules/monomind.md` and names the user-scope MCP command;
 * `--target aider` writes CONVENTIONS.md (the aider adapter) plus a
 * `.aider.conf.yml` whose `read:` loads it, merged into an existing file.
 * Neither is part of `--target all`.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { resolveInitOptions } from '../src/init/resolve-options.js';
import type { InitOptions, InitResult } from '../src/init/types.js';
import { generateAgentsOnlyMd } from '../src/init/write-agents.js';
import { mergeAiderRead, writeAiderConf } from '../src/init/write-aider.js';
import { CLINE_MCP_INSTALL_COMMAND, writeClineFiles } from '../src/init/write-cline.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

output.setVerbosity('quiet');

// Same child_process stand-in as init-e2e.test.ts: init's best-effort npx
// side calls fail fast instead of touching the network.
vi.mock('child_process', () => {
  const fail = () => {
    throw new Error('mocked: no real process execution in tests');
  };
  return {
    execSync: vi.fn(fail),
    execFileSync: vi.fn(fail),
    exec: vi.fn(fail),
    execFile: vi.fn(fail),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
      proc.unref = () => {};
      proc.kill = () => {};
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      return proc;
    }),
  };
});

const ctxFor = (cwd: string, flags: Record<string, unknown>): CommandContext => ({
  args: [],
  flags: { _: [], 'no-watch': true, 'no-start-all': true, ...flags },
  cwd,
  interactive: false,
});

function emptyResult(): InitResult {
  return {
    success: true,
    platform: {} as InitResult['platform'],
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

describe('resolveInitOptions: cline and aider targets', () => {
  const opts = (flags: Record<string, unknown>): InitOptions => {
    const r = resolveInitOptions(ctxFor('/x', flags), '/x');
    if (!r.ok) throw new Error(r.message);
    return r.options;
  };

  it('--target cline selects only the cline writer', () => {
    const o = opts({ target: 'cline' });
    expect(o.components.cline).toBe(true);
    expect(o.selectedPlatforms).toEqual([]);
    expect(o.components.codex).toBe(false);
    expect(o.components.claudeMd).toBe(false);
  });

  it('--target aider selects the aider adapter', () => {
    const o = opts({ target: 'aider' });
    expect(o.selectedPlatforms).toEqual(['aider']);
    expect(o.components.cline).toBe(false);
    expect(o.components.settings).toBe(false);
  });

  it('--target all leaves both out', () => {
    const o = opts({ target: 'all' });
    expect(o.components.cline).toBe(false);
    expect(o.selectedPlatforms).not.toContain('aider');
    expect(o.components.agentsOnly).toBe(false);
  });

  it('--target agents selects AGENTS.md only: no platform, no Claude component', () => {
    const o = opts({ target: 'agents' });
    expect(o.components.agentsOnly).toBe(true);
    expect(o.selectedPlatforms).toEqual([]);
    expect(o.components.claudeMd).toBe(false);
    expect(o.components.settings).toBe(false);
    expect(o.components.mcp).toBe(false);
    expect(o.components.codex).toBe(false);
  });
});

describe('mergeAiderRead', () => {
  it.each([
    ['', 'read: [CONVENTIONS.md]\n'],
    ['model: x', 'model: x\nread: [CONVENTIONS.md]\n'],
    ['read: NOTES.md\n', 'read: [NOTES.md, CONVENTIONS.md]\n'],
    ['read: [a.md, "b.md"]\n', 'read: [a.md, "b.md", CONVENTIONS.md]\n'],
    ['read: []\n', 'read: [CONVENTIONS.md]\n'],
    ['read:\n  - a.md\nmodel: x\n', 'read:\n  - a.md\n  - CONVENTIONS.md\nmodel: x\n'],
  ])('%j → %j', (input, expected) => {
    expect(mergeAiderRead(input)).toBe(expected);
  });

  it('leaves a read that already names CONVENTIONS.md unchanged', () => {
    for (const t of ['read: CONVENTIONS.md\n', 'read: [a, CONVENTIONS.md]\n', 'read:\n- CONVENTIONS.md\n'])
      expect(mergeAiderRead(t)).toBe(t);
  });

  it('refuses shapes it cannot edit safely', () => {
    expect(mergeAiderRead('read: a.md # mine\n')).toBeNull();
    expect(mergeAiderRead('read:\n  key: v\n')).toBeNull();
    expect(mergeAiderRead('read: {a: b}\n')).toBeNull();
  });
});

describe('init writers', () => {
  let dir: string;
  const base = { force: false } as InitOptions;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-coder-targets-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('aider: creates, merges, and respects --if-missing', async () => {
    const conf = path.join(dir, '.aider.conf.yml');
    let r = emptyResult();
    await writeAiderConf(dir, base, r);
    expect(fs.readFileSync(conf, 'utf8')).toBe('read: [CONVENTIONS.md]\n');
    expect(r.created.files).toEqual(['.aider.conf.yml']);

    fs.writeFileSync(conf, 'model: gpt\nread: NOTES.md\n');
    r = emptyResult();
    await writeAiderConf(dir, { ...base, ifMissing: true }, r);
    expect(fs.readFileSync(conf, 'utf8')).toBe('model: gpt\nread: NOTES.md\n');
    await writeAiderConf(dir, base, r);
    expect(fs.readFileSync(conf, 'utf8')).toBe('model: gpt\nread: [NOTES.md, CONVENTIONS.md]\n');

    fs.writeFileSync(conf, 'read: a.md # keep\n');
    r = emptyResult();
    await writeAiderConf(dir, base, r);
    expect(fs.readFileSync(conf, 'utf8')).toBe('read: a.md # keep\n');
    expect(r.warnings?.[0]).toContain('CONVENTIONS.md');
  });

  it('cline: writes the rule once, keeps an edited one without --force', async () => {
    const rule = path.join(dir, '.clinerules', 'monomind.md');
    let r = emptyResult();
    await writeClineFiles(dir, base, r);
    expect(fs.readFileSync(rule, 'utf8')).toContain('monomind');
    expect(r.created.files).toEqual(['.clinerules/monomind.md']);
    expect(r.warnings?.[0]).toContain(CLINE_MCP_INSTALL_COMMAND);

    fs.writeFileSync(rule, 'mine');
    r = emptyResult();
    await writeClineFiles(dir, base, r);
    expect(fs.readFileSync(rule, 'utf8')).toBe('mine');
    await writeClineFiles(dir, { ...base, force: true }, r);
    expect(fs.readFileSync(rule, 'utf8')).toContain('monomind');
  });

  it('cline: a single-file .clinerules is left alone', async () => {
    fs.writeFileSync(path.join(dir, '.clinerules'), 'user rules');
    const r = emptyResult();
    await writeClineFiles(dir, base, r);
    expect(fs.readFileSync(path.join(dir, '.clinerules'), 'utf8')).toBe('user rules');
    expect(r.created.files).toEqual([]);
  });
});

describe('monomind init --target cline|aider|agents (real fs)', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-coder-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-coder-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    try {
      const bridge = await import('../src/memory/memory-bridge.js');
      await bridge.shutdownBridge();
    } catch {}
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('--target cline writes the rule and nothing for other runtimes', async () => {
    const result = await initCommand.action!(ctxFor(tmpDir, { target: 'cline', 'no-graph': true }));
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, '.clinerules', 'monomind.md'), 'utf8')).toContain(
      'monomind',
    );
    expect(fs.existsSync(path.join(tmpDir, '.aider.conf.yml'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.codex'))).toBe(false);
    // init never registers MCP in the user's own ~/.cline.
    expect(fs.existsSync(path.join(fakeHome, '.cline'))).toBe(false);
  }, 120_000);

  it('--target agents writes AGENTS.md and nothing else (idempotent, keeps a user file)', async () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    const run = () =>
      initCommand.action!(ctxFor(tmpDir, { target: 'agents', 'if-missing': true, 'no-graph': true }));
    const first = await run();
    expect(first.success).toBe(true);
    expect(fs.readdirSync(tmpDir).sort()).toEqual(['.git', 'AGENTS.md']);
    expect(fs.readdirSync(path.join(tmpDir, '.git'))).toEqual([]);
    const body = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    expect(body).toBe(generateAgentsOnlyMd());
    expect(body).not.toMatch(/\.codex|CLAUDE\.md|\.claude\//);
    // Nothing in the user's home either (no project registry, no ~/.claude).
    expect(fs.readdirSync(fakeHome)).toEqual([]);

    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'mine');
    const second = await run();
    expect(second.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8')).toBe('mine');
    expect(fs.readdirSync(tmpDir).sort()).toEqual(['.git', 'AGENTS.md']);
  }, 120_000);

  it('--target agents --json reports only AGENTS.md, then nothing on a second run', async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
      writes.push(String(c));
      return true;
    });
    try {
      const flags = { target: 'agents', 'if-missing': true, json: true };
      await initCommand.action!(ctxFor(tmpDir, flags));
      await initCommand.action!(ctxFor(tmpDir, flags));
    } finally {
      spy.mockRestore();
    }
    const [a, b] = writes.map((w) => JSON.parse(w));
    expect(a).toMatchObject({ created: ['AGENTS.md'], skipped: [] });
    expect(b).toMatchObject({ created: [], skipped: ['AGENTS.md'] });
    expect(fs.readdirSync(tmpDir)).toEqual(['AGENTS.md']);
  }, 120_000);

  it('--target aider writes CONVENTIONS.md and a read: entry for it', async () => {
    const result = await initCommand.action!(ctxFor(tmpDir, { target: 'aider', 'no-graph': true }));
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'CONVENTIONS.md'), 'utf8')).toContain('monomind');
    expect(fs.readFileSync(path.join(tmpDir, '.aider.conf.yml'), 'utf8')).toBe(
      'read: [CONVENTIONS.md]\n',
    );
    expect(fs.existsSync(path.join(tmpDir, '.clinerules'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(false);
  }, 120_000);
});
