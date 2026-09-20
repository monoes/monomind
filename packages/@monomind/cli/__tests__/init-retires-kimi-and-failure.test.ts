/**
 * o-38, continued from init-retires-not-deletes.test.ts (split out to stay
 * under the file-size limit): the kimi surface (§2d) and
 * `retireGeneratedEntry`'s own failure-safety contract.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { retireGeneratedEntry } from '../src/init/shared.js';
import type { InitResult } from '../src/init/types.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

output.setVerbosity('quiet');

vi.mock('child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  execFileSync: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  exec: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  execFile: vi.fn(() => {
    throw new Error('mocked: no real process execution in tests');
  }),
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & {
      unref: () => void;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    proc.unref = () => {};
    proc.kill = () => {};
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    return proc;
  }),
}));

/** Every regular file under `dir`, relative to `dir`. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/** Find every file under `.monomind/backups/**\/retired/` matching `label`
 *  (a `section/name` path fragment, e.g. `kimiSkills/my-retired-skill`). */
function findRetired(targetDir: string, label: string): string[] {
  const backupsDir = path.join(targetDir, '.monomind', 'backups');
  if (!fs.existsSync(backupsDir)) return [];
  const hits: string[] = [];
  for (const runDir of fs.readdirSync(backupsDir)) {
    const candidate = path.join(backupsDir, runDir, 'retired', label);
    if (fs.existsSync(candidate)) hits.push(candidate);
  }
  return hits;
}

async function closeBridge() {
  try {
    const bridge = await import('../src/memory/memory-bridge.js');
    await bridge.shutdownBridge();
  } catch {
    /* not loaded this test — fine */
  }
}

