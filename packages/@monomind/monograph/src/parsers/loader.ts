import Parser from 'tree-sitter';
import type { LanguageConfig } from './language-config.js';

const parserCache = new Map<string, Parser>();
const configCache = new Map<string, LanguageConfig>();

async function loadConfig(ext: string): Promise<LanguageConfig | null> {
  if (configCache.has(ext)) return configCache.get(ext)!;

  let config: LanguageConfig | null = null;
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
    const { typescriptConfig } = await import('./typescript.js');
    config = typescriptConfig;
  } else if (ext === '.py') {
    const { pythonConfig } = await import('./python.js');
    config = pythonConfig;
  } else if (ext === '.go') {
    const { goConfig } = await import('./go.js');
    config = goConfig;
  } else if (ext === '.rs') {
    const { rustConfig } = await import('./rust.js');
    config = rustConfig;
  } else if (ext === '.java') {
    const { javaConfig } = await import('./java.js');
    config = javaConfig;
  }

  if (config) {
    for (const e of config.extensions) configCache.set(e, config);
  }
  return config;
}

export async function getParser(ext: string): Promise<{ parser: Parser; config: LanguageConfig } | null> {
  const config = await loadConfig(ext);
  if (!config) return null;

  if (parserCache.has(ext)) {
    return { parser: parserCache.get(ext)!, config };
  }

  const parser = new Parser();
  parser.setLanguage(config.getLanguage());
  parserCache.set(ext, parser);
  return { parser, config };
}

export function isSupportedExtension(ext: string): boolean {
  const supported = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java'];
  return supported.includes(ext);
}

export function getLanguageForExt(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript',
    '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
  };
  return map[ext] ?? 'unknown';
}
