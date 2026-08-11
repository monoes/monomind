import { createRequire } from 'module';
import Parser from 'tree-sitter';
import type { LanguageConfig } from './language-config.js';
import { LANGUAGE_EXTENSIONS, extractSymbolsForLanguage } from './language-parsers.js';
import type { SymbolExtract } from './language-parsers.js';
import { makeId, toNormLabel, CONFIDENCE_SCORE } from '../types.js';
import type { MonographNode, MonographEdge, NodeLabel } from '../types.js';

const require = createRequire(import.meta.url);

const parserCache = new Map<string, Parser>();
const configCache = new Map<string, LanguageConfig>();

export async function loadConfig(ext: string): Promise<LanguageConfig | null> {
  if (configCache.has(ext)) return configCache.get(ext)!;

  let config: LanguageConfig | null = null;
  if (
    ext === '.ts' ||
    ext === '.tsx' ||
    ext === '.js' ||
    ext === '.jsx' ||
    ext === '.mjs' ||
    ext === '.cjs'
  ) {
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
  } else if (
    ext === '.cpp' ||
    ext === '.cc' ||
    ext === '.cxx' ||
    ext === '.hpp' ||
    ext === '.hxx'
  ) {
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

export async function getParser(
  ext: string,
): Promise<{ parser: Parser; config: LanguageConfig } | null> {
  const config = await loadConfig(ext);
  if (!config) return null;

  if (parserCache.has(ext)) {
    return { parser: parserCache.get(ext)!, config };
  }

  try {
    const lang = config.getLanguage();
    if (!lang) throw new Error('getLanguage() returned undefined');
    const parser = new Parser();
    parser.setLanguage(lang);
    parserCache.set(ext, parser);
    return { parser, config };
  } catch {
    // Grammar unavailable at runtime (ABI mismatch, native build failure, etc.) — skip silently.
    return null;
  }
}

export function isSupportedExtension(ext: string): boolean {
  const supported = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.go',
    '.rs',
    '.java',
    '.c',
    '.h',
    '.cpp',
    '.cc',
    '.cxx',
    '.hpp',
    '.hxx',
    '.cs',
    '.rb',
    '.swift',
    '.php',
    '.vue',
    '.kt',
    '.kts',
    '.dart',
    // Regex-based extractors (no tree-sitter grammar required) — see extractSymbolsForLanguage.
    '.scala',
    '.sc',
    '.lua',
    '.zig',
    '.ps1',
    '.psm1',
    '.ex',
    '.exs',
  ];
  return supported.includes(ext);
}

export function getLanguageForExt(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.swift': 'swift',
    '.php': 'php',
    '.vue': 'vue',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.dart': 'dart',
    '.scala': 'scala',
    '.sc': 'scala',
    '.lua': 'lua',
    '.zig': 'zig',
    '.ps1': 'powershell',
    '.psm1': 'powershell',
    '.ex': 'elixir',
    '.exs': 'elixir',
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
  const config = await loadConfig(ext);
  const entry = config ? await getParser(ext) : null;

  // MONO-2: Tree-sitter grammar expected (config exists) but failed to load at
  // runtime (ABI mismatch, native build failure). Surface a parseError so the
  // build doesn't silently emit a successful-looking empty result for that
  // language family.
  if (config && !entry) {
    return {
      nodes: [],
      edges: [],
      parseErrors: [`${repoRelativePath}: ${config.name} grammar load failed`],
    };
  }

  // No tree-sitter grammar available — try the regex-based extractor for the
  // languages in LANGUAGE_EXTENSIONS (Scala/Lua/Zig/PowerShell/Elixir). If even
  // that doesn't apply, return empty (truly unsupported file type).
  if (!entry) {
    const lang = LANGUAGE_EXTENSIONS[ext];
    if (!lang) return { nodes: [], edges: [], parseErrors: [] };
    try {
      return convertSymbolExtracts(
        extractSymbolsForLanguage(sourceText, repoRelativePath, lang),
        repoRelativePath,
        lang,
      );
    } catch (err) {
      return { nodes: [], edges: [], parseErrors: [`${repoRelativePath}: ${err}`] };
    }
  }

  const { parser, config: parserConfig } = entry;
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
    const result = extractSymbols(tree, source, repoRelativePath, parserConfig, ext);
    // MONO-2: tree-sitter inserts ERROR/MISSING nodes when the input is malformed
    // but still produces a best-effort tree. The extractor walk yields partial results
    // from that recovered tree (which is fine), but we also surface a parseError so
    // callers can tell recovery happened instead of seeing a silently-degraded graph.
    if (tree.rootNode.hasError) {
      result.parseErrors.push(`${repoRelativePath}: tree-sitter reported parse errors (recovered)`);
    }
    return result;
  } catch (err) {
    return { nodes: [], edges: [], parseErrors: [`${repoRelativePath}: ${err}`] };
  }
}

/**
 * Convert regex-extracted symbols (from language-parsers.ts) into the same
 * MonographNode/MonographEdge shape the tree-sitter extractor emits: a File
 * node plus one symbol node per extract, linked by CONTAINS edges.
 */
function convertSymbolExtracts(
  extracts: SymbolExtract[],
  repoRelativePath: string,
  language: string,
): ParseResult {
  const nodes: MonographNode[] = [];
  const edges: MonographEdge[] = [];

  const fileNodeId = makeId(repoRelativePath.replace(/\//g, '_'), 'file');
  const fileName = repoRelativePath.split('/').pop() ?? repoRelativePath;
  nodes.push({
    id: fileNodeId,
    label: 'File',
    name: fileName,
    normLabel: toNormLabel(fileName),
    filePath: repoRelativePath,
    isExported: false,
    language,
  });

  for (const ex of extracts) {
    const label = ex.label as NodeLabel;
    const id = makeId(repoRelativePath.replace(/\//g, '_'), ex.name, label.toLowerCase());
    nodes.push({
      id,
      label,
      name: ex.name,
      normLabel: toNormLabel(ex.name),
      filePath: repoRelativePath,
      startLine: ex.line,
      isExported: ex.isExported,
      language,
    });
    edges.push({
      id: makeId(fileNodeId, id, 'contains'),
      sourceId: fileNodeId,
      targetId: id,
      relation: 'CONTAINS',
      confidence: 'EXTRACTED',
      confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
    });
  }

  return { nodes, edges, parseErrors: [] };
}
