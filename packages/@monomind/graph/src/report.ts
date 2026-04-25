/**
 * Generate GRAPH_REPORT.md — the human-readable audit trail.
 * Mirrors the output format of Python graphify's report.py.
 */
import { basename } from 'path';
import type Graph from 'graphology';
import type { GraphAnalysis, GraphQuestion } from './types.js';
import { cohesionScore } from './cluster.js';

export interface CorpusStats {
  totalFiles: number;
  totalWords: number;
  warning?: string;
}

export interface ReportOptions {
  projectPath?: string;
  tokenCost?: { input: number; output: number };
  corpusStats?: CorpusStats;
  questions?: GraphQuestion[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if the node label matches its own filename — AST file-hub node. */
function isFileNode(graph: Graph, nodeId: string): boolean {
  const label = (graph.getNodeAttribute(nodeId, 'label') as string) || '';
  const sourceFile = (graph.getNodeAttribute(nodeId, 'sourceFile') as string) || '';
  if (!label || !sourceFile) return false;
  if (label === basename(sourceFile)) return true;
  if (label.startsWith('.') && label.endsWith('()')) return true;
  return false;
}

/** Auto-derive a community label from its member nodes' source directories. */
function communityLabel(graph: Graph, memberIds: string[]): string {
  const dirCounts: Record<string, number> = {};
  for (const id of memberIds) {
    const src = (graph.getNodeAttribute(id, 'sourceFile') as string) || '';
    if (!src) continue;
    const parts = src.split('/');
    const dir = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    dirCounts[dir] = (dirCounts[dir] ?? 0) + 1;
  }
  const sorted = Object.entries(dirCounts).sort(([, a], [, b]) => b - a);
  return sorted.length > 0 ? sorted[0][0] : 'misc';
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate the full markdown report string.
 *
 * @param graph     - The annotated Graphology graph (with `community` attributes set)
 * @param analysis  - Result of buildAnalysis()
 * @param cohesionScores - Map of communityId → cohesion score (0–1)
 * @param options   - Optional metadata (projectPath, tokenCost, corpusStats, questions)
 */
export function generateReport(
  graph: Graph,
  analysis: GraphAnalysis,
  cohesionScores?: Record<number, number>,
  options: ReportOptions = {},
): string {
  const today = new Date().toISOString().split('T')[0];
  const root = options.projectPath ?? '.';
  const scores = cohesionScores ?? {};

  // Confidence breakdown
  const totalEdges = graph.size || 1;
  const confCounts: Record<string, number> = {};
  const infScores: number[] = [];

  graph.forEachEdge((_, attrs) => {
    const c = (attrs.confidence as string) || 'EXTRACTED';
    confCounts[c] = (confCounts[c] ?? 0) + 1;
    if (c === 'INFERRED') {
      const cs = attrs.confidenceScore as number | undefined;
      if (cs !== undefined) infScores.push(cs);
    }
  });

  const extPct  = Math.round((confCounts['EXTRACTED']  ?? 0) / totalEdges * 100);
  const infPct  = Math.round((confCounts['INFERRED']   ?? 0) / totalEdges * 100);
  const ambPct  = Math.round((confCounts['AMBIGUOUS']  ?? 0) / totalEdges * 100);
  const infAvg  = infScores.length > 0
    ? (infScores.reduce((a, b) => a + b, 0) / infScores.length).toFixed(2)
    : null;

  const lines: string[] = [
    `# Graph Report - ${root}  (${today})`,
    '',
    '## Corpus Check',
  ];

  // Corpus check
  const cs = options.corpusStats;
  if (cs?.warning) {
    lines.push(`- ${cs.warning}`);
  } else if (cs) {
    lines.push(`- ${cs.totalFiles} files · ~${cs.totalWords.toLocaleString()} words`);
    lines.push('- Verdict: corpus is large enough that graph structure adds value.');
  }

  // Summary
  const infEdgeCount = confCounts['INFERRED'] ?? 0;
  const infTag = infAvg !== null
    ? ` · INFERRED: ${infEdgeCount} edges (avg confidence: ${infAvg})`
    : '';

  const tokenCost = options.tokenCost;
  lines.push('', '## Summary');
  lines.push(
    `- ${graph.order} nodes · ${graph.size} edges · ${analysis.stats.communities} communities detected`,
  );
  lines.push(
    `- Extraction: ${extPct}% EXTRACTED · ${infPct}% INFERRED · ${ambPct}% AMBIGUOUS${infTag}`,
  );
  if (tokenCost) {
    lines.push(
      `- Token cost: ${tokenCost.input.toLocaleString()} input · ${tokenCost.output.toLocaleString()} output`,
    );
  }

  // God nodes
  lines.push('', '## God Nodes (most connected - your core abstractions)');
  analysis.godNodes.forEach((node, i) => {
    lines.push(`${i + 1}. \`${node.label}\` - ${node.degree} edges`);
  });

  // Surprising connections
  lines.push('', '## Surprising Connections (you probably didn\'t know these)');
  if (analysis.surprises.length > 0) {
    for (const s of analysis.surprises) {
      const conf = s.confidence;
      const confTag = conf === 'INFERRED'
        ? `INFERRED ${((s as unknown as Record<string, unknown>).confidenceScore as number | undefined)?.toFixed(2) ?? ''}`
        : conf;
      const semTag = s.relation === 'semantically_similar_to' ? ' [semantically similar]' : '';
      lines.push(
        `- \`${s.from}\` --${s.relation}--> \`${s.to}\`  [${confTag}]${semTag}`,
      );
      lines.push(`  ${s.fromFile} → ${s.toFile}`);
    }
  } else {
    lines.push('- None detected - all connections are within the same source files.');
  }

  // Hyperedges (stored in graph metadata)
  const hyperedges = (graph.getAttribute('hyperedges') as unknown[]) ?? [];
  if (hyperedges.length > 0) {
    lines.push('', '## Hyperedges (group relationships)');
    for (const h of hyperedges) {
      const he = h as Record<string, unknown>;
      const nodeLabels = ((he.nodes as string[]) ?? []).join(', ');
      const conf = (he.confidence as string) ?? 'INFERRED';
      const cs2 = he.confidenceScore as number | undefined;
      const confTag = cs2 !== undefined ? `${conf} ${cs2.toFixed(2)}` : conf;
      lines.push(`- **${(he.label as string) ?? ''}** — ${nodeLabels} [${confTag}]`);
    }
  }

  // Communities
  lines.push('', '## Communities');
  for (const [cidStr, memberIds] of Object.entries(analysis.communities)) {
    const cid = Number(cidStr);
    const label = communityLabel(graph, memberIds);
    const score = scores[cid] !== undefined ? scores[cid] : cohesionScore(graph, memberIds);
    const realNodes = memberIds.filter((id) => graph.hasNode(id) && !isFileNode(graph, id));
    const display = realNodes
      .slice(0, 8)
      .map((id) => (graph.getNodeAttribute(id, 'label') as string) || id);
    const suffix = realNodes.length > 8 ? ` (+${realNodes.length - 8} more)` : '';
    lines.push('');
    lines.push(`### Community ${cid} - "${label}"`);
    lines.push(`Cohesion: ${score.toFixed(2)}`);
    lines.push(`Nodes (${realNodes.length}): ${display.join(', ')}${suffix}`);
  }

  // Ambiguous edges
  const ambiguous: Array<{ u: string; v: string; attrs: Record<string, unknown> }> = [];
  graph.forEachEdge((_, attrs, source, target) => {
    if ((attrs.confidence as string) === 'AMBIGUOUS') {
      ambiguous.push({ u: source, v: target, attrs: attrs as Record<string, unknown> });
    }
  });
  if (ambiguous.length > 0) {
    lines.push('', '## Ambiguous Edges - Review These');
    for (const { u, v, attrs } of ambiguous) {
      const ul = (graph.getNodeAttribute(u, 'label') as string) || u;
      const vl = (graph.getNodeAttribute(v, 'label') as string) || v;
      lines.push(`- \`${ul}\` → \`${vl}\`  [AMBIGUOUS]`);
      lines.push(
        `  ${(attrs.sourceFile as string) || ''} · relation: ${(attrs.relation as string) || 'unknown'}`,
      );
    }
  }

  // Knowledge gaps
  const isolated: string[] = [];
  graph.forEachNode((id) => {
    if (graph.degree(id) <= 1 && !isFileNode(graph, id)) {
      isolated.push(id);
    }
  });
  const thinCommunities = Object.entries(analysis.communities).filter(
    ([, nodes]) => nodes.length < 3,
  );
  const gapCount = isolated.length + thinCommunities.length;

  if (gapCount > 0 || ambPct > 20) {
    lines.push('', '## Knowledge Gaps');
    if (isolated.length > 0) {
      const labels = isolated
        .slice(0, 5)
        .map((id) => (graph.getNodeAttribute(id, 'label') as string) || id);
      const suffix = isolated.length > 5 ? ` (+${isolated.length - 5} more)` : '';
      lines.push(
        `- **${isolated.length} isolated node(s):** ${labels.map((l) => `\`${l}\``).join(', ')}${suffix}`,
      );
      lines.push('  These have ≤1 connection - possible missing edges or undocumented components.');
    }
    for (const [cidStr, nodes] of thinCommunities) {
      const cid = Number(cidStr);
      const label = communityLabel(graph, nodes);
      const nodeLabels = nodes
        .map((id) => (graph.getNodeAttribute(id, 'label') as string) || id);
      lines.push(`- **Thin community \`${label}\`** (${nodes.length} nodes): ${nodeLabels.map((l) => `\`${l}\``).join(', ')}`);
      lines.push('  Too small to be a meaningful cluster - may be noise or needs more connections extracted.');
    }
    if (ambPct > 20) {
      lines.push(
        `- **High ambiguity: ${ambPct}% of edges are AMBIGUOUS.** Review the Ambiguous Edges section above.`,
      );
    }
  }

  // Suggested questions
  const questions = options.questions ?? [];
  if (questions.length > 0) {
    lines.push('', '## Suggested Questions');
    const noSignal = questions.length === 1 && questions[0].type === 'ISOLATED_NODE' && questions[0].nodes.length === 0;
    if (noSignal) {
      lines.push(`_${questions[0].question}_`);
    } else {
      lines.push('_Questions this graph is uniquely positioned to answer:_');
      lines.push('');
      for (const q of questions) {
        if (q.question) {
          lines.push(`- **${q.question}**`);
          lines.push(`  _Priority: ${q.priority}. Nodes: ${q.nodes.slice(0, 3).map((n) => `\`${n}\``).join(', ')}_`);
        }
      }
    }
  }

  return lines.join('\n');
}
