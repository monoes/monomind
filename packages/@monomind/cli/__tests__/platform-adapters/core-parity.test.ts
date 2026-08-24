import { describe, expect, it } from 'vitest';
import { renderCoreArtifacts } from '../../src/platform-adapters/core.js';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';
import type { PlatformAdapter } from '../../src/platform-adapters/types.js';

const projectOptions = { scope: 'project' as const, os: 'linux' as const };

const expectedProjectPaths = {
  claude: { instruction: 'CLAUDE.md', skill: '.claude/skills', mcp: '.mcp.json' },
  gemini: { instruction: 'GEMINI.md', skill: '.agents/skills', mcp: '.gemini/settings.json' },
  cursor: { instruction: '.cursor/rules/monomind.mdc', skill: '.agents/skills', mcp: '.cursor/mcp.json' },
  vscode: { instruction: '.github/copilot-instructions.md', skill: '.agents/skills', mcp: '.vscode/mcp.json' },
  copilot: { instruction: '.github/copilot-instructions.md', skill: '.agents/skills', mcp: 'cli_fallback' },
  opencode: { instruction: 'AGENTS.md', skill: '.agents/skills', mcp: 'opencode.json' },
  aider: { instruction: 'CONVENTIONS.md', skill: 'cli_fallback', mcp: 'cli_fallback' },
  kiro: { instruction: '.kiro/steering/monomind.md', skill: '.kiro/skills', mcp: '.kiro/mcp.json' },
  trae: { instruction: '.trae/rules/monomind.md', skill: 'discovery', mcp: 'cli_fallback' },
  openclaw: { instruction: 'AGENTS.md', skill: '.agents/skills', mcp: 'cli_fallback' },
  droid: { instruction: 'AGENTS.md', skill: '.agents/skills', mcp: '.factory/mcp.json' },
  antigravity: { instruction: 'discovery', skill: '.agents/skills', mcp: 'discovery' },
  hermes: { instruction: 'cli_fallback', skill: '.agents/skills', mcp: 'cli_fallback' },
  codex: { instruction: 'AGENTS.md', skill: '.agents/skills', mcp: '.codex/config.toml' },
  kimi: { instruction: 'AGENTS.md', skill: '.agents/skills', mcp: '.kimi-code/mcp.json' },
  zed: { instruction: 'AGENTS.md', skill: '.agents/skills', mcp: '.zed/settings.json' },
} as const;

function nativeAdapter(id: keyof typeof PLATFORM_REGISTRY): PlatformAdapter {
  const adapter = PLATFORM_REGISTRY[id];
  return {
    ...adapter,
    capabilities: {
      ...adapter.capabilities,
      instructions: 'native',
      skills: 'native',
    },
  };
}

describe('core platform artifacts', () => {
  it.each(PLATFORM_IDS)('%s declares the documented instruction, skill, and MCP project locations', (platform) => {
    const locations = PLATFORM_REGISTRY[platform].paths.locations;

    for (const kind of ['instruction', 'skill', 'mcp'] as const) {
      const location = locations[kind]?.project;
      expect(typeof location === 'string' ? location : location?.path).toBe(expectedProjectPaths[platform][kind]);
    }
  });

  it('renders portable, platform-scoped instruction and router-skill intents for verified capabilities', () => {
    const plan = renderCoreArtifacts(nativeAdapter('codex'), projectOptions);

    expect(plan.intents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'instruction',
        locationKey: 'instruction',
        marker: 'instructions:codex',
        content: expect.stringContaining('load only the applicable `mastermind-*` skill'),
      }),
      expect.objectContaining({
        kind: 'skill',
        locationKey: 'skill',
        marker: 'skills:codex:mastermind',
        content: expect.stringMatching(/^---\nname: mastermind\ndescription: .+\n---\n/m),
      }),
    ]));
    expect(
      plan.intents.filter(({ kind, relativePath }) => kind === 'skill' && relativePath?.endsWith('/SKILL.md')),
    ).toHaveLength(8);
  });

  it.each(PLATFORM_IDS)('%s emits no fabricated instruction or skill for an evidence-gated capability', (platform) => {
    const adapter = PLATFORM_REGISTRY[platform];
    const plan = renderCoreArtifacts(adapter, projectOptions);

    if (adapter.capabilities.instructions !== 'native') {
      expect(plan.intents.some(({ kind }) => kind === 'instruction')).toBe(false);
    }
    if (adapter.capabilities.skills !== 'native') {
      expect(plan.intents.some(({ kind }) => kind === 'skill')).toBe(false);
    }
  });
});
