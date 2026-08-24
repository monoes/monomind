import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
