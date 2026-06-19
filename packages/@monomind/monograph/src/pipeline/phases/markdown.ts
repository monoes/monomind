import { readFileSync, statSync } from 'fs';
import { extname, basename, relative } from 'path';
import type { PipelinePhase } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
import { makeId, toNormLabel } from '../../types.js';
import { insertNodes } from '../../storage/node-store.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { StructureOutput } from './structure.js';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);
// Inline code span: `identifier`
const INLINE_CODE_RE = /`([^`]+)`/g;
// Module-level constant: compiled once per process, not per isIdentifier() call.
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/;

export interface MarkdownOutput {
  documentNodes: MonographNode[];
  referencesEdges: MonographEdge[];
}

export const markdownPhase: PipelinePhase<MarkdownOutput> = {
  name: 'markdown',
  // Must run after parse so symbols are already in the DB for name lookup.
  // Also depends on structure to get the list of file nodes.
  // Runs before communities so REFERENCES edges are visible to graph analyses.
  deps: ['parse', 'structure'],
  async execute(ctx, deps) {
    if (ctx.options.codeOnly) return { documentNodes: [], referencesEdges: [] };
    const { fileNodes } = deps.get('structure') as StructureOutput;
    const documentNodes: MonographNode[] = [];
    const referencesEdges: MonographEdge[] = [];

    const mdFiles = fileNodes.filter(fn => {
      const ext = extname(fn.name).toLowerCase();
      return MARKDOWN_EXTENSIONS.has(ext);
    });

    for (const fileNode of mdFiles) {
      // fileNode.filePath is already relative per codebase convention
      const relPath = fileNode.filePath ?? '';
      const absPath = `${ctx.repoPath}/${relPath}`;

      let source: string;
      try {
        const stat = statSync(absPath);
        if (stat.size > ctx.options.maxFileSizeBytes) continue;
        source = readFileSync(absPath, 'utf-8');
      } catch { continue; }

      const nameWithoutExt = basename(relPath).replace(/\.(mdx?)$/, '');
      // Use 'doc' suffix to avoid collision with the 'file'-suffixed File node
      const docId = makeId(relPath.replace(/\//g, '_'), 'doc');

      const docNode: MonographNode = {
        id: docId,
        label: 'Document',
        name: nameWithoutExt,
        normLabel: toNormLabel(nameWithoutExt),
        filePath: relPath,
        isExported: false,
        language: 'markdown',
      };
      documentNodes.push(docNode);

      // Extract inline code spans and match against symbol names in the DB
      if (ctx.db) {
        const spans = extractCodeSpans(source);
        // Hoist prepared statement outside the span loop — avoids re-compiling the
        // SQL query for every identifier in every markdown file (N+1 preparation).
        const symbolLookup = ctx.db.prepare(
          `SELECT id FROM nodes WHERE name = ?
           AND label NOT IN ('File', 'Folder', 'Document')`,
        );

        for (const span of spans) {
          // Only match single-word identifiers (not shell commands, paths, etc.)
          if (!isIdentifier(span)) continue;

          // Exact name match, excluding structural nodes to avoid matching file names
          const rows = symbolLookup.all(span) as { id: string }[];

          if (rows.length === 1) {
            const edgeId = makeId(docId, rows[0].id, 'references');
            referencesEdges.push({
              id: edgeId,
              sourceId: docId,
              targetId: rows[0].id,
              relation: 'REFERENCES',
              confidence: 'INFERRED',
              // Literal 0.8 — intentionally higher than CONFIDENCE_SCORE.INFERRED (0.5)
              // because inline code span matches are reasonably strong documentation signals.
              confidenceScore: 0.8,
            });
          }
        }
      }
    }

    if (ctx.db) {
      insertNodes(ctx.db, documentNodes);
      insertEdges(ctx.db, referencesEdges);
    }

    return { documentNodes, referencesEdges };
  },
};

function extractCodeSpans(source: string): string[] {
  const spans: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(INLINE_CODE_RE.source, 'g');
  while ((match = re.exec(source)) !== null) {
    spans.push(match[1].trim());
  }
  return spans;
}

/** Accept only simple identifiers — letters, digits, underscores, hyphens, dots (for namespaced names). */
function isIdentifier(span: string): boolean {
  return IDENTIFIER_RE.test(span);
}