describe('the kimi surface (o-38 §2d)', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-retire-kimi-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-retire-kimi-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    ctx = {
      args: [],
      flags: { _: [], yes: true, 'no-watch': true, 'no-start-all': true, 'no-install': true },
      cwd: tmpDir,
      interactive: false,
    };
  });

  afterEach(async () => {
    await closeBridge();
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it(
    'retires a stale .kimi-code/skills entry instead of deleting a user file inside it',
    async () => {
      ctx.flags = { ...ctx.flags, platform: 'kimi', force: true };
      const first = await initCommand.action!(ctx);
      expect(first.success).toBe(true);

      const manifestPath = path.join(tmpDir, '.monomind', 'init-manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      expect(Array.isArray(manifest.kimiSkills)).toBe(true);

      const staleName = 'my-retired-kimi-skill';
      const staleDir = path.join(tmpDir, '.kimi-code', 'skills', staleName);
      fs.mkdirSync(staleDir, { recursive: true });
      const userFile = path.join(staleDir, 'MY-KIMI-NOTES.md');
      fs.writeFileSync(userFile, 'kimi user content\n');
      manifest.kimiSkills.push(staleName);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const second = await initCommand.action!(ctx);
      expect(second.success).toBe(true);

      expect(fs.existsSync(staleDir)).toBe(false);
      const retired = findRetired(tmpDir, `kimiSkills/${staleName}`);
      expect(retired).toHaveLength(1);
      expect(fs.existsSync(path.join(retired[0], 'MY-KIMI-NOTES.md'))).toBe(true);
      expect(fs.readFileSync(path.join(retired[0], 'MY-KIMI-NOTES.md'), 'utf8')).toBe(
        'kimi user content\n',
      );
    },
    180_000,
  );
});

describe('the .opencode/skills mirror (o-38 revision: it is a DEFAULT mirror too)', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-retire-opencode-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-retire-opencode-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    ctx = {
      args: [],
      flags: { _: [], yes: true, 'no-watch': true, 'no-start-all': true, 'no-install': true },
      cwd: tmpDir,
      interactive: false,
    };
  });

  afterEach(async () => {
    await closeBridge();
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it(
    'a genuinely retired skill disappears from .opencode/skills/ too (a plain init already creates it)',
    async () => {
      const first = await initCommand.action!(ctx);
      expect(first.success).toBe(true);
      // Sanity: a PLAIN init (no --opencode flag) really does create this —
      // components.opencode resolves true whenever no explicit
      // --target/--platform narrows the default 'all' selection.
      expect(fs.existsSync(path.join(tmpDir, '.opencode', 'skills', 'mastermind'))).toBe(true);

      const manifestPath = path.join(tmpDir, '.monomind', 'init-manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const staleName = 'my-retired-skill-opencode';
      const staleDir = path.join(tmpDir, '.claude', 'skills', staleName);
      fs.mkdirSync(staleDir, { recursive: true });
      fs.writeFileSync(path.join(staleDir, 'SKILL.md'), 'stale skill\n');
      manifest.skills.push(staleName);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      // Simulate the opencode mirror as a previous run would have left it.
      const opencodeStale = path.join(tmpDir, '.opencode', 'skills', staleName);
      fs.mkdirSync(opencodeStale, { recursive: true });
      fs.writeFileSync(path.join(opencodeStale, 'SKILL.md'), 'converted stale skill\n');

      ctx.flags = { ...ctx.flags, force: true };
      const second = await initCommand.action!(ctx);
      expect(second.success).toBe(true);

      expect(fs.existsSync(path.join(tmpDir, '.claude', 'skills', staleName))).toBe(false);
      expect(fs.existsSync(opencodeStale)).toBe(false);
    },
    180_000,
  );

  it(
    'an .opencode/skills entry holding a file beyond the converted SKILL.md is retired, not deleted',
    async () => {
      const first = await initCommand.action!(ctx);
      expect(first.success).toBe(true);

      const manifestPath = path.join(tmpDir, '.monomind', 'init-manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const staleName = 'my-retired-skill-opencode-extra';
      const staleDir = path.join(tmpDir, '.claude', 'skills', staleName);
      fs.mkdirSync(staleDir, { recursive: true });
      fs.writeFileSync(path.join(staleDir, 'SKILL.md'), 'stale skill\n');
      manifest.skills.push(staleName);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      const opencodeStale = path.join(tmpDir, '.opencode', 'skills', staleName);
      fs.mkdirSync(opencodeStale, { recursive: true });
      fs.writeFileSync(path.join(opencodeStale, 'SKILL.md'), 'converted stale skill\n');
      // A file added directly inside the mirror — never written by the
      // converter, which only ever emits SKILL.md.
      fs.writeFileSync(path.join(opencodeStale, 'MY-EXTRA-NOTE.md'), 'do not delete me\n');

      ctx.flags = { ...ctx.flags, force: true };
      const second = await initCommand.action!(ctx);
      expect(second.success).toBe(true);

      expect(fs.existsSync(opencodeStale)).toBe(false);
      const retired = findRetired(tmpDir, `opencode-skills/${staleName}`);
      expect(retired).toHaveLength(1);
      expect(fs.existsSync(path.join(retired[0], 'MY-EXTRA-NOTE.md'))).toBe(true);
      expect(fs.readFileSync(path.join(retired[0], 'MY-EXTRA-NOTE.md'), 'utf8')).toBe(
        'do not delete me\n',
      );
    },
    180_000,
  );
});

describe('retireGeneratedEntry never falls back to deleting on failure (o-38)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-retire-fail-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function freshResult(): InitResult {
    return {
      success: true,
      platform: {
        os: 'linux',
        arch: 'x64',
        nodeVersion: process.version,
        shell: 'bash',
        homeDir: os.homedir(),
        configDir: os.homedir(),
      },
      created: { directories: [], files: [] },
      updated: [],
      skipped: [],
      removed: [],
      errors: [],
      summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
    };
  }

  it('leaves the entry in place and records a warning when the retire destination cannot be created', () => {
    // A real (not mocked) failure: `.monomind/backups` exists as a FILE, so
    // the recursive mkdirSync for `.monomind/backups/<ts>-<pid>/retired/…`
    // must fail (ENOTDIR) — vi.spyOn can't override an ESM `import * as fs`
    // namespace's own methods, so this exercises the real failure path
    // rather than a mocked one.
    const staleDir = path.join(tmpDir, 'stale-skill');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'SKILL.md'), 'still here\n');
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'backups'), 'blocks mkdir\n');

    const result = freshResult();
    retireGeneratedEntry(tmpDir, 'skills/stale-skill', staleDir, result);

    // Still in place, byte-identical — never deleted.
    expect(fs.existsSync(staleDir)).toBe(true);
    expect(fs.readFileSync(path.join(staleDir, 'SKILL.md'), 'utf8')).toBe('still here\n');
    // A warning was recorded, not silently swallowed.
    expect(result.errors.some((e) => e.includes('skills/stale-skill'))).toBe(true);
    // Never reported as a (non-existent) success.
    expect(result.removed).toEqual([]);
  });

  it('succeeds on the normal (same-filesystem) path: moves the entry and reports it', () => {
    const staleDir = path.join(tmpDir, 'stale-skill-ok');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'SKILL.md'), 'moved content\n');

    const result = freshResult();
    retireGeneratedEntry(tmpDir, 'skills/stale-skill-ok', staleDir, result);

    expect(fs.existsSync(staleDir)).toBe(false);
    const retired = listFiles(tmpDir).filter((f) => f.includes('stale-skill-ok'));
    expect(retired.length).toBeGreaterThan(0);
    expect(result.removed.length).toBe(1);
    expect(result.errors).toEqual([]);
  });
});
