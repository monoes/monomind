import {
  CAPABILITIES,
  type Capability,
  type PlatformAdapter,
  type PlatformId,
  type SupportLevel,
  type VerificationEvidence,
} from './types.js';

export type { Capability, PlatformAdapter, PlatformId, SupportLevel } from './types.js';
export { CAPABILITIES } from './types.js';

export const PLATFORM_IDS = [
  'claude',
  'gemini',
  'cursor',
  'vscode',
  'copilot',
  'opencode',
  'aider',
  'kiro',
  'trae',
  'openclaw',
  'droid',
  'antigravity',
  'hermes',
  'codex',
  'kimi',
  'zed',
] as const satisfies readonly PlatformId[];

export const LEGACY_PLATFORM_ALIASES: Readonly<Record<string, PlatformId>> = Object.freeze({
  claw: 'openclaw',
  kimicode: 'kimi',
});

export function resolvePlatformId(id: string): PlatformId | undefined {
  const normalized = id.trim().toLowerCase();
  return (PLATFORM_IDS as readonly string[]).includes(normalized)
    ? (normalized as PlatformId)
    : LEGACY_PLATFORM_ALIASES[normalized];
}

const unverifiedEvidence = (): VerificationEvidence => ({
  level: 'none',
  verifiedAt: '2026-08-24',
});
const schemaEvidence = (sourceUrl: string, sourceLocator: string): VerificationEvidence => ({
  level: 'schema',
  sourceUrl,
  sourceLocator,
  verifiedAt: '2026-08-24',
});

/**
 * Sources are intentionally limited to Markdown surfaces. JSONC/TOML/YAML
 * configuration remains experimental until its parser contract is implemented
 * and then accepted by a target schema or a real-runtime smoke test.
 */
const VERIFIED_NATIVE_CAPABILITIES: Partial<
  Record<PlatformId, Partial<Record<Capability, VerificationEvidence>>>
> = {
  claude: {
    instructions: schemaEvidence(
      'https://code.claude.com/docs/en/features-overview',
      'Project instructions',
    ),
    skills: schemaEvidence('https://code.claude.com/docs/en/skills', 'Skill directories'),
  },
  gemini: {
    instructions: schemaEvidence(
      'https://github.com/google-gemini/gemini-cli/tree/main/docs',
      'GEMINI.md instructions',
    ),
    skills: schemaEvidence(
      'https://github.com/google-gemini/gemini-cli/tree/main/docs',
      'Skills directories',
    ),
  },
  cursor: {
    instructions: schemaEvidence('https://cursor.com/docs/context/rules', 'Project rules'),
    skills: schemaEvidence('https://cursor.com/docs/context/skills', 'Skills directories'),
  },
  vscode: {
    instructions: schemaEvidence(
      'https://code.visualstudio.com/docs/agent/customization',
      'Custom instructions',
    ),
    skills: schemaEvidence(
      'https://code.visualstudio.com/docs/agent-customization/agent-skills',
      'Agent skills',
    ),
  },
  copilot: {
    instructions: schemaEvidence(
      'https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot',
      'Repository instructions',
    ),
    skills: schemaEvidence(
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills',
      'Copilot CLI skills',
    ),
  },
  opencode: {
    instructions: schemaEvidence('https://opencode.ai/docs', 'AGENTS.md instructions'),
    skills: schemaEvidence('https://opencode.ai/docs/skills/', 'Skills directories'),
  },
  aider: {
    instructions: schemaEvidence(
      'https://aider.chat/docs/config/aider_conf.html',
      'read: conventions file',
    ),
  },
  kiro: {
    instructions: schemaEvidence('https://kiro.dev/docs/steering/', 'Steering files'),
    skills: schemaEvidence('https://kiro.dev/docs/skills/', 'Skills directories'),
  },
  openclaw: {
    instructions: schemaEvidence(
      'https://docs.openclaw.ai/configuration',
      'Workspace instructions',
    ),
    skills: schemaEvidence('https://docs.openclaw.ai/tools/skills', 'Skills directories'),
  },
  droid: {
    instructions: schemaEvidence('https://docs.factory.ai/harness', 'AGENTS.md instructions'),
    skills: schemaEvidence('https://docs.factory.ai/harness/skills', 'Skills directories'),
  },
  codex: {
    instructions: schemaEvidence(
      'https://learn.chatgpt.com/docs/config-file/config-reference',
      'Project instructions',
    ),
    skills: schemaEvidence('https://learn.chatgpt.com/docs/build-skills.md', 'Skills directories'),
  },
  kimi: {
    skills: schemaEvidence(
      'https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html',
      'Skills directories',
    ),
  },
};

