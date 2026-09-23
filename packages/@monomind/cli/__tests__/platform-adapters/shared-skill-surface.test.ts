/**
 * `.agents/skills` is one physical directory shared by codex, kimi, opencode,
 * gemini, cursor, … Each adapter used to wrap the same skill body in its own
 * `skills:<platform>:<name>` block, so a file carried one full copy per
 * platform. The shared directory now carries exactly one surface-scoped block.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeUpgrade } from '../../src/init/upgrade.js';
import {
  installPlatform,
  planInstall,
  runPlatformsDoctor,
  uninstallPlatform,
} from '../../src/platform-adapters/operations.js';

function managedFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(entry.parentPath, entry.name));
}

function starts(content: string): string[] {
  return [...content.matchAll(/monomind:start (\S+)/g)].map((match) => match[1]!);
}

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'shared-skill-surface-'));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function block(platform: string, body: string): string {
  return `# monomind:start skills:${platform}:mastermind-org\n${body}\n# monomind:end skills:${platform}:mastermind-org\n`;
}

describe('shared .agents/skills surface', () => {
  it('writes exactly one surface-scoped block per file however many platforms share it', async () => {
    await withProject(async (root) => {
      for (const platform of ['opencode', 'kimi', 'codex', 'gemini'] as const)
        await installPlatform({ platform, path: root, scope: 'project' });

      const files = managedFiles(join(root, '.agents', 'skills'));
      expect(files.length).toBeGreaterThan(10);
      for (const file of files) {
        const markers = starts(readFileSync(file, 'utf8'));
        expect(markers, file).toHaveLength(1);
        expect(markers[0], file).toMatch(/^skills:agents:/);
      }
      const [doctor] = await runPlatformsDoctor({ platform: 'kimi', path: root, scope: 'project' });
      expect(doctor!.artifacts).toContainEqual({ path: '.agents/skills', state: 'managed' });
    });
  });

  it('keeps platform-specific skill roots platform-scoped', async () => {
    await withProject(async (root) => {
      await installPlatform({ platform: 'claude', path: root, scope: 'project' });
      const router = readFileSync(join(root, '.claude', 'skills', 'mastermind', 'SKILL.md'), 'utf8');
      expect(starts(router)).toEqual(['skills:claude:mastermind']);
    });
  });

  it('collapses legacy per-platform blocks into one, preserving user text and backing up', async () => {
    await withProject(async (root) => {
      const plan = await planInstall({ platform: 'codex', scope: 'project', path: root });
      const rendered = plan.intents.find((intent) => intent.relativePath === 'mastermind-org/SKILL.md');
      expect(rendered).toBeDefined();
      const header = rendered!.content.match(/^---\n[\s\S]*?\n---\n/)![0];
      const seeded =
        `${header}USER TOP\n` +
        block('opencode', 'old opencode body') +
        'USER MIDDLE\n' +
        block('kimi', 'old kimi body') +
        block('codex', 'old codex body') +
        'USER TAIL\n';
      const file = join(root, '.agents', 'skills', 'mastermind-org', 'SKILL.md');
      mkdirSync(join(root, '.agents', 'skills', 'mastermind-org'), { recursive: true });
      writeFileSync(file, seeded);

      const result = await installPlatform({ platform: 'codex', path: root, scope: 'project' });
      expect(result.changed).toContain('.agents/skills/mastermind-org/SKILL.md');

      const after = readFileSync(file, 'utf8');
      expect(starts(after)).toEqual(['skills:agents:mastermind-org']);
      expect(after).not.toContain('old ');
      const body = rendered!.content.slice(header.length).replace(/^\n/, '').replace(/\n+$/, '');
      expect(after).toBe(
        `${header}USER TOP\n` +
          `# monomind:start skills:agents:mastermind-org\n${body}\n# monomind:end skills:agents:mastermind-org\n` +
          'USER MIDDLE\nUSER TAIL\n',
      );

      const backups = readdirSync(join(root, '.monomind', 'backups')).map((stamp) =>
        join(root, '.monomind', 'backups', stamp, '.agents', 'skills', 'mastermind-org', 'SKILL.md'),
      );
      expect(backups.some((path) => existsSync(path) && readFileSync(path, 'utf8') === seeded)).toBe(true);

      // A second apply by any sharing platform changes nothing.
      for (const platform of ['codex', 'kimi', 'opencode'] as const) {
        const again = await installPlatform({ platform, path: root, scope: 'project' });
        expect(again.changed.filter((path) => path.startsWith('.agents/skills/')), platform).toEqual([]);
      }
    });
  });

  it('init upgrade collapses legacy blocks without installing any platform', async () => {
    await withProject(async (root) => {
      await installPlatform({ platform: 'codex', path: root, scope: 'project' });
      const file = join(root, '.agents', 'skills', 'mastermind-org', 'SKILL.md');
      const current = readFileSync(file, 'utf8');
      // Rebuild the 2.16.0 shape: the same body once per sharing platform.
      const legacy = ['opencode', 'kimi', 'codex']
        .map((platform) => current.replaceAll('skills:agents:', `skills:${platform}:`))
        .map((content, index) => (index === 0 ? content : content.replace(/^---\n[\s\S]*?\n---\n/, '')))
        .join('');
      writeFileSync(file, legacy);
      rmSync(join(root, '.monomind', 'platforms'), { recursive: true, force: true });

      const result = await executeUpgrade(root);
      expect(result.errors).toEqual([]);
      expect(result.updated).toContain('.agents/skills/mastermind-org/SKILL.md');
      expect(readFileSync(file, 'utf8')).toBe(current);
      expect(
        JSON.parse(readFileSync(join(root, '.monomind', 'platforms', 'shared-skills.json'), 'utf8')),
      ).toEqual({ agents: ['codex', 'kimi', 'opencode'] });
      expect((await executeUpgrade(root)).updated.filter((p) => p.startsWith('.agents/'))).toEqual([]);
    });
  }, 60_000);

  it('keeps the shared block while another installed platform still targets it', async () => {
    await withProject(async (root) => {
      await installPlatform({ platform: 'codex', path: root, scope: 'project' });
      await installPlatform({ platform: 'kimi', path: root, scope: 'project' });
      const router = join(root, '.agents', 'skills', 'mastermind', 'SKILL.md');

      await uninstallPlatform({ platform: 'codex', path: root, scope: 'project' });
      expect(existsSync(router)).toBe(true);
      expect(starts(readFileSync(router, 'utf8'))).toEqual(['skills:agents:mastermind']);

      await uninstallPlatform({ platform: 'kimi', path: root, scope: 'project' });
      expect(existsSync(router)).toBe(false);
    });
  });

  it('keeps the shared block for a co-owner known only from a legacy block', async () => {
    await withProject(async (root) => {
      const router = join(root, '.agents', 'skills', 'mastermind', 'SKILL.md');
      await installPlatform({ platform: 'codex', path: root, scope: 'project' });
      // Simulate a pre-fix kimi install: a kimi-scoped block beside codex's.
      const content = readFileSync(router, 'utf8');
      writeFileSync(router, `${content}# monomind:start skills:kimi:mastermind\nold\n# monomind:end skills:kimi:mastermind\n`);
      rmSync(join(root, '.monomind', 'platforms'), { recursive: true, force: true });

      await uninstallPlatform({ platform: 'codex', path: root, scope: 'project' });
      expect(starts(readFileSync(router, 'utf8'))).toContain('skills:agents:mastermind');
    });
  });
});
