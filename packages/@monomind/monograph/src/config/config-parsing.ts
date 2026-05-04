import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type ConfigFormat = 'json' | 'jsonc' | 'toml';

export const CONFIG_NAMES = [
  '.monographrc.json',
  '.monographrc.jsonc',
  'monograph.toml',
  '.monograph.toml',
  'monograph.json',
  'monograph.config.json',
] as const;

export function detectConfigFormat(filePath: string): ConfigFormat {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'jsonc') return 'jsonc';
  return 'toml';
}

function isRepoRoot(dir: string): boolean {
  return existsSync(resolve(dir, '.git'))
    || existsSync(resolve(dir, '.hg'))
    || existsSync(resolve(dir, '.svn'));
}

export function findConfigFile(startDir: string): string | undefined {
  let dir = startDir;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(dir)) break;
    visited.add(dir);
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    if (isRepoRoot(dir)) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function detectSourceRoot(projectRoot: string): string {
  for (const candidate of ['src', 'lib', 'app', 'source']) {
    if (existsSync(resolve(projectRoot, candidate))) return candidate;
  }
  return 'src';
}

function stripJsoncComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    if (inString) {
      if (text[i] === '\\') {
        result += text[i] + (text[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (text[i] === '"') inString = false;
      result += text[i++];
    } else if (text[i] === '"') {
      inString = true;
      result += text[i++];
    } else if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      result += text[i++];
    }
  }
  return result;
}

export function parseConfigFile(filePath: string): Record<string, unknown> {
  const content = readFileSync(filePath, 'utf8');
  const format = detectConfigFormat(filePath);

  if (format === 'toml') {
    throw new Error(
      `TOML config files are not supported without a TOML parser dependency. ` +
      `Convert ${filePath} to JSON format instead.`
    );
  }

  const stripped = format === 'jsonc' ? stripJsoncComments(content) : content;
  return JSON.parse(stripped) as Record<string, unknown>;
}

export function loadConfigFromDir(dir: string): { config: Record<string, unknown>; configPath: string } | undefined {
  const configPath = findConfigFile(dir);
  if (!configPath) return undefined;
  const config = parseConfigFile(configPath);
  return { config, configPath };
}
