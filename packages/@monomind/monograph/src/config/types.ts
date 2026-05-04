// Complete monograph configuration schema — all config structs for
// constructing a resolved config from disk and validating config files.

export type ProductionAnalysis = 'files' | 'exports';

export interface PerAnalysisProductionConfig {
  files?: boolean;
  exports?: boolean;
}

export type ProductionConfigValue = boolean | PerAnalysisProductionConfig;

export interface RegressionConfig {
  tolerance?: number;
  baselinePath?: string;
}

export interface AuditConfig {
  gate?: 'error' | 'warn' | 'off';
  includeHealthGate?: boolean;
}

export type DetectionMode = 'default' | 'aggressive' | 'lenient';

export interface NormalizationConfig {
  stripComments?: boolean;
  normalizeWhitespace?: boolean;
  normalizeIdentifiers?: boolean;
}

export interface BoundaryRule {
  from: string | string[];
  to: string | string[];
  tag?: string;
}

export interface BoundaryZone {
  name: string;
  pattern: string | string[];
  rules?: BoundaryRule[];
}

export interface BoundaryConfig {
  preset?: 'domain-driven' | 'layered' | 'none';
  zones?: BoundaryZone[];
  rules?: BoundaryRule[];
}

export interface ResolveConfig {
  paths?: Record<string, string[]>;
  alias?: Record<string, string>;
  conditions?: string[];
  extensions?: string[];
}

export interface HealthConfig {
  cyclomaticThreshold?: number;
  cognitiveThreshold?: number;
  crapThreshold?: number;
  minLines?: number;
}

export interface OwnershipConfig {
  codeownersPath?: string;
  emailMode?: 'fullEmail' | 'domainEmail' | 'displayName';
}

export interface IgnoreExportRule {
  pattern: string;
  reason?: string;
}

export interface ConfigOverride {
  files?: string[];
  ignore?: IgnoreExportRule[];
  production?: ProductionConfigValue;
}

export interface MonographConfig {
  root?: string;
  entry?: string | string[];
  project?: string;
  production?: ProductionConfigValue;
  ignore?: IgnoreExportRule[];
  overrides?: ConfigOverride[];
  regression?: RegressionConfig;
  audit?: AuditConfig;
  detection?: DetectionMode;
  normalization?: NormalizationConfig;
  boundaries?: BoundaryConfig;
  resolve?: ResolveConfig;
  health?: HealthConfig;
  ownership?: OwnershipConfig;
  plugins?: string[];
}

export interface ResolvedMonographConfig extends Required<Pick<MonographConfig, 'root' | 'entry' | 'production' | 'detection'>> {
  project: string | undefined;
  ignore: IgnoreExportRule[];
  overrides: ConfigOverride[];
  regression: Required<RegressionConfig>;
  audit: Required<AuditConfig>;
  normalization: Required<NormalizationConfig>;
  boundaries: BoundaryConfig;
  resolve: Required<ResolveConfig>;
  health: Required<HealthConfig>;
  ownership: Required<OwnershipConfig>;
  plugins: string[];
}

export const DEFAULT_MONOGRAPH_CONFIG: ResolvedMonographConfig = {
  root: '.',
  entry: [],
  production: true,
  detection: 'default',
  project: undefined,
  ignore: [],
  overrides: [],
  regression: { tolerance: 0, baselinePath: '.monograph/regression-baseline.json' },
  audit: { gate: 'error', includeHealthGate: false },
  normalization: { stripComments: true, normalizeWhitespace: true, normalizeIdentifiers: false },
  boundaries: {},
  resolve: { paths: {}, alias: {}, conditions: [], extensions: ['.ts', '.tsx', '.mts', '.cts'] },
  health: { cyclomaticThreshold: 10, cognitiveThreshold: 15, crapThreshold: 30, minLines: 5 },
  ownership: { emailMode: 'fullEmail' },
  plugins: [],
};

// ── Round 10: extended MonographConfig fields ──────────────────────────────────

export interface ExtendedMonographConfig extends MonographConfig {
  extends?: string[];
  sealed?: boolean;
  includeEntryExports?: boolean;
  publicPackages?: string[];
  dynamicallyLoaded?: string[];
  codeowners?: string;
  ignoreDependencies?: string[];
  ignoreExportsUsedInFile?: boolean | { interface?: boolean; typeAlias?: boolean };
  usedClassMembers?: Array<string | { extends?: string[]; implements?: string[]; members: string[] }>;
  duplicates?: {
    enabled?: boolean;
    mode?: 'strict' | 'mild' | 'weak' | 'semantic';
    minTokens?: number;
    minLines?: number;
    crossLanguage?: boolean;
    ignoreImports?: boolean;
  };
}
