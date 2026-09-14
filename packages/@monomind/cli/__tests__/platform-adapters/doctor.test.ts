import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('reports a capability-gated declared location as gated with a reason, not bare missing (#240)', async () => {
    const dir = fixture();
    // Claude's commands/agents locations are concretely declared in the
    // registry, but the capabilities themselves are not yet promoted to
    // 'native' (see PLATFORM_REGISTRY gating) — renderCommands/renderAgents
    // intentionally never write them. That gap must not look like a bug.
    expect(PLATFORM_REGISTRY.claude.capabilities.agents).not.toBe('native');
    expect(PLATFORM_REGISTRY.claude.capabilities.commands).not.toBe('native');
    const [report] = await runPlatformsDoctor({ platform: 'claude', path: dir, scope: 'project' });

    const agentArtifact = report?.artifacts.find(
      (artifact) => artifact.path === '.claude/agents/mastermind-coordinator.md',
    );
    expect(agentArtifact?.state).toBe('gated');
    expect(agentArtifact?.reason).toContain('agents');
    expect(agentArtifact?.reason).toContain(PLATFORM_REGISTRY.claude.capabilities.agents);
    expect(existsSync(join(dir, '.claude', 'agents', 'mastermind-coordinator.md'))).toBe(false);

    const commandArtifact = report?.artifacts.find(
      (artifact) => artifact.path === '.claude/commands/monomind.md',
    );
    expect(commandArtifact?.state).toBe('gated');
    expect(commandArtifact?.reason).toContain('commands');
    expect(existsSync(join(dir, '.claude', 'commands', 'monomind.md'))).toBe(false);
  });

  it('still reports a genuine gap in an already-native capability as plain missing', async () => {
    const dir = fixture();
    // Codex's `instructions` capability is verified native, so an absent
    // AGENTS.md is an actionable gap, not a capability gate.
    expect(PLATFORM_REGISTRY.codex.capabilities.instructions).toBe('native');
    const [report] = await runPlatformsDoctor({ platform: 'codex', path: dir, scope: 'project' });

    const instructionArtifact = report?.artifacts.find((artifact) => artifact.path === 'AGENTS.md');
    expect(instructionArtifact).toEqual({ path: 'AGENTS.md', state: 'missing' });
  });
});
