import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeManagedBlock } from '../../src/platform-adapters/merge.js';
import { installPlatform, planInstall, uninstallPlatform } from '../../src/platform-adapters/operations.js';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';

const directories: string[] = [];
function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'monomind-platform-fixture-'));
  directories.push(directory);
  return directory;
}
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('evidence-gated platform fixture matrix', () => {
  it.each(PLATFORM_IDS)('%s plans and dry-runs without fabricating unverified files', async (platform) => {
    const directory = fixture();
    const plan = await planInstall({ platform, path: directory, scope: 'project' });
    const applied = await installPlatform({ platform, path: directory, scope: 'project', dryRun: true });

    expect(plan.scope).toBe('project');
    expect(applied.changed).toEqual([]);
    expect(applied.plan).toEqual(plan);
    for (const intent of plan.intents) {
      expect(PLATFORM_REGISTRY[platform].paths.locations[intent.locationKey]).toBeDefined();
    }
  });

  it.each(PLATFORM_IDS)('%s supports idempotent install and uninstall in an isolated fixture', async (platform) => {
    const directory = fixture();
    writeFileSync(join(directory, 'README.md'), 'user content\n');

    const first = await installPlatform({ platform, path: directory, scope: 'project' });
    const second = await installPlatform({ platform, path: directory, scope: 'project' });
    const removed = await uninstallPlatform({ platform, path: directory, scope: 'project' });

    expect(second.changed).toEqual([]);
    expect(readFileSync(join(directory, 'README.md'), 'utf8')).toBe('user content\n');
    expect(first.diagnostics.filter((line) => line.startsWith('ERROR:'))).toEqual([]);
    expect(removed.flatMap((result) => result.diagnostics).filter((line) => line.startsWith('ERROR:'))).toEqual([]);
  });

  it('keeps sibling managed blocks in a shared AGENTS.md during one-platform removal', async () => {
    const directory = fixture();
    const agents = join(directory, 'AGENTS.md');
    let content = mergeManagedBlock('', 'instructions:codex', 'codex');
    content = mergeManagedBlock(content, 'instructions:opencode', 'opencode');
    writeFileSync(agents, content);

    // The merge primitive is the operation-level contract for shared files;
    // a gated adapter must never remove a sibling block while no native
    // instruction surface is verified.
    await uninstallPlatform({ platform: 'codex', path: directory, scope: 'project' });

    expect(readFileSync(agents, 'utf8')).toContain('monomind:start instructions:opencode');
  });
});
