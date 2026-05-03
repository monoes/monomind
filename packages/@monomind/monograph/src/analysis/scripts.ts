// Analyzes npm scripts fields and CI config files to derive additional
// entry points for dead-code analysis.

export interface ScriptCommand {
  binary: string;
  args: string[];
  sourceScript: string;
}

export interface ScriptAnalysis {
  entryPatterns: string[];
  commands: ScriptCommand[];
  binToPackage: Map<string, string>;
}

export interface CiAnalysis {
  entryPatterns: string[];
  detectedRunners: string[];
}

const PACKAGE_MANAGER_PREFIXES = ['npx', 'pnpm', 'yarn', 'bunx', 'nx', 'turbo'];
const SHELL_OPERATORS = /&&|\|\||;|\|/;

export function splitShellOperators(script: string): string[] {
  return script.split(SHELL_OPERATORS).map(s => s.trim()).filter(Boolean);
}

export function skipInitialWrappers(parts: string[]): string[] {
  const skip = new Set(['env', 'cross-env', 'dotenv', 'run-s', 'run-p', 'concurrently']);
  let i = 0;
  while (i < parts.length && (skip.has(parts[i]) || parts[i].includes('='))) i++;
  return parts.slice(i);
}

export function parseScriptCommand(raw: string): ScriptCommand | null {
  const segments = splitShellOperators(raw);
  const first = segments[0];
  if (!first) return null;

  const tokens = first.split(/\s+/).filter(Boolean);
  const adjusted = skipInitialWrappers(tokens);
  if (!adjusted.length) return null;

  let binary = adjusted[0];
  let args = adjusted.slice(1);

  if (PACKAGE_MANAGER_PREFIXES.includes(binary) && args.length) {
    binary = args[0];
    args = args.slice(1);
  }

  return { binary, args, sourceScript: raw };
}

export function filterProductionScripts(scripts: Record<string, string>): Record<string, string> {
  const devKeys = /^(dev|test|lint|type-check|watch|storybook|e2e)/;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(scripts)) {
    if (!devKeys.test(k)) result[k] = v;
  }
  return result;
}

export function analyzeScripts(
  scripts: Record<string, string>,
  _root?: string,
): ScriptAnalysis {
  const production = filterProductionScripts(scripts);
  const commands: ScriptCommand[] = [];
  const entryPatterns: string[] = [];

  for (const raw of Object.values(production)) {
    const cmd = parseScriptCommand(raw);
    if (cmd) commands.push(cmd);
  }

  return { entryPatterns, commands, binToPackage: new Map() };
}

export function buildBinToPackageMap(packageJson: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const name = packageJson['name'] as string | undefined;
  if (!name) return map;
  const bin = packageJson['bin'];
  if (typeof bin === 'string') {
    map.set(name, name);
  } else if (typeof bin === 'object' && bin !== null) {
    for (const k of Object.keys(bin as object)) map.set(k, name);
  }
  return map;
}

export function analyzeCiFiles(_root: string): CiAnalysis {
  return { entryPatterns: [], detectedRunners: [] };
}
