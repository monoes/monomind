import { readFileSync } from 'fs';
import type { ExtractionResult } from '../types.js';
import type { LanguageExtractor } from './types.js';

// Dynamic type references — the real shapes come from node-tree-sitter at runtime.
// We use `unknown` here so that the module compiles without the optional dep installed.
type ParserInstance = {
  setLanguage(lang: unknown): void;
  parse(src: string): { rootNode: SyntaxNodeLike };
};

export type SyntaxNodeLike = {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: SyntaxNodeLike[];
  childForFieldName(name: string): SyntaxNodeLike | null;
  descendantsOfType(type: string | string[]): SyntaxNodeLike[];
};

// ---- availability probe ----

let _treeSitterAvailable: boolean | null = null;
let _ParserCtor: (new () => ParserInstance) | null = null;

function probeTreeSitter(): void {
  if (_treeSitterAvailable !== null) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('node-tree-sitter') as { default?: unknown } | unknown;
    const ctor =
      (mod as { default?: unknown }).default !== undefined
        ? (mod as { default: unknown }).default
        : mod;
    if (typeof ctor === 'function') {
      _ParserCtor = ctor as new () => ParserInstance;
      _treeSitterAvailable = true;
    } else {
      _treeSitterAvailable = false;
    }
  } catch {
    _treeSitterAvailable = false;
  }
}

/**
 * Returns true when node-tree-sitter is installed and loadable.
 */
export function isTreeSitterAvailable(): boolean {
  probeTreeSitter();
  return _treeSitterAvailable === true;
}

// ---- language grammar loader ----

const LANGUAGE_MODULE_MAP: Record<string, string> = {
  typescript: 'tree-sitter-typescript',
  tsx: 'tree-sitter-typescript',
  javascript: 'tree-sitter-javascript',
  jsx: 'tree-sitter-javascript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
  csharp: 'tree-sitter-c-sharp',
  ruby: 'tree-sitter-ruby',
  kotlin: 'tree-sitter-kotlin',
  swift: 'tree-sitter-swift',
  scala: 'tree-sitter-scala',
  php: 'tree-sitter-php',
};

/**
 * Attempts to create a configured Parser for the given language identifier.
 * Returns null when tree-sitter or the grammar is not installed.
 */
export function tryLoadParser(language: string): ParserInstance | null {
  if (!isTreeSitterAvailable() || _ParserCtor === null) return null;

  const moduleName = LANGUAGE_MODULE_MAP[language];
  if (!moduleName) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const grammarMod = require(moduleName) as Record<string, unknown>;

    // tree-sitter-typescript exposes { typescript, tsx } sub-grammars
    let grammar: unknown;
    if (language === 'typescript' || language === 'tsx') {
      grammar =
        (grammarMod as { typescript?: unknown; tsx?: unknown })[language] ??
        grammarMod['default'] ??
        grammarMod;
    } else {
      grammar = grammarMod['default'] ?? grammarMod;
    }

    const parser = new _ParserCtor!();
    parser.setLanguage(grammar);
    return parser;
  } catch {
    return null;
  }
}

// ---- depth-first AST walker ----

export function walk(
  node: SyntaxNodeLike,
  visitor: (n: SyntaxNodeLike) => void,
): void {
  visitor(node);
  for (const child of node.children) {
    walk(child, visitor);
  }
}

// ---- main entry point ----

/**
 * Parses a source file and delegates to the given LanguageExtractor.
 * The extractor receives the file path and raw content; it owns the AST
 * traversal internally (using tryLoadParser / walk from this module).
 *
 * Falls back gracefully: if tree-sitter cannot be loaded the extractor is still
 * called with the raw content and is expected to use its regex fallback.
 */
export function parseFile(
  filePath: string,
  content: string,
  extractor: LanguageExtractor,
): ExtractionResult {
  try {
    return extractor.extract(filePath, content);
  } catch (err) {
    return {
      nodes: [],
      edges: [],
      filesProcessed: 1,
      fromCache: 0,
      errors: [
        `parseFile error for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

/**
 * Convenience helper: read a file from disk and parse it.
 */
export function parseFileFromDisk(
  filePath: string,
  extractor: LanguageExtractor,
): ExtractionResult {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      nodes: [],
      edges: [],
      filesProcessed: 1,
      fromCache: 0,
      errors: [
        `Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
  return parseFile(filePath, content, extractor);
}
