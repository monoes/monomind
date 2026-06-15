import type { PipelinePhase, PipelineContext } from '../types.js';
import type { MonographEdge, MonographNode } from '../../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { ParseOutput } from './parse.js';
import type { StructureOutput } from './structure.js';

export interface CrossFileOutput {
  resolvedEdges: MonographEdge[];
}

export const crossFilePhase: PipelinePhase<CrossFileOutput> = {
  name: 'cross-file',
  deps: ['parse', 'structure'],
  async execute(_ctx, deps) {
    const { allEdges, symbolNodes } = deps.get('parse') as ParseOutput;
    const { fileNodes } = deps.get('structure') as StructureOutput;

    /** Extract the last path segment of a '/'-separated string (faster than split+pop). */
    function lastSegment(s: string): string {
      const idx = s.lastIndexOf('/');
      return idx === -1 ? s : s.slice(idx + 1);
    }

    /** Strip leading `import_` prefix, then return the last path segment. */
    function targetBasename(rawId: string): string {
      const stripped = rawId.startsWith('import_') ? rawId.slice(7) : rawId;
      return lastSegment(stripped);
    }

    // Symbol name → symbol node ID.
    // Pre-key lowercase variants so IMPORTS resolution is a single Map.get() instead of two.
    const nameIndex = new Map<string, string>();
    for (const node of symbolNodes) {
      nameIndex.set(node.name, node.id);
      const lower = node.name.toLowerCase();
      if (lower !== node.name) nameIndex.set(lower, node.id);
      if (node.normLabel) {
        nameIndex.set(node.normLabel, node.id);
        const normLower = node.normLabel.toLowerCase();
        if (normLower !== node.normLabel) nameIndex.set(normLower, node.id);
      }
    }

    // Basename (without extension) → File node ID, for resolving RE_EXPORTS.
    // Use lastIndexOf to avoid allocating a full split array per file path.
    const fileBasenameIndex = new Map<string, string>();
    for (const fileNode of fileNodes) {
      const basename = lastSegment(fileNode.filePath ?? '').toLowerCase();
      const dotIdx = basename.lastIndexOf('.');
      const noExt = dotIdx === -1 ? basename : basename.slice(0, dotIdx);
      fileBasenameIndex.set(basename, fileNode.id);
      if (noExt !== basename) fileBasenameIndex.set(noExt, fileNode.id);
    }

    const resolvedEdges: MonographEdge[] = [];

    for (const edge of allEdges) {
      if (edge.relation === 'IMPORTS') {
        const targetName = targetBasename(edge.targetId);
        // Single lookup — lowercase variants are pre-keyed in nameIndex
        const resolvedId = nameIndex.get(targetName) ?? nameIndex.get(targetName.toLowerCase());

        if (resolvedId && resolvedId !== edge.targetId) {
          resolvedEdges.push({
            ...edge,
            id: makeId(edge.sourceId, resolvedId, 'resolved'),
            targetId: resolvedId,
            confidence: 'INFERRED',
            confidenceScore: CONFIDENCE_SCORE.INFERRED,
          });
        }
      } else if (edge.relation === 'RE_EXPORTS') {
        // Resolve to a File node ID using the pre-built basename index
        const basename = targetBasename(edge.targetId).toLowerCase();
        const dotIdx = basename.lastIndexOf('.');
        const noExt = dotIdx === -1 ? basename : basename.slice(0, dotIdx);
        const resolvedId = fileBasenameIndex.get(basename) ?? fileBasenameIndex.get(noExt);

        if (resolvedId && resolvedId !== edge.targetId) {
          resolvedEdges.push({
            ...edge,
            id: makeId(edge.sourceId, resolvedId, 'reexports_resolved'),
            targetId: resolvedId,
            confidence: 'INFERRED',
            confidenceScore: CONFIDENCE_SCORE.INFERRED,
          });
        }
      }
    }

    if (_ctx.db && resolvedEdges.length > 0) {
      insertEdges(_ctx.db, resolvedEdges);
    }

    return { resolvedEdges };
  },
};
