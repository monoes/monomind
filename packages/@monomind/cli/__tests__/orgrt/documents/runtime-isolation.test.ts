// packages/@monomind/cli/__tests__/orgrt/documents/runtime-isolation.test.ts
// Sections orgs on every runtime: the registry of how each runtime keeps its
// native copies, the environment that points a role's runner at a private
// directory, and the staging of credentials into it by symlink. The real home
// is only ever read.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isolationEnv,
  RUNNER_DATA_DIR_ENV,
  RUNTIME_ISOLATION,
  runtimeIsolation,
  stageAuthFiles,
  usesPrivateDir,
} from '../../../src/orgrt/documents/runtime-isolation.js';
import { BASE_SPECS } from '../../../src/orgrt/runner-specs.js';

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'iso-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A listing of every path under `dir` with size and mtime, to prove nothing changed. */
const snapshot = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const s = lstatSync(p);
      out.push(`${p} ${s.size} ${s.mtimeMs}`);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out.sort();
};

describe('the registry', () => {
  const kinds = BASE_SPECS.map((s) => s.id);
  it('has exactly one entry per runtime kind', () => {
    expect(Object.keys(RUNTIME_ISOLATION).sort()).toEqual([...kinds].sort());
  });
  it.each(kinds)('%s: a complete, self-consistent entry', (kind) => {
    const e = RUNTIME_ISOLATION[kind];
    expect(['mask-bind', 'in-process', 'config-env', 'private-home', 'refused']).toContain(e.strategy);
    if (e.strategy === 'refused') expect(e.note).toMatch(/\S/);
    if (e.verified === 'unverified') expect(e.note ?? e.strategy).toBeTruthy();
    else {
      expect(e.verified.date).toMatch(/^\d{4}-\d\d-\d\d$/);
      expect(e.verified.cli).toMatch(/\S/);
    }
    if (e.strategy === 'config-env') {
      expect(e.configEnv).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(e.configDir).toBeTruthy();
      // staged files sit inside the directory the variable replaces
      for (const f of e.authFiles) expect(f.startsWith(`${e.configDir}/`)).toBe(true);
    }
    // no credential path may escape the home
    for (const f of e.authFiles) expect(f.startsWith('/') || f.includes('..')).toBe(false);
  });
  it('every verified CLI entry names its probe', () => {
    for (const [kind, e] of Object.entries(RUNTIME_ISOLATION)) {
      if (e.verified !== 'unverified' && e.strategy !== 'mask-bind' && e.strategy !== 'in-process')
        expect(e.probe?.command, kind).toMatch(/\S/);
    }
  });
  it('unverified entries are the CLIs that were not probed, never a verified one', () => {
    for (const kind of ['vercel', 'kimicode', 'qwen', 'qwen-rpc', 'cline', 'aider', 'dsh'])
      expect(RUNTIME_ISOLATION[kind as keyof typeof RUNTIME_ISOLATION].verified).toBe('unverified');
    for (const kind of ['claude', 'codex', 'antigravity', 'opencode', 'pi', 'pi-rpc', 'crush', 'grok', 'copilot', 'hermes'])
      expect(RUNTIME_ISOLATION[kind as keyof typeof RUNTIME_ISOLATION].verified).not.toBe('unverified');
  });
  it('an unknown runtime has no entry', () => {
    expect(runtimeIsolation('nope')).toBeUndefined();
  });
  it('an attached opencode server is refused: every role would share it', () => {
    expect(runtimeIsolation('opencode', {})?.strategy).toBe('private-home');
    const r = runtimeIsolation('opencode', { OPENCODE_URL: 'http://127.0.0.1:4096' });
    expect(r?.strategy).toBe('refused');
    expect(r?.note).toMatch(/OPENCODE_URL/);
  });
});