function verification(platform: PlatformId): PlatformAdapter['verification'] {
  return Object.fromEntries(
    CAPABILITIES.map((capability) => [
      capability,
      VERIFIED_NATIVE_CAPABILITIES[platform]?.[capability] ?? unverifiedEvidence(),
    ]),
  ) as PlatformAdapter['verification'];
}
/**
 * Declared locations are data, not proof that a capability is currently
 * verified. Rendering remains gated by the adapter's capability evidence.
 * User paths are relative to the selected home directory.
 */
const PLATFORM_PATHS: Record<PlatformId, PlatformAdapter['paths']> = {
  claude: {
    locations: {
      instruction: { project: { path: 'CLAUDE.md', format: 'md' }, user: 'cli_fallback' },
      skill: { project: { path: '.claude/skills' }, user: { path: '.claude/skills' } },
      command: {
        project: { path: '.claude/commands/monomind.md', format: 'md' },
        user: 'cli_fallback',
      },
      agent: {
        project: { path: '.claude/agents/mastermind-coordinator.md', format: 'md' },
        user: 'cli_fallback',
      },
      mcp: {
        project: { path: '.mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] },
        user: 'cli_fallback',
      },
    },
  },
  gemini: {
    locations: {
      instruction: { project: { path: 'GEMINI.md', format: 'md' }, user: 'cli_fallback' },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: {
        project: {
          path: '.gemini/settings.json',
          format: 'json',
          entryPath: ['mcpServers', 'monomind'],
        },
        user: 'cli_fallback',
      },
    },
  },
  cursor: {
    locations: {
      instruction: {
        project: { path: '.cursor/rules/monomind.mdc', format: 'md' },
        user: 'cli_fallback',
      },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: {
        project: {
          path: '.cursor/mcp.json',
          format: 'json',
          entryPath: ['mcpServers', 'monomind'],
        },
        user: 'cli_fallback',
      },
    },
  },
  vscode: {
    locations: {
      instruction: {
        project: { path: '.github/copilot-instructions.md', format: 'md' },
        user: 'cli_fallback',
      },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: {
        project: { path: '.vscode/mcp.json', format: 'json', entryPath: ['servers', 'monomind'] },
        user: 'cli_fallback',
      },
    },
  },
  copilot: {
    locations: {
      instruction: {
        project: { path: '.github/copilot-instructions.md', format: 'md' },
        user: 'cli_fallback',
      },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: { project: 'cli_fallback', user: 'cli_fallback' },
    },
  },
  opencode: {
    locations: {
      instruction: { project: { path: 'AGENTS.md', format: 'md' }, user: 'cli_fallback' },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      command: {
        project: { path: '.opencode/commands/monomind.md', format: 'md' },
        user: 'cli_fallback',
      },
      agent: {
        project: { path: '.opencode/agents/mastermind-coordinator.md', format: 'md' },
        user: 'cli_fallback',
      },
      mcp: {
        project: { path: 'opencode.json', format: 'jsonc', entryPath: ['mcp', 'monomind'] },
        user: 'cli_fallback',
      },
    },
  },
  aider: {
    locations: {
      instruction: { project: { path: 'CONVENTIONS.md', format: 'md' }, user: 'cli_fallback' },
      skill: { project: 'cli_fallback', user: 'cli_fallback' },
      mcp: { project: 'cli_fallback', user: 'cli_fallback' },
    },
  },
  kiro: {
    locations: {
      instruction: {
        project: { path: '.kiro/steering/monomind.md', format: 'md' },
        user: 'cli_fallback',
      },
      skill: { project: { path: '.kiro/skills' }, user: 'cli_fallback' },
      mcp: {
        project: { path: '.kiro/mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] },
        user: 'cli_fallback',
      },
    },
  },
  trae: {
    locations: {
      instruction: {
        project: { path: '.trae/rules/monomind.md', format: 'md' },
        user: 'cli_fallback',
      },
      skill: { project: 'discovery', user: 'discovery' },
      mcp: { project: 'cli_fallback', user: 'cli_fallback' },
    },
  },
  openclaw: {
    locations: {
      instruction: { project: { path: 'AGENTS.md', format: 'md' }, user: 'cli_fallback' },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: {
        project: 'cli_fallback',
        user: {
          path: '.openclaw/openclaw.json',
          format: 'json',
          entryPath: ['mcpServers', 'monomind'],
        },
      },
    },
  },
  droid: {
    locations: {
      instruction: { project: { path: 'AGENTS.md', format: 'md' }, user: 'cli_fallback' },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: {
        project: {
          path: '.factory/mcp.json',
          format: 'json',
          entryPath: ['mcpServers', 'monomind'],
        },
        user: { path: '.factory/mcp.json', format: 'json', entryPath: ['mcpServers', 'monomind'] },
      },
    },
  },
  antigravity: {
    locations: {
      instruction: { project: 'discovery', user: 'discovery' },
      skill: { project: { path: '.agents/skills' }, user: 'discovery' },
      mcp: { project: 'discovery', user: 'discovery' },
    },
  },
  hermes: {
    locations: {
      instruction: { project: 'cli_fallback', user: 'cli_fallback' },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: { project: 'cli_fallback', user: 'discovery' },
    },
  },
  codex: {
    locations: {
      instruction: { project: { path: 'AGENTS.md', format: 'md' }, user: 'cli_fallback' },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: {
        project: {
          path: '.codex/config.toml',
          format: 'toml',
          entryPath: ['mcp_servers', 'monomind'],
        },
        user: 'cli_fallback',
      },
      // Hooks remain evidence-gated. These paths are intentionally just
      // locations, not a claim that the current registry may render a hook.
      hook: { project: { path: '.codex/config.toml', format: 'toml' }, user: 'cli_fallback' },
      hook_bridge: {
        project: { path: '.agents/monomind/hook-bridge.mjs', format: 'js' },
        user: 'cli_fallback',
      },
    },
  },
  kimi: {
    locations: {
      instruction: { project: { path: 'AGENTS.md', format: 'md' }, user: 'cli_fallback' },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: {
        project: {
          path: '.kimi-code/mcp.json',
          format: 'json',
          entryPath: ['mcpServers', 'monomind'],
        },
        user: 'cli_fallback',
      },
    },
  },
  zed: {
    locations: {
      instruction: { project: { path: 'AGENTS.md', format: 'md' }, user: 'cli_fallback' },
      skill: { project: { path: '.agents/skills' }, user: { path: '.agents/skills' } },
      mcp: {
        project: {
          path: '.zed/settings.json',
          format: 'jsonc',
          entryPath: ['context_servers', 'monomind'],
        },
        user: 'cli_fallback',
      },
    },
  },
};

// The v7 matrix is a target contract. Until a renderer and an upstream schema
// citation are both present, target-native cells must remain experimental rather
// than make an unsupported native claim.
const gated = (
  levels: Record<Capability, SupportLevel>,
  evidence: PlatformAdapter['verification'],
): Record<Capability, SupportLevel> =>
  Object.fromEntries(
    CAPABILITIES.map((capability) => [
      capability,
      levels[capability] === 'native' && ['schema', 'runtime'].includes(evidence[capability].level)
        ? 'native'
        : levels[capability] === 'native'
          ? 'experimental'
          : levels[capability],
    ]),
  ) as Record<Capability, SupportLevel>;

type TargetLevels = Record<Capability, SupportLevel>;
const target = (levels: TargetLevels) => levels;

export const PLATFORM_REGISTRY: Record<PlatformId, PlatformAdapter> = (
  [
    [
      'claude',
      'Claude Code',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'native',
        commands: 'native',
        agents: 'native',
        hooks: 'native',
        status: 'native',
        lifecycle: 'native',
        permissions: 'native',
      }),
      false,
    ],
    [
      'gemini',
      'Gemini CLI',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'native',
        commands: 'cli_fallback',
        agents: 'unsupported',
        hooks: 'native',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'cursor',
      'Cursor',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'native',
        commands: 'cli_fallback',
        agents: 'unsupported',
        hooks: 'native',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'vscode',
      'VS Code',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'native',
        commands: 'cli_fallback',
        agents: 'native',
        hooks: 'experimental',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'copilot',
      'GitHub Copilot',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'cli_fallback',
        commands: 'cli_fallback',
        agents: 'unsupported',
        hooks: 'native',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'opencode',
      'OpenCode',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'native',
        commands: 'native',
        agents: 'native',
        hooks: 'native',
        status: 'native',
        lifecycle: 'native',
        permissions: 'native',
      }),
      false,
    ],
    [
      'aider',
      'Aider',
      target({
        instructions: 'native',
        skills: 'cli_fallback',
        mcp: 'cli_fallback',
        commands: 'cli_fallback',
        agents: 'cli_fallback',
        hooks: 'unsupported',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'kiro',
      'Kiro',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'native',
        commands: 'cli_fallback',
        agents: 'native',
        hooks: 'native',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'trae',
      'Trae',
      target({
        instructions: 'native',
        skills: 'experimental',
        mcp: 'experimental',
        commands: 'cli_fallback',
        agents: 'experimental',
        hooks: 'experimental',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      true,
    ],
    [
      'openclaw',
      'OpenClaw',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'cli_fallback',
        commands: 'cli_fallback',
        agents: 'cli_fallback',
        hooks: 'native',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'droid',
      'Droid',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'native',
        commands: 'experimental',
        agents: 'experimental',
        hooks: 'native',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'antigravity',
      'Google Antigravity',
      target({
        instructions: 'experimental',
        skills: 'experimental',
        mcp: 'experimental',
        commands: 'cli_fallback',
        agents: 'experimental',
        hooks: 'experimental',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      true,
    ],
    [
      'hermes',
      'Hermes',
      target({
        instructions: 'cli_fallback',
        skills: 'experimental',
        mcp: 'experimental',
        commands: 'cli_fallback',
        agents: 'unsupported',
        hooks: 'unsupported',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      true,
    ],
    [
      'codex',
      'Codex',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'native',
        commands: 'cli_fallback',
        agents: 'experimental',
        hooks: 'native',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'kimi',
      'Kimi Code',
      target({
        instructions: 'experimental',
        skills: 'native',
        mcp: 'native',
        commands: 'native',
        agents: 'native',
        hooks: 'native',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      false,
    ],
    [
      'zed',
      'Zed',
      target({
        instructions: 'native',
        skills: 'native',
        mcp: 'native',
        commands: 'cli_fallback',
        agents: 'experimental',
        hooks: 'unsupported',
        status: 'cli_fallback',
        lifecycle: 'native',
        permissions: 'unsupported',
      }),
      true,
    ],
  ] as const
).reduce(
  (registry, [id, displayName, levels, requiresDiscovery]) => {
    const adapterVerification = verification(id);
    registry[id] = {
      id,
      displayName,
      capabilities: gated(levels, adapterVerification),
      verification: adapterVerification,
      paths: PLATFORM_PATHS[id],
      requiresDiscovery,
    };
    return registry;
  },
  {} as Record<PlatformId, PlatformAdapter>,
);

export function assertRegistryIsVerifiable(registry: Record<PlatformId, PlatformAdapter>): void {
  for (const adapter of Object.values(registry)) {
    for (const capability of CAPABILITIES) {
      const evidence = adapter.verification[capability];
      if (
        adapter.capabilities[capability] === 'native' &&
        !['schema', 'runtime'].includes(evidence.level)
      ) {
        throw new Error(`${adapter.id}.${capability} is native without upstream verification`);
      }
      if (
        ['schema', 'runtime'].includes(evidence.level) &&
        (!evidence.sourceUrl || !evidence.sourceLocator)
      ) {
        throw new Error(`${adapter.id}.${capability} lacks a verifiable evidence source`);
      }
    }
  }
}
