import { PLATFORM_PATHS } from './registry-paths.js';
import { verification } from './registry-verification.js';
import {
  CAPABILITIES,
  type Capability,
  type PlatformAdapter,
  type PlatformId,
  type PlatformTier,
  type SupportLevel,
} from './types.js';

export type {
  Capability,
  PlatformAdapter,
  PlatformId,
  PlatformTier,
  SupportLevel,
} from './types.js';
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

// Each entry: id, display name, target levels, requiresDiscovery, and the
// support tier (docs/mastermind/plans/2026-11-surface-reduction.md, section 3).
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
      1,
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
      3,
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
      3,
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
      3,
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
      3,
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
      2,
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
      3,
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
      3,
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
      3,
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
      3,
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
      3,
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
      2,
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
      3,
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
      2,
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
      2,
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
      3,
    ],
  ] as const satisfies readonly (readonly [
    PlatformId,
    string,
    TargetLevels,
    boolean,
    PlatformTier,
  ])[]
).reduce(
  (registry, [id, displayName, levels, requiresDiscovery, tier]) => {
    const adapterVerification = verification(id);
    registry[id] = {
      id,
      displayName,
      tier,
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
