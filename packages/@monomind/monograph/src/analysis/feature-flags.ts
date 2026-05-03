import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

export type FlagKind = 'EnvironmentVariable' | 'SdkCall' | 'ConfigObject';
export type FlagConfidence = 'High' | 'Medium' | 'Low';

export interface FeatureFlag {
  filePath: string;
  flagName: string;
  kind: FlagKind;
  confidence: FlagConfidence;
  line: number;
  col: number;
  sdkName?: string;
  guardLineStart?: number;
  guardLineEnd?: number;
  guardedDeadExports?: string[];
}

export interface FlagsConfig {
  sdkPatterns: string[];
  envPrefixes: string[];
}

export const DEFAULT_FLAGS_CONFIG: FlagsConfig = {
  envPrefixes: ['FEATURE_', 'FF_', 'FLAG_', 'ENABLE_', 'DISABLE_', 'AB_', 'EXP_', 'EXPERIMENT_'],
  sdkPatterns: [
    'launchdarkly', 'ld-client', '@launchdarkly',
    'statsig', '@statsig',
    'unleash', 'unleash-client',
    'growthbook', '@growthbook',
    'configcat', 'config-cat',
    'flagsmith',
    'split-io', '@splitsoftware',
  ],
};

// SDK method patterns that signal flag evaluation
const SDK_CALL_PATTERNS = [
  /\.variation\s*\(/,
  /\.isEnabled\s*\(/,
  /\.checkGate\s*\(/,
  /\.getExperiment\s*\(/,
  /\.isOn\s*\(/,
  /\.getFeature\s*\(/,
  /\.getTreatment\s*\(/,
  /\.evaluate\s*\(/,
  /featureIsEnabled\s*\(/,
  /getFlag\s*\(/,
  /flagEnabled\s*\(/,
];

const ENV_VAR_RE = /process\.env\.([A-Z][A-Z0-9_]+)/g;
const CONFIG_OBJECT_RE = /(?:featureFlags?|flags?|features?)\s*[\[.]\s*['"]([A-Za-z][A-Za-z0-9_-]*)['"]|(?:isEnabled|isActive|isOn)\s*\(\s*['"]([A-Za-z][A-Za-z0-9_-]*)['"]/g;

function isSourceFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'].includes(ext);
}

function detectFlagsInLine(
  line: string,
  lineNum: number,
  filePath: string,
  config: FlagsConfig,
): FeatureFlag[] {
  const found: FeatureFlag[] = [];

  // Environment variable flags
  let m: RegExpExecArray | null;
  const envRe = new RegExp(ENV_VAR_RE.source, 'g');
  while ((m = envRe.exec(line)) !== null) {
    const varName = m[1]!;
    const isFlag = config.envPrefixes.some(p => varName.startsWith(p));
    if (isFlag) {
      found.push({
        filePath, flagName: varName, kind: 'EnvironmentVariable',
        confidence: 'High', line: lineNum, col: m.index + 1,
      });
    }
  }

  // SDK call patterns
  for (const pattern of SDK_CALL_PATTERNS) {
    const sdkMatch = pattern.exec(line);
    if (sdkMatch) {
      // Try to extract the flag name from the first string argument
      const argMatch = line.slice(sdkMatch.index).match(/\(\s*['"]([^'"]+)['"]/);
      if (argMatch) {
        found.push({
          filePath, flagName: argMatch[1]!, kind: 'SdkCall',
          confidence: 'High', line: lineNum, col: sdkMatch.index + 1,
          sdkName: detectSdkName(line),
        });
      }
    }
  }

  // Config object heuristics
  const configRe = new RegExp(CONFIG_OBJECT_RE.source, 'g');
  while ((m = configRe.exec(line)) !== null) {
    const flagName = m[1] ?? m[2];
    if (flagName) {
      found.push({
        filePath, flagName, kind: 'ConfigObject',
        confidence: 'Medium', line: lineNum, col: m.index + 1,
      });
    }
  }

  return found;
}

function detectSdkName(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes('launchdarkly') || lower.includes('ldclient')) return 'LaunchDarkly';
  if (lower.includes('statsig')) return 'Statsig';
  if (lower.includes('unleash')) return 'Unleash';
  if (lower.includes('growthbook')) return 'GrowthBook';
  if (lower.includes('configcat')) return 'ConfigCat';
  if (lower.includes('flagsmith')) return 'Flagsmith';
  if (lower.includes('split')) return 'Split';
  return 'unknown';
}

export function analyzeFeatureFlags(
  rootDir: string,
  config: FlagsConfig = DEFAULT_FLAGS_CONFIG,
): FeatureFlag[] {
  const flags: FeatureFlag[] = [];
  walkDir(rootDir, filePath => {
    if (!isSourceFile(filePath)) return;
    let content: string;
    try { content = readFileSync(filePath, 'utf8'); } catch { return; }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const detected = detectFlagsInLine(lines[i]!, i + 1, filePath, config);
      flags.push(...detected);
    }
  });
  return flags;
}

export function crossReferenceWithDeadCode(
  flags: FeatureFlag[],
  deadExports: Array<{ filePath: string; name: string; line: number }>,
): FeatureFlag[] {
  return flags.map(flag => {
    if (flag.guardLineStart == null || flag.guardLineEnd == null) return flag;
    const guarded = deadExports
      .filter(e => e.filePath === flag.filePath &&
        e.line >= (flag.guardLineStart ?? 0) &&
        e.line <= (flag.guardLineEnd ?? Infinity))
      .map(e => e.name);
    return guarded.length > 0 ? { ...flag, guardedDeadExports: guarded } : flag;
  });
}

function walkDir(dir: string, fn: (filePath: string) => void): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'build') continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walkDir(full, fn);
    else if (st.isFile()) fn(full);
  }
}

export interface FlagsSummary {
  totalFlags: number;
  byKind: Record<FlagKind, number>;
  byConfidence: Record<FlagConfidence, number>;
  uniqueFlagNames: number;
  filesWithFlags: number;
  deadCodeOverlaps: number;
}

export function summarizeFlags(flags: FeatureFlag[]): FlagsSummary {
  return {
    totalFlags: flags.length,
    byKind: {
      EnvironmentVariable: flags.filter(f => f.kind === 'EnvironmentVariable').length,
      SdkCall: flags.filter(f => f.kind === 'SdkCall').length,
      ConfigObject: flags.filter(f => f.kind === 'ConfigObject').length,
    },
    byConfidence: {
      High: flags.filter(f => f.confidence === 'High').length,
      Medium: flags.filter(f => f.confidence === 'Medium').length,
      Low: flags.filter(f => f.confidence === 'Low').length,
    },
    uniqueFlagNames: new Set(flags.map(f => f.flagName)).size,
    filesWithFlags: new Set(flags.map(f => f.filePath)).size,
    deadCodeOverlaps: flags.filter(f => (f.guardedDeadExports?.length ?? 0) > 0).length,
  };
}
