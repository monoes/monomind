import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import type {
  BuildOptions,
  ExtractionResult,
  GraphAnalysis,
  SerializedGraph,
  GraphQuestion,
} from './types.js';
import { collectFiles, corpusHealth } from './detect.js';
import { FileCache } from './cache.js';
import { buildGraph as buildGraphologyGraph } from './build.js';
import { detectCommunities, cohesionScore } from './cluster.js';
import { buildAnalysis, suggestQuestions } from './analyze.js';
import { saveGraph } from './export.js';
import { exportHTML } from './visualize.js';
import { generateReport } from './report.js';
import { typescriptExtractor } from './extract/languages/typescript.js';
import { parseFile } from './extract/tree-sitter-runner.js';
import type { LanguageExtractor } from './extract/types.js';

const DEFAULT_OUTPUT_SUBDIR = '.monobrain/graph';

// Map language identifiers to the extractors we have available.
// python and go extractors are loaded lazily when their modules exist.
const EXTRACTOR_MAP: Record<string, LanguageExtractor> = {
  typescript: typescriptExtractor,
  javascript: typescriptExtractor, // TS extractor handles JS via regex + tree-sitter-javascript
};

/** Attempt to load python/go extractors that may be present in the extract/languages dir. */
async function tryLoadExtractor(language: string): Promise<LanguageExtractor | undefined> {
  if (EXTRACTOR_MAP[language]) return EXTRACTOR_MAP[language];
  try {
    const mod = await import(`./extract/languages/${language}.js`) as Record<string, LanguageExtractor | undefined>;
    const extractor = (mod[`${language}Extractor`] ?? mod['default']) as LanguageExtractor | undefined;
    if (extractor) EXTRACTOR_MAP[language] = extractor;
    return extractor;
  } catch {
    return undefined;
  }
}

/**
 * Main entry point for building a knowledge graph from a codebase.
 *
 * Orchestrates file collection, per-file extraction (with caching),
 * graph construction via graphology, community detection, and serialisation.
 *
 * @param projectPath - Absolute path to the root of the codebase to analyse.
 * @param options     - Optional build configuration.
 * @returns           - Serialized graph + analysis summary.
 */
export interface BuildResult {
  graph: SerializedGraph;
  analysis: GraphAnalysis;
  questions: GraphQuestion[];
  corpusWarnings: string[];
  filesProcessed: number;
  fromCache: number;
  graphPath: string;
  reportPath: string;
}

export async function buildGraph(
  projectPath: string,
  options: BuildOptions = {},
): Promise<BuildResult> {
  // Resolve output directory
  const outputDir = options.outputDir ?? join(projectPath, DEFAULT_OUTPUT_SUBDIR);
  mkdirSync(outputDir, { recursive: true });

  const cache = new FileCache(outputDir);

  // 1. Collect files + corpus health check
  const files = collectFiles(projectPath, options);
  const corpusWarnings = corpusHealth(files);

  // 2. Extract nodes/edges from each file (cache-aware)
  const merged: ExtractionResult = {
    nodes: [],
    edges: [],
    hyperedges: [],
    filesProcessed: 0,
    fromCache: 0,
    errors: [],
  };

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.path, 'utf-8');
    } catch (err) {
      merged.errors.push(`Cannot read ${file.path}: ${String(err)}`);
      continue;
    }

    const cacheKey = cache.key(file.path, content);

    let result = cache.get(cacheKey);
    if (result) {
      merged.fromCache += 1;
    } else {
      const extractor = file.language
        ? await tryLoadExtractor(file.language)
        : undefined;

      if (extractor) {
        result = parseFile(file.path, content, extractor);
      } else {
        result = extractGeneric(file.path, content);
      }
      cache.set(cacheKey, result);
    }

    merged.nodes.push(...result.nodes);
    merged.edges.push(...result.edges);
    if (result.hyperedges) merged.hyperedges!.push(...result.hyperedges);
    merged.filesProcessed += 1;
    merged.errors.push(...result.errors);
  }

  // 3. Build graphology graph (dedup + stub endpoints)
  const graph = buildGraphologyGraph(merged);

  // 4. Community detection (Louvain with directory-based fallback)
  await detectCommunities(graph);

  // 5. Degree annotation
  graph.forEachNode((id) => {
    graph.setNodeAttribute(id, 'degree', graph.degree(id));
  });

  // 6. Build analysis (god nodes, surprise edges, communities, stats)
  const analysis = buildAnalysis(graph, outputDir);

  // 6b. Suggest questions the graph can answer
  const questions = suggestQuestions(graph, analysis.communities);

  // 6c. Compute cohesion scores per community
  const cohesionScores: Record<number, number> = {};
  for (const [cidStr, memberIds] of Object.entries(analysis.communities)) {
    cohesionScores[Number(cidStr)] = cohesionScore(graph, memberIds);
  }

  // 7. Persist to disk
  saveGraph(graph, outputDir, projectPath);
  const graphPath = join(outputDir, 'graph.json');

  // 7b. Generate and save markdown report (non-fatal)
  const reportPath = join(outputDir, 'GRAPH_REPORT.md');
  try {
    const totalWords = merged.nodes.reduce((sum, n) => sum + ((n.linesOfCode as number | undefined) ?? 0) * 10, 0);
    const reportMd = generateReport(graph, analysis, cohesionScores, {
      projectPath,
      questions,
      corpusStats: corpusWarnings.length > 0
        ? { totalFiles: files.length, totalWords, warning: corpusWarnings[0] }
        : { totalFiles: files.length, totalWords },
    });
    writeFileSync(reportPath, reportMd, 'utf-8');
  } catch { /* report generation is non-fatal */ }

  // 8. Serialize to the public return type
  const serialized: SerializedGraph = {
    version: '1.0.0',
    builtAt: new Date().toISOString(),
    projectPath,
    directed: true,
    multigraph: false,
    nodes: graph.nodes().map((id) => ({
      id,
      ...graph.getNodeAttributes(id),
    })),
    links: graph.edges().map((edgeId) => ({
      source: graph.source(edgeId),
      target: graph.target(edgeId),
      ...graph.getEdgeAttributes(edgeId),
    })),
  };

  // 9. Generate interactive HTML visualization (non-fatal)
  try {
    exportHTML(serialized, outputDir);
  } catch {
    // Visualization is best-effort; never block the build
  }

  return {
    graph: serialized,
    analysis,
    questions,
    corpusWarnings,
    filesProcessed: merged.filesProcessed,
    fromCache: merged.fromCache,
    graphPath,
    reportPath,
  };
}

// ---------------------------------------------------------------------------
// Internal: minimal fallback for languages without a dedicated extractor
// ---------------------------------------------------------------------------

function extractGeneric(filePath: string, content: string): ExtractionResult {
  return {
    nodes: [
      {
        id: filePath,
        label: filePath.split('/').pop() ?? filePath,
        fileType: 'code',
        sourceFile: filePath,
        linesOfCode: content.split('\n').length,
      },
    ],
    edges: [],
    filesProcessed: 1,
    fromCache: 0,
    errors: [],
  };
}