describe('isolationEnv', () => {
  it('config-env: names the directory by the CLI\'s own variable', () => {
    expect(isolationEnv(RUNTIME_ISOLATION.codex, '/p', '/h')).toEqual({ CODEX_HOME: '/p' });
    expect(isolationEnv(RUNTIME_ISOLATION.pi, '/p', '/h')).toEqual({ PI_CODING_AGENT_DIR: '/p' });
    expect(isolationEnv(RUNTIME_ISOLATION['pi-rpc'], '/p', '/h')).toEqual({ PI_CODING_AGENT_DIR: '/p' });
  });
  it('private-home: HOME and every XDG base point into the private directory', () => {
    expect(isolationEnv(RUNTIME_ISOLATION.antigravity, '/p', '/h')).toEqual({
      HOME: '/p',
      XDG_CONFIG_HOME: '/p/.config',
      XDG_DATA_HOME: '/p/.local/share',
      XDG_STATE_HOME: '/p/.local/state',
      XDG_CACHE_HOME: '/p/.cache',
    });
  });
  it('crush also gets the data directory its runner passes as --data-dir', () => {
    const env = isolationEnv(RUNTIME_ISOLATION.crush, '/p', '/h');
    expect(env.HOME).toBe('/p');
    expect(env[RUNNER_DATA_DIR_ENV]).toBe('/p/runner-data');
  });
  it('vercel (in-process) gets only the data directory its session store uses', () => {
    expect(isolationEnv(RUNTIME_ISOLATION.vercel, '/p', '/h')).toEqual({ [RUNNER_DATA_DIR_ENV]: '/p' });
    expect(usesPrivateDir(RUNTIME_ISOLATION.vercel)).toBe(true);
  });
  it('a pinned variable keeps pointing into the real home', () => {
    expect(isolationEnv(RUNTIME_ISOLATION.aider, '/p', '/real').UV_TOOL_DIR).toBe('/real/.local/share/uv/tools');
  });
  it('grok and hermes use their own variable, copilot a private home with the gh login staged', () => {
    expect(isolationEnv(RUNTIME_ISOLATION.grok, '/p', '/h')).toEqual({ GROK_HOME: '/p' });
    expect(isolationEnv(RUNTIME_ISOLATION.hermes, '/p', '/h')).toEqual({ HERMES_HOME: '/p' });
    expect(isolationEnv(RUNTIME_ISOLATION.copilot, '/p', '/h').HOME).toBe('/p');
    expect(RUNTIME_ISOLATION.copilot.authFiles).toContain('.config/gh/hosts.yml');
  });
  it('claude (masked), a refused runtime and an unknown one get no variables', () => {
    expect(isolationEnv(RUNTIME_ISOLATION.claude, '/p', '/h')).toEqual({});
    expect(isolationEnv({ ...RUNTIME_ISOLATION.codex, strategy: 'refused' }, '/p', '/h')).toEqual({});
    expect(isolationEnv(undefined, '/p', '/h')).toEqual({});
  });
  it('only config-env and private-home use a private directory', () => {
    expect(usesPrivateDir(RUNTIME_ISOLATION.codex)).toBe(true);
    expect(usesPrivateDir(RUNTIME_ISOLATION.crush)).toBe(true);
    expect(usesPrivateDir(RUNTIME_ISOLATION.claude)).toBe(false);
    expect(usesPrivateDir(undefined)).toBe(false);
  });
});

describe('stageAuthFiles', () => {
  let home: string;
  let dir: string;
  beforeEach(() => {
    home = join(base, 'home');
    dir = join(base, 'private');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex/auth.json'), '{"credential":"x"}', { mode: 0o600 });
    writeFileSync(join(home, '.codex/history.jsonl'), 'operator history');
  });

  it('links the credential file into the config directory and nothing else', () => {
    const staged = stageAuthFiles(RUNTIME_ISOLATION.codex, dir, home);
    expect(staged).toEqual([join(dir, 'auth.json')]);
    expect(lstatSync(join(dir, 'auth.json')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(dir, 'auth.json'))).toBe(join(home, '.codex/auth.json'));
    expect(readdirSync(dir)).toEqual(['auth.json']);
  });

  it('never writes, moves or deletes anything under the real home', () => {
    const before = snapshot(home);
    stageAuthFiles(RUNTIME_ISOLATION.codex, dir, home);
    stageAuthFiles(RUNTIME_ISOLATION.codex, dir, home);
    expect(snapshot(home)).toEqual(before);
    expect(readFileSync(join(home, '.codex/auth.json'), 'utf8')).toBe('{"credential":"x"}');
    expect(statSync(join(home, '.codex/auth.json')).mode & 0o777).toBe(0o600);
  });

  it('is idempotent and repairs a link that points elsewhere', () => {
    stageAuthFiles(RUNTIME_ISOLATION.codex, dir, home);
    rmSync(join(dir, 'auth.json'));
    symlinkSync('/nowhere', join(dir, 'auth.json'));
    stageAuthFiles(RUNTIME_ISOLATION.codex, dir, home);
    expect(readlinkSync(join(dir, 'auth.json'))).toBe(join(home, '.codex/auth.json'));
  });

  it('keeps a real file of the role\'s own where a link would go', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auth.json'), 'role own');
    stageAuthFiles(RUNTIME_ISOLATION.codex, dir, home);
    expect(lstatSync(join(dir, 'auth.json')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, 'auth.json'), 'utf8')).toBe('role own');
  });

  it('skips a credential file the operator does not have', () => {
    rmSync(join(home, '.codex/auth.json'));
    expect(stageAuthFiles(RUNTIME_ISOLATION.codex, dir, home)).toEqual([]);
    expect(existsSync(dir)).toBe(true);
  });

  it('private-home: stages at the same path under the private home and creates the XDG directories', () => {
    mkdirSync(join(home, '.config/opencode'), { recursive: true });
    writeFileSync(join(home, '.config/opencode/opencode.json'), '{}');
    const staged = stageAuthFiles(RUNTIME_ISOLATION.opencode, dir, home);
    expect(staged).toEqual([join(dir, '.config/opencode/opencode.json')]);
    for (const sub of ['.config', '.local/share', '.local/state', '.cache'])
      expect(existsSync(join(dir, sub))).toBe(true);
  });

  it('creates the private directory owner-only', () => {
    stageAuthFiles(RUNTIME_ISOLATION.codex, dir, home);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('does nothing for a runtime without a private directory', () => {
    expect(stageAuthFiles(RUNTIME_ISOLATION.claude, dir, home)).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});
