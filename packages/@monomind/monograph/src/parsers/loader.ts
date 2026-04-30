import { createRequire } from 'module';
import Parser from 'tree-sitter';
import type { LanguageConfig } from './language-config.js';

const require = createRequire(import.meta.url);

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
  } else if (ext === '.c' || ext === '.h') {
    const { cConfig } = await import('./c.js');
    config = cConfig;
  } else if (ext === '.cpp' || ext === '.cc' || ext === '.cxx' || ext === '.hpp' || ext === '.hxx') {
    const { cppConfig } = await import('./cpp.js');
    config = cppConfig;
  } else if (ext === '.cs') {
    const { csharpConfig } = await import('./csharp.js');
    config = csharpConfig;
  } else if (ext === '.rb') {
    const { rubyConfig } = await import('./ruby.js');
    config = rubyConfig;
  } else if (ext === '.swift') {
    const { swiftConfig } = await import('./swift.js');
    config = swiftConfig;
  } else if (ext === '.php') {
    const { phpConfig } = await import('./php.js');
    config = phpConfig;
  } else if (ext === '.vue') {
    const { vueConfig } = await import('./vue.js');
    config = vueConfig;
  } else if (ext === '.kt' || ext === '.kts') {
    const { kotlinConfig } = await import('./kotlin.js');
    config = kotlinConfig;
  } else if (ext === '.dart') {
    const { dartConfig } = await import('./dart.js');
    config = dartConfig;
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

  try {
    const parser = new Parser();
    parser.setLanguage(config.getLanguage());
    parserCache.set(ext, parser);
    return { parser, config };
  } catch (err) {
    // Grammar unavailable at runtime (ABI mismatch, native build failure, etc.).
    // Log a warning and skip the language gracefully.
    console.warn(`[monograph] warning: grammar for "${config.name}" (${ext}) could not be loaded: ${err}`);
    return null;
  }
}

export function isSupportedExtension(ext: string): boolean {
  const supported = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.java',
    '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx',
    '.cs', '.rb', '.swift', '.php', '.vue',
    '.kt', '.kts', '.dart',
  ];
  return supported.includes(ext);
}

export function getLanguageForExt(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript',
    '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hxx': 'cpp',
    '.cs': 'csharp', '.rb': 'ruby', '.swift': 'swift', '.php': 'php', '.vue': 'vue',
    '.kt': 'kotlin', '.kts': 'kotlin', '.dart': 'dart',
  };
  return map[ext] ?? 'unknown';
}

export interface ParseResult {
  nodes: import('../types.js').MonographNode[];
  edges: import('../types.js').MonographEdge[];
  parseErrors: string[];
}

export async function parseFile(
  absolutePath: string,
  sourceText: string,
  repoRelativePath: string,
): Promise<ParseResult> {
  const ext = absolutePath.slice(absolutePath.lastIndexOf('.'));
  const entry = await getParser(ext);
  if (!entry) return { nodes: [], edges: [], parseErrors: [] };

  const { parser, config } = entry;
  try {
    // For .vue files using the TypeScript fallback grammar, extract only the <script> block
    // so the TypeScript parser does not choke on the HTML <template> and <style> sections.
    let source = sourceText;
    if (ext === '.vue') {
      let vueGrammarAvailable = false;
      try {
        require('tree-sitter-vue');
        vueGrammarAvailable = true;
      } catch {
        vueGrammarAvailable = false;
      }
      if (!vueGrammarAvailable) {
        const { extractVueScriptContent } = await import('./vue.js');
        const extracted = extractVueScriptContent(sourceText);
        source = extracted.content || sourceText;
      }
    }
    const tree = parser.parse(source);
    const { extractSymbols } = await import('./extractor.js');
    return extractSymbols(tree, source, repoRelativePath, config, ext);
  } catch (err) {
    return { nodes: [], edges: [], parseErrors: [`${repoRelativePath}: ${err}`] };
  }
}
