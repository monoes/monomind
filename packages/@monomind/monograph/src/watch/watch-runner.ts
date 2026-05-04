import { extname, basename, relative } from 'node:path';

const SOURCE_EXTENSIONS = new Set([
  'ts','tsx','mts','cts','js','jsx','mjs','cjs',
  'vue','svelte','astro','mdx','css','scss',
]);

const CONFIG_FILENAMES = new Set([
  'package.json', '.fallowrc.json', '.fallowrc.jsonc',
  'fallow.toml', '.fallow.toml', 'tsconfig.json',
  'monograph.json', 'monograph.config.json', '.monographrc.json',
]);

export function isRelevantSource(filePath: string): boolean {
  const ext = extname(filePath).replace('.', '');
  return SOURCE_EXTENSIONS.has(ext);
}

export function isRelevantConfig(filePath: string): boolean {
  return CONFIG_FILENAMES.has(basename(filePath));
}

export function collectChangedPaths(rawPaths: string[], root: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of rawPaths) {
    if (!isRelevantSource(p) && !isRelevantConfig(p)) continue;
    const rel = relative(root, p);
    if (!seen.has(rel)) { seen.add(rel); result.push(rel); }
  }
  return result;
}

export interface WatchRunnerOptions {
  root: string;
  noCache?: boolean;
  quiet?: boolean;
  clearScreen?: boolean;
  debounceMs?: number;
  includeEntryExports?: boolean;
  onAnalysis: (changedPaths: string[]) => Promise<void>;
  loadConfig: () => Promise<unknown>;
}

export async function reloadConfigOrKeepPrevious<T>(
  current: T,
  loader: () => Promise<T>,
  onError?: (err: unknown) => void,
): Promise<T> {
  try {
    return await loader();
  } catch (err) {
    onError?.(err);
    return current;
  }
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  }) as T;
}
