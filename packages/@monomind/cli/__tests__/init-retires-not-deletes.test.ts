/**
 * o-38: `monomind init` must never delete a file it did not write, even when
 * it decides an entry is stale.
 *
 * Two independently-reachable triggers, both reproduced here:
 *
 * 1. PRIMARY, most reachable — `monomind init --minimal` (a documented flag,
 *    no upgrade required) on a project previously initialised with defaults.
 *    The stale sweep used to compare a manifest-recorded name against THIS
 *    RUN'S selection (`options.skills.{core,memory,...}`), not the full
 *    shipped catalogue, so a skill this version still ships but the smaller
 *    run simply didn't select was deleted outright — user files inside
 *    included. Fixed: compare against the full shipped catalogue; a
 *    deselected-but-still-shipped entry is left completely alone.
 * 2. Version skew — a manifest-recorded name genuinely absent from the
 *    current version's SKILLS_MAP/COMMANDS_MAP/AGENTS_MAP (the state an
 *    upgrade between releases produces). This one still needs sweeping —
 *    the skill must stop appearing in the agent's list — but the removal is
 *    now a RETIREMENT (moved to `.monomind/backups/…/retired/…`), not a
 *    delete, so a user file inside survives byte-identical.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { copySkills } from '../src/init/copy-assets.js';
import { retireGeneratedEntry } from '../src/init/shared.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform } from '../src/init/types.js';
import type { InitResult } from '../src/init/types.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

function freshInitResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

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

/** Find every file under `.monomind/backups/**\/retired/` matching `label`
 *  (a `section/name` path fragment, e.g. `skills/my-retired-skill`). */
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

