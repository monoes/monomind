import type { PipelinePhase } from '../types.js';
import type { MonographEdge } from '../../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { ParseOutput } from './parse.js';
import type { StructureOutput } from './structure.js';

export interface CrossFileOutput {
  resolvedEdges: MonographEdge[];
}

// monolean: IMPORTS name-matching removed — it matched import names against a
// global symbol index (e.g. `import fs` → random Variable named `fs` in wrong file).
// scope-resolution.ts now handles cross-file CALLS via source-parsed import maps.
export const crossFilePhase: PipelinePhase<CrossFileOutput> = {
  name: 'cross-file',
  deps: ['parse', 'structure'],
  async execute(_ctx, deps) {
    const { allEdges } = deps.get('parse') as ParseOutput;
    const { fileNodes } = deps.get('structure') as StructureOutput;

    function lastSegment(s: string): string {
      const idx = s.lastIndexOf('/');
      return idx === -1 ? s : s.slice(idx + 1);
    }

    function targetBasename(rawId: string): string {
      const stripped = rawId.startsWith('import_') ? rawId.slice(7) : rawId;
      return lastSegment(stripped);
    }

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
      if (edge.relation === 'RE_EXPORTS') {
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
