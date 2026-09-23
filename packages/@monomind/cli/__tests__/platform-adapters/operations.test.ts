import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installPlatform,
  planInstall,
  redactUserPath,
  resolveArtifactLocation,
  uninstallPlatform,
  upgradePlatforms,
} from '../../src/platform-adapters/operations.js';
import { backup, removeManagedSkillPackage, symlinkedComponent } from '../../src/platform-adapters/mutation.js';
import { PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';
import type { PlatformAdapter } from '../../src/platform-adapters/types.js';

const codexWithLocations: PlatformAdapter = {
  ...PLATFORM_REGISTRY.codex,
  paths: {
    locations: {
      instruction: {
        project: { path: 'AGENTS.md', format: 'md' },
        user: { path: '.agents/AGENTS.md', format: 'md' },
      },
    },
  },
};

describe('platform adapter operations', () => {
  it('resolves only declared scope-specific artifact paths and redacts user paths', () => {
    expect(
      resolveArtifactLocation(codexWithLocations, 'instruction', 'project', {
        root: '/workspace/project',
      }),
    ).toMatchObject({ path: '/workspace/project/AGENTS.md', displayPath: 'AGENTS.md' });
    expect(
      resolveArtifactLocation(codexWithLocations, 'instruction', 'user', { home: '/users/me' }),
    ).toMatchObject({ path: '/users/me/.agents/AGENTS.md', displayPath: '<home>/.agents/AGENTS.md' });
    expect(resolveArtifactLocation(codexWithLocations, 'mcp', 'project')).toBeUndefined();
    expect(redactUserPath('/users/me/.agents/AGENTS.md', '/users/me')).toBe('<home>/.agents/AGENTS.md');
  });

  it('carries user-scope authorization in plans and rejects unconfirmed mutation', async () => {
    const plan = await planInstall({ platform: 'codex', scope: 'user' });
    expect(plan).toMatchObject({ scope: 'user', authorizedUserMutation: false });
    await expect(installPlatform({ platform: 'codex', scope: 'user' })).rejects.toThrow('--yes');
  });

  it('backs up and removes only a marker-verified legacy surface during upgrade', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'platform-upgrade-'));
    try {
      mkdirSync(join(directory, '.cursorrules'), { recursive: true });
      // Use a file rather than a path named as a directory; its user content must survive.
      rmSync(join(directory, '.cursorrules'), { recursive: true, force: true });
      writeFileSync(
        join(directory, '.cursorrules'),
        '# user rule\n<!-- monomind:start -->\nlegacy\n<!-- monomind:end -->\n',
      );

      const [result] = await upgradePlatforms({
        platform: 'cursor',
        path: directory,
        scope: 'project',
      });

      expect(result.changed).toContain('.cursorrules');
      expect(readFileSync(join(directory, '.cursorrules'), 'utf8')).toContain('# user rule');
      expect(readFileSync(join(directory, '.cursorrules'), 'utf8')).not.toContain('legacy');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps dry-run lifecycle operations completely read-only, including lock state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'platform-dry-run-'));
    try {
      const results = await upgradePlatforms({
        platform: 'codex',
        path: directory,
        scope: 'project',
        dryRun: true,
      });

      expect(results[0]?.changed).toEqual([]);
      expect(existsSync(join(directory, '.monomind'))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails safe on a stale scoped lock and explains manual recovery', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'platform-stale-lock-'));
    const lockPath = join(directory, '.monomind', 'locks', 'platforms.lock');
    try {
      mkdirSync(join(directory, '.monomind', 'locks'), { recursive: true });
      writeFileSync(lockPath, '{"pid":999999,"startedAt":"1970-01-01T00:00:00.000Z"}\n');

      await expect(
        installPlatform({ platform: 'codex', path: directory, scope: 'project' }),
      ).rejects.toThrow(/remove it manually only after verifying the owner is gone/i);
      expect(readFileSync(lockPath, 'utf8')).toContain('"pid":999999');
      expect(existsSync(join(directory, 'AGENTS.md'))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('installs every canonical portable workflow beneath a verified skill root', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'platform-skills-'));
    try {
      await installPlatform({ platform: 'codex', path: directory, scope: 'project' });

      for (const skill of [
        'mastermind',
        'mastermind-plan',
        'mastermind-review',
        'mastermind-debug',
        'mastermind-research',
        'mastermind-execute',
        'mastermind-org',
        'mastermind-memory',
      ]) {
        const path = join(directory, '.agents', 'skills', skill, 'SKILL.md');
        expect(existsSync(path)).toBe(true);
        expect(readFileSync(path, 'utf8')).toMatch(new RegExp(`^---\\nname: ${skill}\\n`, 'm'));
      }
      expect(
        existsSync(join(directory, '.agents', 'skills', 'mastermind', 'references', 'codex-tools.md')),
      ).toBe(true);

      await uninstallPlatform({ platform: 'codex', path: directory, scope: 'project' });
      expect(existsSync(join(directory, '.agents', 'skills', 'mastermind', 'SKILL.md'))).toBe(false);
      expect(existsSync(join(directory, '.agents', 'skills', 'mastermind', 'references', 'codex-tools.md'))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('removeManagedSkillPackage', () => {
  const marker = 'catalog:skill:demo';
  const block = (body: string) => `# monomind:start ${marker}\n${body}\n# monomind:end ${marker}\n`;
  const claude = PLATFORM_REGISTRY.claude;

  function seed(): string {
    const root = mkdtempSync(join(tmpdir(), 'platform-remove-'));
    const dir = join(root, '.claude', 'skills', 'demo');
    mkdirSync(join(dir, 'ref'), { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: demo\ndescription: d\n---\n${block('body')}`);
    writeFileSync(join(dir, 'ref', 'notes.md'), block('notes'));
    return root;
  }

  it('strips the marker blocks, deletes emptied files and removes the emptied directory', () => {
    const root = seed();
    try {
      const request = { platform: 'claude' as const, scope: 'project' as const, path: root };
      const dry = removeManagedSkillPackage(claude, { ...request, dryRun: true }, 'demo', marker);
      expect(existsSync(join(root, '.claude', 'skills', 'demo', 'SKILL.md'))).toBe(true);
      const real = removeManagedSkillPackage(claude, request, 'demo', marker);
      expect(dry.changed).toEqual(real.changed);
      expect([...real.changed].sort()).toEqual(['.claude/skills/demo/SKILL.md', '.claude/skills/demo/ref/notes.md']);
      expect(existsSync(join(root, '.claude', 'skills', 'demo'))).toBe(false);
      expect(existsSync(join(root, '.claude', 'skills'))).toBe(true);
      expect(existsSync(join(root, '.monomind', 'backups'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never touches a file without the marker, keeping the directory that holds it', () => {
    const root = seed();
    try {
      const mine = join(root, '.claude', 'skills', 'demo', 'mine.md');
      writeFileSync(mine, 'user notes\n');
      const result = removeManagedSkillPackage(claude, { platform: 'claude', scope: 'project', path: root }, 'demo', marker);
      expect(result.skipped).toContain('.claude/skills/demo/mine.md');
      expect(readFileSync(mine, 'utf8')).toBe('user notes\n');
      expect(existsSync(join(root, '.claude', 'skills', 'demo', 'SKILL.md'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked destination and an escaping relative directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'platform-remove-'));
    const outside = mkdtempSync(join(tmpdir(), 'platform-outside-'));
    try {
      writeFileSync(join(outside, 'SKILL.md'), `---\nname: demo\n---\n${block('x')}`);
      mkdirSync(join(root, '.claude', 'skills'), { recursive: true });
      symlinkSync(outside, join(root, '.claude', 'skills', 'demo'));
      const request = { platform: 'claude' as const, scope: 'project' as const, path: root };
      const linked = removeManagedSkillPackage(claude, request, 'demo', marker);
      expect(linked.changed).toEqual([]);
      expect(linked.diagnostics.join('\n')).toMatch(/symlinked-destination/);
      expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).toContain('monomind:start');
      const escaping = removeManagedSkillPackage(claude, request, '../../x', marker);
      expect(escaping.changed).toEqual([]);
      expect(escaping.diagnostics.join('\n')).toMatch(/escap/);
      expect(symlinkedComponent(root, join(root, '.claude', 'skills', 'demo', 'SKILL.md'))).toBe(
        join(root, '.claude', 'skills', 'demo'),
      );
      expect(symlinkedComponent(root, join(root, '.claude', 'skills', 'none', 'SKILL.md'))).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('backup', () => {
  it('keeps every file of one apply apart and never overwrites an earlier copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'platform-backup-'));
    try {
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      for (const name of ['one', 'two']) {
        mkdirSync(join(root, '.claude', 'skills', name), { recursive: true });
        writeFileSync(join(root, '.claude', 'skills', name, 'SKILL.md'), `${name}\n`);
        backup(join(root, '.claude', 'skills', name, 'SKILL.md'), root);
      }
      const file = join(root, '.claude', 'skills', 'one', 'SKILL.md');
      writeFileSync(file, 'rewritten\n');
      backup(file, root);
      const stamp = join(root, '.monomind', 'backups', `1700000000000-${process.pid}`);
      expect(readFileSync(join(stamp, '.claude', 'skills', 'one', 'SKILL.md'), 'utf8')).toBe('one\n');
      expect(readFileSync(join(stamp, '.claude', 'skills', 'two', 'SKILL.md'), 'utf8')).toBe('two\n');
    } finally {
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a file and then its directory apart within one millisecond', () => {
    const root = mkdtempSync(join(tmpdir(), 'platform-backup-'));
    try {
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      const dir = join(root, '.claude', 'skills', 'demo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), 'first\n');
      backup(join(dir, 'SKILL.md'), root);
      writeFileSync(join(dir, 'SKILL.md'), 'second\n');
      writeFileSync(join(dir, 'notes.md'), 'notes\n');
      backup(dir, root);
      const saved = join(root, '.monomind', 'backups', `1700000000000-${process.pid}`, '.claude', 'skills', 'demo');
      expect(readFileSync(join(saved, 'SKILL.md'), 'utf8')).toBe('first\n');
      expect(readFileSync(join(saved, 'notes.md'), 'utf8')).toBe('notes\n');
    } finally {
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never folds two external paths into one backup name', () => {
    const root = mkdtempSync(join(tmpdir(), 'platform-backup-'));
    const outside = mkdtempSync(join(tmpdir(), 'platform-backup-ext-'));
    try {
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      mkdirSync(join(outside, 'a'), { recursive: true });
      mkdirSync(join(outside, 'a_b'), { recursive: true });
      writeFileSync(join(outside, 'a', 'b_c'), 'one\n');
      writeFileSync(join(outside, 'a_b', 'c'), 'two\n');
      backup(join(outside, 'a', 'b_c'), root);
      backup(join(outside, 'a_b', 'c'), root);
      const external = join(root, '.monomind', 'backups', `1700000000000-${process.pid}`, '_external');
      const copies = (readdirSync(external, { recursive: true }) as string[])
        .filter((f) => statSync(join(external, f)).isFile())
        .map((f) => readFileSync(join(external, f), 'utf8'));
      expect(copies.sort()).toEqual(['one\n', 'two\n']);
    } finally {
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
