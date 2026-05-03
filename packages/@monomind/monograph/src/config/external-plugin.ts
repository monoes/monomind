// Loads and discovers external monograph plugins from node_modules.
// External plugins declare entry points and used exports to suppress false positives.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type EntryPointRole = 'productionSource' | 'testSource' | 'entryPoint' | 'configFile';

export interface ExternalUsedExport {
  symbol: string;
  scopeOverride?: string;
}

export interface ExternalEntryPoint {
  pattern: string;
  role: EntryPointRole;
}

export interface ExternalPluginDef {
  name: string;
  version: string;
  entryPoints: ExternalEntryPoint[];
  usedExports: ExternalUsedExport[];
  suppressPatterns: string[];
}

export const PLUGIN_MANIFEST_KEY = 'monograph-plugin';

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function discoverExternalPlugins(root: string): ExternalPluginDef[] {
  const nmDir = join(root, 'node_modules');
  if (!existsSync(nmDir)) return [];

  const plugins: ExternalPluginDef[] = [];

  try {
    const entries = readdirSync(nmDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(nmDir, entry.name, 'package.json');
      const pkg = readJson(pkgPath);
      if (!pkg) continue;

      const manifest = pkg[PLUGIN_MANIFEST_KEY];
      if (!manifest || typeof manifest !== 'object') continue;

      const m = manifest as Record<string, unknown>;
      plugins.push({
        name: (pkg['name'] as string | undefined) ?? entry.name,
        version: (pkg['version'] as string | undefined) ?? '0.0.0',
        entryPoints: (m['entryPoints'] as ExternalEntryPoint[] | undefined) ?? [],
        usedExports: (m['usedExports'] as ExternalUsedExport[] | undefined) ?? [],
        suppressPatterns: (m['suppressPatterns'] as string[] | undefined) ?? [],
      });
    }
  } catch { /* skip */ }

  return plugins;
}

export function mergePluginSuppressPatterns(plugins: ExternalPluginDef[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of plugins) {
    for (const pat of p.suppressPatterns) {
      if (!seen.has(pat)) { seen.add(pat); result.push(pat); }
    }
  }
  return result;
}