describe('init retires stale skills/commands/agents instead of deleting them (o-38)', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  let ctx: CommandContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-retire-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-retire-home-'));
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

  describe('trigger 1 (PRIMARY): --minimal on a project previously initialised with defaults', () => {
    it(
      'preserves a user file inside a deselected-but-still-shipped skill, and touches no skill directory at all (AC-P)',
      async () => {
        const first = await initCommand.action!(ctx);
        expect(first.success).toBe(true);

        const skillsDir = path.join(tmpDir, '.claude', 'skills');
        const before = new Set(fs.readdirSync(skillsDir));
        expect(before.has('github-toolkit')).toBe(true); // sanity: the default run shipped it

        // Plant a user file inside a skill that --minimal will not select.
        const userFilePath = path.join(skillsDir, 'github-toolkit', 'MY-NOTES.md');
        fs.writeFileSync(userFilePath, 'do not delete me\n');
        const userNestedPath = path.join(skillsDir, 'github-toolkit', 'mydata', 'plan.txt');
        fs.mkdirSync(path.dirname(userNestedPath), { recursive: true });
        fs.writeFileSync(userNestedPath, 'my plan\n');
        const gemMirror = path.join(tmpDir, '.gemini', 'skills', 'github-toolkit');
        const agentsMirror = path.join(tmpDir, '.agents', 'skills', 'github-toolkit');
        expect(fs.existsSync(gemMirror)).toBe(true);
        expect(fs.existsSync(agentsMirror)).toBe(true);

        ctx.flags = { ...ctx.flags, minimal: true, force: true };
        const second = await initCommand.action!(ctx);
        expect(second.success).toBe(true);

        // Not a single skill directory disappeared — deselection is not deletion.
        const after = new Set(fs.readdirSync(skillsDir));
        expect(after).toEqual(before);

        // The user's files are untouched, byte-identical.
        expect(fs.existsSync(userFilePath)).toBe(true);
        expect(fs.readFileSync(userFilePath, 'utf8')).toBe('do not delete me\n');
        expect(fs.existsSync(userNestedPath)).toBe(true);
        expect(fs.readFileSync(userNestedPath, 'utf8')).toBe('my plan\n');

        // Mirrors stay consistent — nothing here was removed either.
        expect(fs.existsSync(gemMirror)).toBe(true);
        expect(fs.existsSync(agentsMirror)).toBe(true);

        // Nothing was reported as retired — a deselection is not a retirement.
        const result = (second as { data?: InitResult }).data;
        expect(result?.removed ?? []).toEqual([]);
      },
      180_000,
    );
  });

  describe('trigger 2: a manifest entry genuinely absent from the shipped catalogue (version skew)', () => {
    /** Seed a fake "retired upstream" skill: a real init, then hand-add a
     *  manifest entry + on-disk directory the current version does not ship,
     *  with a nested user file — the exact shape an upgrade produces. */
    async function seedRetiredSkillFixture() {
      const first = await initCommand.action!(ctx);
      expect(first.success).toBe(true);

      const manifestPath = path.join(tmpDir, '.monomind', 'init-manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      expect(Array.isArray(manifest.skills)).toBe(true);

      const staleName = 'my-retired-skill';
      const staleDir = path.join(tmpDir, '.claude', 'skills', staleName);
      fs.mkdirSync(staleDir, { recursive: true });
      const skillMdPath = path.join(staleDir, 'SKILL.md');
      const skillMdContent = 'MY OWN SKILL.md CONTENT\n';
      fs.writeFileSync(skillMdPath, skillMdContent);
      const notesPath = path.join(staleDir, 'notes', 'personal.md');
      fs.mkdirSync(path.dirname(notesPath), { recursive: true });
      const notesContent = 'MY PERSONAL NOTES\n';
      fs.writeFileSync(notesPath, notesContent);

      manifest.skills.push(staleName);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

      return { staleName, staleDir, skillMdPath, skillMdContent, notesPath, notesContent };
    }

    it(
      'the user file inside survives byte-identical, and is findable under .monomind/backups/…/retired/ (AC-0, AC-1)',
      async () => {
        const { staleName, staleDir, skillMdPath, skillMdContent, notesPath, notesContent } =
          await seedRetiredSkillFixture();

        ctx.flags = { ...ctx.flags, force: true };
        const second = await initCommand.action!(ctx);
        expect(second.success).toBe(true);

        // AC-0 shape check: gone from its original location...
        expect(fs.existsSync(staleDir)).toBe(false);
        // ...control: an actively-shipped skill is untouched.
        expect(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'mastermind'))).toBe(true);

        // AC-1: ...but both files survive, byte-identical, under backups/retired/.
        const retiredDirs = findRetired(tmpDir, `skills/${staleName}`);
        expect(retiredDirs).toHaveLength(1);
        const retiredSkillMd = path.join(retiredDirs[0], 'SKILL.md');
        const retiredNotes = path.join(retiredDirs[0], 'notes', 'personal.md');
        expect(fs.existsSync(retiredSkillMd)).toBe(true);
        expect(fs.readFileSync(retiredSkillMd, 'utf8')).toBe(skillMdContent);
        expect(fs.existsSync(retiredNotes)).toBe(true);
        expect(fs.readFileSync(retiredNotes, 'utf8')).toBe(notesContent);
        void skillMdPath;
        void notesPath;
      },
      180_000,
    );

    it(
      'is reported as a removal, never folded into "created" (AC-2)',
      async () => {
        const { staleName } = await seedRetiredSkillFixture();

        ctx.flags = { ...ctx.flags, force: true };
        const second = await initCommand.action!(ctx);
        const result = (second as { data?: InitResult }).data;
        expect(result).toBeDefined();

        expect(result!.removed.some((line) => line.includes(staleName))).toBe(true);
        expect(result!.created.files.some((line) => line.includes(staleName))).toBe(false);
      },
      180_000,
    );

    it(
      'is still recorded in .monomind/init-manifest.json after this run AND after a second run (AC-3)',
      async () => {
        const { staleName } = await seedRetiredSkillFixture();

        ctx.flags = { ...ctx.flags, force: true };
        const second = await initCommand.action!(ctx);
        expect(second.success).toBe(true);

        const manifestPath = path.join(tmpDir, '.monomind', 'init-manifest.json');
        const afterOne = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(afterOne.retired?.some((r: { name: string }) => r.name === staleName)).toBe(true);

        const third = await initCommand.action!(ctx);
        expect(third.success).toBe(true);
        const afterTwo = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(afterTwo.retired?.some((r: { name: string }) => r.name === staleName)).toBe(true);
      },
      240_000,
    );

    it(
      'a retire that fails leaves the entry in place byte-identical, warns, and the manifest keeps recording it as generated (integration-level, dev-lead AC pre-review #1)',
      async () => {
        // Exercises copySkills directly (not the full CLI action): the full
        // CLI's platform installer also writes into .monomind/backups/ for
        // its own, unrelated reasons (config backups before a rewrite), so
        // blocking that shared path there fails the whole run for a reason
        // that has nothing to do with this test. copySkills alone touches
        // retireGeneratedEntry and recordGenerated only.
        //
        // "make the destination unwritable" is a no-op running as root
        // (plausible in CI/containers) — a real name collision fails
        // regardless of privilege: pre-create `.monomind/backups` itself as
        // a plain FILE, so the retire root's own recursive mkdir cannot
        // succeed no matter who is running it.
        const options = { ...DEFAULT_INIT_OPTIONS, targetDir: tmpDir };
        const first = freshInitResult();
        await copySkills(tmpDir, options, first);
        // (Some SKILLS_MAP entries may have no source dir in this checkout —
        // unrelated to this fix; only the skills actually needed below matter.)

        const staleName = 'my-retired-skill';
        const staleDir = path.join(tmpDir, '.claude', 'skills', staleName);
        fs.mkdirSync(staleDir, { recursive: true });
        const skillMdContent = 'MY OWN SKILL.md CONTENT\n';
        fs.writeFileSync(path.join(staleDir, 'SKILL.md'), skillMdContent);
        const notesContent = 'MY PERSONAL NOTES\n';
        fs.mkdirSync(path.join(staleDir, 'notes'), { recursive: true });
        fs.writeFileSync(path.join(staleDir, 'notes', 'personal.md'), notesContent);

        const manifestPath = path.join(tmpDir, '.monomind', 'init-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.skills.push(staleName);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        fs.rmSync(path.join(tmpDir, '.monomind', 'backups'), { recursive: true, force: true });
        fs.writeFileSync(path.join(tmpDir, '.monomind', 'backups'), 'blocks the retire root\n');

        const second = freshInitResult();
        await copySkills(tmpDir, options, second);

        // 1. Still in place, byte-identical — never deleted.
        expect(fs.existsSync(staleDir)).toBe(true);
        expect(fs.readFileSync(path.join(staleDir, 'SKILL.md'), 'utf8')).toBe(skillMdContent);
        expect(fs.readFileSync(path.join(staleDir, 'notes', 'personal.md'), 'utf8')).toBe(
          notesContent,
        );

        // 2. A warning surfaced.
        expect(second.errors.some((e) => e.includes(staleName))).toBe(true);
        expect(second.removed).toEqual([]);

        // 3. The manifest still records it as generated — a future run must
        // retry the retirement, not lose track of the entry.
        const manifestAfter = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifestAfter.skills.includes(staleName)).toBe(true);
      },
      60_000,
    );

    it(
      'a retired directory holding ONLY shipped content still disappears from .claude/skills/ — the sweep still sweeps (AC-4, anti-over-correction control)',
      async () => {
        const first = await initCommand.action!(ctx);
        expect(first.success).toBe(true);

        const manifestPath = path.join(tmpDir, '.monomind', 'init-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const staleName = 'a-fully-shipped-but-now-retired-skill';
        const staleDir = path.join(tmpDir, '.claude', 'skills', staleName);
        fs.mkdirSync(staleDir, { recursive: true });
        fs.writeFileSync(path.join(staleDir, 'SKILL.md'), 'shipped content, nothing user-added\n');
        manifest.skills.push(staleName);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        ctx.flags = { ...ctx.flags, force: true };
        const second = await initCommand.action!(ctx);
        expect(second.success).toBe(true);

        expect(fs.existsSync(staleDir)).toBe(false);
      },
      180_000,
    );

    it(
      'a user-authored directory NEVER recorded in the manifest is untouched (negative control — passes today too)',
      async () => {
        const first = await initCommand.action!(ctx);
        expect(first.success).toBe(true);

        const unmanagedDir = path.join(tmpDir, '.claude', 'skills', 'totally-unmanaged');
        fs.mkdirSync(unmanagedDir, { recursive: true });
        fs.writeFileSync(path.join(unmanagedDir, 'SKILL.md'), 'mine, never generated\n');

        ctx.flags = { ...ctx.flags, force: true };
        const second = await initCommand.action!(ctx);
        expect(second.success).toBe(true);

        expect(fs.existsSync(unmanagedDir)).toBe(true);
      },
      180_000,
    );

    it(
      'removes the retired skill from the .gemini/ and .agents/ mirrors too (o-38 §2·0b)',
      async () => {
        const { staleName } = await seedRetiredSkillFixture();
        // Mirrors are written for whatever this run selects; seed them
        // manually to the pre-retire shape a real prior run would have left.
        for (const mirror of ['.gemini', '.agents']) {
          const mirrorDir = path.join(tmpDir, mirror, 'skills', staleName);
          fs.mkdirSync(mirrorDir, { recursive: true });
          fs.writeFileSync(path.join(mirrorDir, 'SKILL.md'), 'mirror copy\n');
        }

        ctx.flags = { ...ctx.flags, force: true };
        const second = await initCommand.action!(ctx);
        expect(second.success).toBe(true);

        expect(fs.existsSync(path.join(tmpDir, '.gemini', 'skills', staleName))).toBe(false);
        expect(fs.existsSync(path.join(tmpDir, '.agents', 'skills', staleName))).toBe(false);
      },
      180_000,
    );

    it(
      'a mirror holding a file the .claude copy does not is retired, not deleted',
      async () => {
        const { staleName } = await seedRetiredSkillFixture();
        const mirrorDir = path.join(tmpDir, '.gemini', 'skills', staleName);
        fs.mkdirSync(mirrorDir, { recursive: true });
        // Deliberately NOT present in the .claude copy — simulates a file
        // added directly inside the mirror.
        fs.writeFileSync(path.join(mirrorDir, 'MIRROR-ONLY.md'), 'only lives in the mirror\n');

        ctx.flags = { ...ctx.flags, force: true };
        const second = await initCommand.action!(ctx);
        expect(second.success).toBe(true);

        expect(fs.existsSync(mirrorDir)).toBe(false); // gone from its original spot...
        const retired = findRetired(tmpDir, `gemini-skills/${staleName}`);
        expect(retired).toHaveLength(1); // ...but retired, not deleted.
        expect(fs.existsSync(path.join(retired[0], 'MIRROR-ONLY.md'))).toBe(true);
      },
      180_000,
    );

    it(
      'is idempotent: a second run retires nothing new and reports no retirement (AC-6)',
      async () => {
        await seedRetiredSkillFixture();

        ctx.flags = { ...ctx.flags, force: true };
        const second = await initCommand.action!(ctx);
        expect(second.success).toBe(true);

        const third = await initCommand.action!(ctx);
        expect(third.success).toBe(true);
        const result = (third as { data?: InitResult }).data;
        expect(result?.removed ?? []).toEqual([]);
      },
      240_000,
    );
  });
});
