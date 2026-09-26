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
  /** Files an install must not rewrite: init keeps these because the user
   *  edited them (see init/file-guard.ts). */
  protectedPaths?: ReadonlySet<string>;
  /** One backup directory for every file this install replaces. */
  backupDir?: string;
  /** Writes `owned_file` intents, keeping a file the user edited. init passes
   *  its run's guard; without one an install uses its own (init/file-guard.ts). */
  fileGuard?: OwnedFileWriter;
}

/** How a managed block of one delimiter form is read and merged. */
export interface ManagedBlockForm {
  /** Names the block in warnings. */
  label: string;
  /** The block's body in a file's text, or null when it has none. */
  read(text: string): string | null;
  /** The file's text with the generated block merged in. */
  merge(text: string): string;
}

/** The part of init's FileGuard an install needs for `owned_file` intents
 *  and instruction blocks. */
export interface OwnedFileWriter {
  write(dest: string, content: string): 'written' | 'unchanged' | 'kept';
  /** `form.merge(existing)`, or null when the user edited the block and it is kept. */
  guardBlock(
    file: string,
    existing: string,
    marker: string,
    generated: string,
    form: ManagedBlockForm,
  ): string | null;
  readonly warnings: readonly string[];
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
  /** `owned_file`: the whole file is Monomind's, owned through the init
   *  manifest's hashes rather than in-file markers (GH #344). */
  replace: 'managed_block' | 'named_entry' | 'create_if_missing' | 'owned_file';
  /** For `owned_file`, the marker older versions wrapped the file in. */
  marker?: string;
  /** Path below a declared directory root (currently used by skill packages). */
  relativePath?: string;
  /**
   * Set when several platforms declare this same directory (`.agents/skills`):
   * the block is co-owned, so its marker names the surface, not the platform.
   */
  surface?: string;
  /** Earlier per-platform markers of this same artifact, folded into `marker` on apply. */
  supersedes?: readonly string[];
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
    /**
     * 'gated' marks a location that is concretely declared in the registry
     * but whose owning capability is not 'native' (experimental, cli_fallback,
     * or unsupported) — the renderer intentionally never writes it, so it is
     * not an actionable gap.
     */
    state: 'managed' | 'missing' | 'legacy' | 'foreign' | 'gated';
    /** Set only for 'gated' artifacts: which capability is gating it, and at what level. */
    reason?: string;
  }[];
  legacy: { findings: readonly string[]; migratable: boolean };
  diagnostics: readonly string[];
  sanitized: true;
}
