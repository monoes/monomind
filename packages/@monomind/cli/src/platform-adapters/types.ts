/** Canonical vocabulary for platform integration adapters. */

export const CAPABILITIES = [
  'instructions',
  'skills',
  'mcp',
  'commands',
  'agents',
  'hooks',
  'status',
  'lifecycle',
  'permissions',
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type SupportLevel = 'native' | 'cli_fallback' | 'unsupported' | 'experimental';
export type VerificationLevel = 'none' | 'fixture' | 'schema' | 'runtime';
export type InstallScope = 'project' | 'user';
export type ArtifactKind =
  | 'instruction'
  | 'skill'
  | 'mcp'
  | 'command'
  | 'agent'
  | 'hook'
  | 'hook_bridge'
  | 'status'
  | 'plugin'
  | 'permission';
export type ArtifactFormat = 'md' | 'toml' | 'json' | 'jsonc' | 'yaml' | 'sh' | 'js';
export type PlatformId =
  | 'claude'
  | 'gemini'
  | 'cursor'
  | 'vscode'
  | 'copilot'
  | 'opencode'
  | 'aider'
  | 'kiro'
  | 'trae'
  | 'openclaw'
  | 'droid'
  | 'antigravity'
  | 'hermes'
  | 'codex'
  | 'kimi'
  | 'zed';

export interface VerificationEvidence {
  level: VerificationLevel;
  sourceUrl?: string;
  sourceLocator?: string;
  verifiedAt: string;
}

export interface ArtifactLocation {
  /** Relative to the selected project root, or relative to the user's home directory. */
  path: string;
  format?: ArtifactFormat;
  entryPath?: readonly string[];
}

export interface PlatformPaths {
  locations: Partial<
    Record<
      ArtifactKind,
      Partial<Record<InstallScope, ArtifactLocation | 'discovery' | 'cli_fallback'>>
    >
  >;
}

export interface PlatformAdapter {
  id: PlatformId;
  displayName: string;
  capabilities: Record<Capability, SupportLevel>;
  verification: Record<Capability, VerificationEvidence>;
  activationNotes?: Readonly<Partial<Record<Capability, 'manual-step'>>>;
  paths: PlatformPaths;
  requiresDiscovery: boolean;
}

export interface DiscoveryResult {
  available: boolean;
  version?: string;
  /** Explicitly observed paths only; discovery never manufactures a location. */
  paths: Readonly<Record<string, string>>;
  features: ReadonlySet<Capability>;
  /** Discovery evidence is advisory; it cannot promote a registry capability. */
  verification: Partial<Record<Capability, VerificationLevel>>;
  diagnostics: readonly string[];
  locations?: Partial<Record<ArtifactKind, Partial<Record<InstallScope, ArtifactLocation>>>>;
}

export interface InstallRequest {
  platform: PlatformId;
  scope: InstallScope;
  path?: string;
  yes?: boolean;
  dryRun?: boolean;
  enableHooks?: boolean;
  enableBlockingHooks?: boolean;
  discovery?: DiscoveryResult;
}

export type MutationRequest = Omit<InstallRequest, 'platform'> & {
  platform?: PlatformId;
  all?: boolean;
  removeLegacy?: boolean;
};

export interface ArtifactIntent {
  kind: ArtifactKind;
  locationKey: ArtifactKind;
  content: string;
  scope: InstallScope;
  replace: 'managed_block' | 'named_entry' | 'create_if_missing';
  marker?: string;
  /** Path below a declared directory root (currently used by skill packages). */
  relativePath?: string;
  entryPath?: readonly string[];
  format?: ArtifactFormat;
}

export interface PlatformPlan {
  scope: InstallScope;
  authorizedUserMutation: boolean;
  intents: readonly ArtifactIntent[];
  diagnostics: readonly string[];
}

export interface ResolvedArtifactLocation {
  path: string;
  displayPath: string;
  format?: ArtifactFormat;
  entryPath?: readonly string[];
}

export interface ApplyResult {
  changed: readonly string[];
  skipped: readonly string[];
  diagnostics: readonly string[];
  plan: PlatformPlan;
}

export interface PlatformDoctorReport {
  platform: PlatformId;
  capabilities: Record<Capability, SupportLevel>;
  verification: Record<Capability, VerificationLevel>;
  artifacts: readonly {
    path: string;
    state: 'managed' | 'missing' | 'legacy' | 'foreign';
  }[];
  legacy: { findings: readonly string[]; migratable: boolean };
  diagnostics: readonly string[];
  sanitized: true;
}
