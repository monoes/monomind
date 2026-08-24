import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installPlatform, runPlatformsDoctor } from '../../src/platform-adapters/operations.js';
import { PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';

const directories: string[] = [];
const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'platform-doctor-'));
  directories.push(dir);
  return dir;
};
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('platform doctor', () => {
  it('returns evidence-gated registry data without writing files', async () => {
    const dir = fixture();
    const report = await runPlatformsDoctor({ platform: 'codex', path: dir, scope: 'project' });

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ platform: 'codex', capabilities: PLATFORM_REGISTRY.codex.capabilities, sanitized: true });
    expect(readFileSync).toBeDefined();
  });

  it('redacts user paths and identifies legacy Codex injection without modifying it', async () => {
    const home = fixture();
    const config = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      config,
      '# user hook\n# monomind:start\nnode monomind-activate.cjs\n# monomind:end\n',
    );
    writeFileSync(join(home, 'sentinel'), 'unchanged');
    const report = await runPlatformsDoctor({ platform: 'codex', scope: 'user', home });

    expect(report[0]?.sanitized).toBe(true);
    expect(report[0]?.artifacts.every(({ path }) => !path.includes(home))).toBe(true);
    expect(report[0]?.legacy).toMatchObject({ findings: ['codex-sessionstart'], migratable: true });
    expect(readFileSync(config, 'utf8')).toContain('monomind-activate.cjs');
    expect(readFileSync(join(home, 'sentinel'), 'utf8')).toBe('unchanged');
  });

  it('inspects an installed portable skill directory without treating it as a file', async () => {
    const dir = fixture();
    await installPlatform({ platform: 'codex', path: dir, scope: 'project' });

    const [report] = await runPlatformsDoctor({ platform: 'codex', path: dir, scope: 'project' });

    expect(report?.artifacts).toContainEqual({ path: '.agents/skills', state: 'managed' });
  });
});
