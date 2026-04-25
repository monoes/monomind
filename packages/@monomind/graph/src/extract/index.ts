import { readFileSync, mkdirSync } from 'fs';
import { extname } from 'path';
import type { ClassifiedFile, ExtractionResult, BuildOptions, GraphNode, GraphEdge } from '../types.js';
import type { LanguageExtractor } from './types.js';
import { FileCache } from '../cache.js';
import { typescriptExtractor } from './languages/typescript.js';
import { pythonExtractor } from './languages/python.js';
import { goExtractor } from './languages/go.js';
import { rustExtractor } from './languages/rust.js';

// ---- registry ----

const EXTRACTORS: LanguageExtractor[] = [
  typescriptExtractor,
  pythonExtractor,
  goExtractor,
  rustExtractor,
];

/** Build a lookup from file extension → extractor */
const EXT_MAP = new Map<string, LanguageExtractor>(
  EXTRACTORS.flatMap((e) => e.extensions.map((ext) => [ext, e])),
);

/** Build a lookup from language name → extractor */
const LANG_MAP = new Map<string, LanguageExtractor>(
  EXTRACTORS.map((e) => [e.language, e]),
);

function resolveExtractor(file: ClassifiedFile): LanguageExtractor | null {
  if (file.language) {
    const byLang = LANG_MAP.get(file.language.toLowerCase());
    if (byLang) return byLang;
  }
  const ext = extname(file.path).toLowerCase();
  return EXT_MAP.get(ext) ?? null;
}

// ---- result merging ----

function mergeResults(results: ExtractionResult[]): ExtractionResult {
  const nodeMap = new Map<string, GraphNode>();
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];
  const errors: string[] = [];
  let filesProcessed = 0;
  let fromCache = 0;

  for (const r of results) {
    filesProcessed += r.filesProcessed;
    fromCache += r.fromCache;
    errors.push(...r.errors);

    for (const node of r.nodes) {
      // Deduplicate by id — keep the first occurrence
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
      }
    }

    for (const edge of r.edges) {
      // Deduplicate edges by source+target+relation key
      const key = `${edge.source}||${edge.target}||${edge.relation}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push(edge);
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    filesProcessed,
    fromCache,
    errors,
  };
}

// ---- public API ----

/**
 * Extract graph nodes and edges from all classified files.
 *
 * Reads each file, checks the on-disk cache keyed by SHA-256 content hash,
 * dispatches to the appropriate language extractor, and merges all results
 * into a single ExtractionResult (nodes deduplicated by id, edges by source+target+relation).
 *
 * @param files      - Classified files to process (from the classify layer)
 * @param outputDir  - Directory used for cache storage (.monobrain/graph by default)
 * @param options    - Build options (languages filter, maxFileSizeBytes, etc.)
 */
export async function extractAll(
  files: ClassifiedFile[],
  outputDir: string,
  options?: BuildOptions,
): Promise<ExtractionResult> {
  const maxSize = options?.maxFileSizeBytes ?? 500 * 1024; // 500 KB
  const langFilter = options?.languages?.map((l) => l.toLowerCase());

  mkdirSync(outputDir, { recursive: true });
  const cache = new FileCache(outputDir);

  const results: ExtractionResult[] = [];

  for (const file of files) {
    // Skip files that are too large
    if (file.sizeBytes > maxSize) {
      results.push({
        nodes: [],
        edges: [],
        filesProcessed: 1,
        fromCache: 0,
        errors: [`Skipped ${file.path}: file size ${file.sizeBytes} exceeds limit ${maxSize}`],
      });
      continue;
    }

    // Apply language filter
    if (langFilter && langFilter.length > 0) {
      const extractor = resolveExtractor(file);
      const fileLang = (file.language ?? '').toLowerCase();
      const extractorLang = extractor?.language ?? '';
      if (!langFilter.includes(fileLang) && !langFilter.includes(extractorLang)) {
        continue;
      }
    }

    const extractor = resolveExtractor(file);
    if (!extractor) {
      // No extractor for this file type — skip silently
      continue;
    }

    // Read content
    let content: string;
    try {
      content = readFileSync(file.path, 'utf8');
    } catch (err) {
      results.push({
        nodes: [],
        edges: [],
        filesProcessed: 1,
        fromCache: 0,
        errors: [`Failed to read ${file.path}: ${err instanceof Error ? err.message : String(err)}`],
      });
      continue;
    }

    // Check cache using FileCache (keyed on filePath + content hash)
    const cacheKey = cache.key(file.path, content);
    const cached = cache.get(cacheKey);
    if (cached) {
      results.push({
        ...cached,
        filesProcessed: 1,
        fromCache: 1,
      });
      continue;
    }

    // Extract
    let result: ExtractionResult;
    try {
      result = extractor.extract(file.path, content);
    } catch (err) {
      result = {
        nodes: [],
        edges: [],
        filesProcessed: 1,
        fromCache: 0,
        errors: [`Extractor error for ${file.path}: ${err instanceof Error ? err.message : String(err)}`],
      };
    }

    // Store in cache
    cache.set(cacheKey, result);
    results.push(result);
  }

  return mergeResults(results);
}

// Re-export types and utilities for consumers
export type { LanguageExtractor } from './types.js';
export { typescriptExtractor } from './languages/typescript.js';
export { pythonExtractor } from './languages/python.js';
export { goExtractor } from './languages/go.js';
export { rustExtractor } from './languages/rust.js';
export { isTreeSitterAvailable, tryLoadParser, walk, parseFile, parseFileFromDisk } from './tree-sitter-runner.js';
