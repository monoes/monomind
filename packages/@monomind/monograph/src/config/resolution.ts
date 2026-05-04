// Config resolution system: merges base configs via extends chains.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type ExtendsSource =
  | { kind: 'file'; path: string }
  | { kind: 'npm'; packageName: string }
  | { kind: 'url'; url: string };

export interface ResolvedInheritance {
  source: ExtendsSource;
  config: Record<string, unknown>;
}

export function parseExtendsValue(raw: string): ExtendsSource {
  if (raw.startsWith('npm:')) return { kind: 'npm', packageName: raw.slice(4) };
  if (raw.startsWith('https://') || raw.startsWith('http://')) return { kind: 'url', url: raw };
  return { kind: 'file', path: raw };
}

export function resolveFileExtends(
  configPath: string,
  extendsPath: string,
): Record<string, unknown> | null {
  const dir = dirname(resolve(configPath));
  const abs = resolve(dir, extendsPath);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolveNpmExtends(
  root: string,
  packageName: string,
): Record<string, unknown> | null {
  const candidates = ['monograph.json', 'monograph.config.json', '.monographrc.json'];
  let dir = root;
  while (true) {
    const pkgDir = resolve(dir, 'node_modules', packageName);
    if (existsSync(pkgDir)) {
      for (const name of candidates) {
        const path = resolve(pkgDir, name);
        if (existsSync(path)) {
          try {
            return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
          } catch { return null; }
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function mergeConfigs(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (key === 'extends') continue;
    if (Array.isArray(val) && Array.isArray(result[key])) {
      result[key] = [...(result[key] as unknown[]), ...val];
    } else if (typeof val === 'object' && val !== null && typeof result[key] === 'object' && result[key] !== null) {
      result[key] = mergeConfigs(result[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result;
}

export async function resolveConfigExtends(
  config: Record<string, unknown>,
  configPath: string,
  root: string,
  depth = 0,
): Promise<Record<string, unknown>> {
  if (depth > 10) return config;
  const extendsVal = config['extends'];
  if (!extendsVal) return config;
  const sources = Array.isArray(extendsVal) ? extendsVal as string[] : [extendsVal as string];
  let resolved = { ...config };
  delete resolved['extends'];
  for (const src of sources) {
    const parsed = parseExtendsValue(src);
    let base: Record<string, unknown> | null = null;
    if (parsed.kind === 'file') base = resolveFileExtends(configPath, parsed.path);
    else if (parsed.kind === 'npm') base = resolveNpmExtends(root, parsed.packageName);
    if (base) {
      const resolvedBase = await resolveConfigExtends(base, configPath, root, depth + 1);
      resolved = mergeConfigs(resolvedBase, resolved);
    }
  }
  return resolved;
}
