export type OutputFormat = 'text' | 'json' | 'compact';

export interface FlagsOptions {
  root: string;
  configPath?: string;
  output: OutputFormat;
  noCache: boolean;
  threads: number;
  quiet: boolean;
  production: boolean;
  workspace?: string[];
  changedWorkspaces?: string;
  changedSince?: string;
  explain: boolean;
  top?: number;
}

export interface FeatureFlag {
  name: string;
  filePath: string;
  isEnabled: boolean | null;
  condition?: string;
  line?: number;
}

export interface FlagUse {
  name: string;
  isEnabled: boolean | null;
  condition?: string;
  span?: { start: number; end: number };
}

export interface FlagsResult {
  flags: FeatureFlag[];
  totalFiles: number;
  totalFlags: number;
}

export function flagUseToFeatureFlag(flagUse: FlagUse, filePath: string, line?: number): FeatureFlag {
  return {
    name: flagUse.name,
    filePath,
    isEnabled: flagUse.isEnabled,
    condition: flagUse.condition,
    line,
  };
}

export function groupFlagsByName(flags: FeatureFlag[]): Map<string, FeatureFlag[]> {
  const map = new Map<string, FeatureFlag[]>();
  for (const flag of flags) {
    const existing = map.get(flag.name);
    if (existing) existing.push(flag);
    else map.set(flag.name, [flag]);
  }
  return map;
}

export function formatFlagsText(result: FlagsResult, top?: number): string {
  const lines: string[] = [
    `Feature flags: ${result.totalFlags} across ${result.totalFiles} files`,
    '',
  ];
  const entries = [...groupFlagsByName(result.flags).entries()];
  const sorted = entries.sort((a, b) => b[1].length - a[1].length);
  const limited = top !== undefined ? sorted.slice(0, top) : sorted;
  for (const [name, uses] of limited) {
    lines.push(`  ${name} (${uses.length} uses)`);
    for (const u of uses) lines.push(`    ${u.filePath}${u.line !== undefined ? `:${u.line}` : ''}`);
  }
  return lines.join('\n');
}
