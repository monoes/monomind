/**
 * GH-317: `monomind init --force` (kimi-code target) converted every
 * `.claude/commands/*.md` into a `.kimi-code/skills/<name>/SKILL.md` "flow
 * skill" — including `.claude/commands/mastermind.md`, the universal intent
 * router written in the catalog-style shape (a markdown table with an
 * "Intent" cell and a "primary route" cell). That planted a second,
 * contradicting router at `.kimi-code/skills/monomind-mastermind/SKILL.md`,
 * failing tests/repo/mastermind-router-consistency.test.ts on every run. The
 * canonical router is `mastermind/SKILL.md` (mirrored from
 * `.claude/skills/mastermind/`); the catalog-style command is legitimately
 * shipped ONLY as a plugin command
 * (`.kimi-code/plugin/commands/monomind-mastermind.md`), never as a skill.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { isCatalogStyleRouterCommand } from '../src/init/kimi-generator.js';
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

/** Every `SKILL.md` under `dir`, at any depth. */
function findSkillFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSkillFiles(full));
    else if (entry.name === 'SKILL.md') out.push(full);
  }
  return out;
}

async function closeBridge() {
  try {
    const bridge = await import('../src/memory/memory-bridge.js');
    await bridge.shutdownBridge();
  } catch {
    /* not loaded this test — fine */
  }
}

describe('kimi-code init never plants a second router under skills/ (GH-317)', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-kimi-router-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-kimi-router-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    ctx = {
      args: [],
      flags: {
        _: [],
        yes: true,
        'no-watch': true,
        'no-start-all': true,
        'no-install': true,
        // Both platforms: kimi's writer reads its source commands/skills FROM
        // the target .claude/ tree (o-38 comment in write-kimicode.ts) — a
        // kimi-only run never writes .claude/commands/mastermind.md in the
        // first place, so it can't reproduce GH-317. A plain `monomind init
        // --force` (target 'all') writes both, same as here.
        platform: 'claude,kimi',
        force: true,
      },
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
    'no skills/**/SKILL.md carries the catalog-style router shape',
    async () => {
      const result = await initCommand.action!(ctx);
      expect(result.success).toBe(true);

      const skillFiles = findSkillFiles(path.join(tmpDir, '.kimi-code', 'skills'));
      expect(skillFiles.length).toBeGreaterThan(0);

      const catalogRouters = skillFiles.filter((f) =>
        isCatalogStyleRouterCommand(fs.readFileSync(f, 'utf8')),
      );
      expect(
        catalogRouters,
        `catalog-style router(s) found under .kimi-code/skills/: ${catalogRouters.join(', ')}`,
      ).toEqual([]);
    },
    180_000,
  );

  it(
    'specifically: .kimi-code/skills/monomind-mastermind/ is not produced',
    async () => {
      const result = await initCommand.action!(ctx);
      expect(result.success).toBe(true);

      expect(
        fs.existsSync(path.join(tmpDir, '.kimi-code', 'skills', 'monomind-mastermind')),
      ).toBe(false);
    },
    180_000,
  );

  it(
    'the legitimate plugin command copy is still generated',
    async () => {
      const result = await initCommand.action!(ctx);
      expect(result.success).toBe(true);

      expect(
        fs.existsSync(
          path.join(tmpDir, '.kimi-code', 'plugin', 'commands', 'monomind-mastermind.md'),
        ),
      ).toBe(true);
    },
    180_000,
  );
});
