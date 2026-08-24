import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_SURFACE_INVENTORY,
  deCorruptAiderYaml,
  migrateLegacyArtifacts,
  removeLegacyManagedBlocks,
} from '../../src/platform-adapters/migration.js';

const directories: string[] = [];
function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'monomind-legacy-'));
  directories.push(directory);
  return directory;
}

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('legacy migration inventory', () => {
  it('enumerates every known pre-adapter surface', () => {
    // The original fourteen rows include a family of bare markers. Each file
    // in that family is now explicit so migration never silently ignores a
    // documented legacy instruction surface.
    expect(LEGACY_SURFACE_INVENTORY.length).toBeGreaterThanOrEqual(18);
    expect(new Set(LEGACY_SURFACE_INVENTORY.map((surface) => surface.id)).size).toBe(LEGACY_SURFACE_INVENTORY.length);
  });

  it('removes only historical managed blocks', () => {
    const source = '# user\n<!-- monomind:start -->\nold\n<!-- monomind:end -->\n# keep\n';
    expect(removeLegacyManagedBlocks(source)).toContain('# keep');
    expect(removeLegacyManagedBlocks(source)).not.toContain('old');
  });

  it('restores a valid aider read convention without HTML comments', () => {
    const result = deCorruptAiderYaml('model: sonnet\n<!-- monomind:start -->\nbad\n<!-- monomind:end -->\n');
    expect(result).toContain('read: CONVENTIONS.md');
    expect(result).not.toContain('<!--');
  });

  it('removes only the obsolete Codex block while preserving user configuration', () => {
    const directory = fixture();
    mkdirSync(join(directory, '.codex'), { recursive: true });
    const config = join(directory, '.codex', 'config.toml');
    writeFileSync(config, '# user hook\n# monomind:start\nold\n# monomind:end\n');

    const result = migrateLegacyArtifacts(directory, 'user');

    expect(result.changed).toContain('.codex/config.toml');
    expect(readFileSync(config, 'utf8')).toContain('# user hook');
    expect(readFileSync(config, 'utf8')).not.toContain('old');
  });

  it('removes a legacy Cursor SessionStart entry without removing sibling hooks', () => {
    const directory = fixture();
    mkdirSync(join(directory, '.cursor'), { recursive: true });
    const settings = join(directory, '.cursor', 'settings.json');
    writeFileSync(settings, JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ command: 'node ~/.cursor/monomind-activate.cjs' }] },
          { hooks: [{ command: 'node user-hook.cjs' }] },
        ],
      },
    }));

    const result = migrateLegacyArtifacts(directory, 'project');
    const parsed = JSON.parse(readFileSync(settings, 'utf8')) as { hooks: { SessionStart: unknown[] } };

    expect(result.changed).toContain('.cursor/settings.json');
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(JSON.stringify(parsed)).toContain('user-hook.cjs');
  });

  it('never deletes a shared portable skills root while consumer ownership is unknown', () => {
    const directory = fixture();
    const skill = join(directory, '.agents', 'skills', 'mastermind-plan', 'SKILL.md');
    mkdirSync(join(skill, '..'), { recursive: true });
    writeFileSync(skill, '---\nname: mastermind-plan\n---\n');

    const result = migrateLegacyArtifacts(directory, 'project', { removeLegacy: true });

    expect(result.changed).not.toContain('.agents/skills/mastermind-plan');
    expect(readFileSync(skill, 'utf8')).toContain('mastermind-plan');
  });

  it.each([
    ['.trae/rules/monomind.md', 'instructions:trae'],
    ['.kiro/steering/monomind.md', 'instructions:kiro'],
    ['CLAUDE.md', 'instructions:claude'],
    ['GEMINI.md', 'instructions:gemini'],
    ['.github/copilot-instructions.md', 'instructions:copilot'],
    ['.cursor/rules/monomind.mdc', 'instructions:cursor'],
  ])('upgrades the legacy block in %s to the scoped marker %s', (path, marker) => {
    const directory = fixture();
    const target = join(directory, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, '# user rule\n<!-- monomind:start -->\nlegacy rules\n<!-- monomind:end -->\n');

    migrateLegacyArtifacts(directory, 'project');

    const migrated = readFileSync(target, 'utf8');
    expect(migrated).toContain(`# monomind:start ${marker}`);
    expect(migrated).toContain('legacy rules');
    expect(migrated).toContain('# user rule');
  });

  it('moves the legacy OpenClaw block into its documented AGENTS.md surface', () => {
    const directory = fixture();
    mkdirSync(join(directory, '.claw'), { recursive: true });
    writeFileSync(
      join(directory, '.claw', 'config.md'),
      '<!-- monomind:start -->\nopenclaw rules\n<!-- monomind:end -->\n',
    );

    migrateLegacyArtifacts(directory, 'project');

    expect(readFileSync(join(directory, 'AGENTS.md'), 'utf8')).toContain(
      '# monomind:start instructions:openclaw',
    );
    expect(readFileSync(join(directory, 'AGENTS.md'), 'utf8')).toContain('openclaw rules');
  });

  it.each(LEGACY_SURFACE_INVENTORY)('$id has a safely executable legacy fixture', (surface) => {
    const directory = fixture();
    const path = join(directory, surface.path);
    const marker = '<!-- monomind:start -->\nlegacy\n<!-- monomind:end -->\n';
    mkdirSync(join(path, '..'), { recursive: true });

    if (surface.id === 'cursor-sessionstart' || surface.id === 'claude-global-sessionstart') {
      writeFileSync(
        path,
        JSON.stringify({ hooks: { SessionStart: [{ command: 'node monomind-activate.cjs' }] } }),
      );
    } else if (surface.id === 'aider-corrupted-yaml') {
      writeFileSync(path, `model: test\n${marker}`);
    } else if (surface.id === 'antigravity-plugin') {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'plugin.json'), '{"name":"monomind"}\n');
    } else if (surface.id === 'shared-agent-skills' || surface.id === 'shared-gemini-skills') {
      mkdirSync(join(path, 'mastermind-plan'), { recursive: true });
      writeFileSync(join(path, 'mastermind-plan', 'SKILL.md'), '---\nname: mastermind-plan\n---\n');
    } else if (surface.ownership === 'monomind-file') {
      writeFileSync(path, '// monomind legacy script\n');
    } else {
      writeFileSync(path, `# user configuration\n${marker}`);
    }

    const result = migrateLegacyArtifacts(directory, surface.scope, { removeLegacy: true });
    if (surface.id === 'shared-agent-skills' || surface.id === 'shared-gemini-skills') {
      expect(result.skipped).toContain(surface.path);
    } else {
      expect(result.changed).toContain(surface.path);
    }
  });
});
