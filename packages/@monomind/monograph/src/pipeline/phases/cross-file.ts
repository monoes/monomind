import { readFileSync } from 'fs';
import { join } from 'path';
import type { PipelinePhase } from '../types.js';
import type { MonographEdge } from '../../types.js';
import { makeId, CONFIDENCE_SCORE } from '../../types.js';
import { insertEdges } from '../../storage/edge-store.js';
import type { ParseOutput } from './parse.js';
import type { StructureOutput } from './structure.js';
import { resolveModuleSpecifier, buildWorkspacePackageMap } from './scope-resolution.js';

export interface CrossFileOutput {
  resolvedEdges: MonographEdge[];
}

// Mirrors parsers/extractor.ts's re-export detection regex — used here to recover
// the ORIGINAL specifier string behind a RE_EXPORTS edge's mangled placeholder id
// (makeId('import', specifier) is lossy: '/' and '.' are collapsed to '_', so the
// placeholder can't be reversed directly — we re-derive it from source instead).
const RE_EXPORT_RE = /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;

// monolean: IMPORTS name-matching removed — it matched import names against a
// global symbol index (e.g. `import fs` → random Variable named `fs` in wrong file).
// scope-resolution.ts now handles cross-file CALLS via source-parsed import maps.
export const crossFilePhase: PipelinePhase<CrossFileOutput> = {
  name: 'cross-file',
  deps: ['parse', 'structure'],
  async execute(ctx, deps) {
    const { allEdges } = deps.get('parse') as ParseOutput;
    const { fileNodes } = deps.get('structure') as StructureOutput;

    const reExportEdges = allEdges.filter((e) => e.relation === 'RE_EXPORTS');
    const resolvedEdges: MonographEdge[] = [];

    if (reExportEdges.length > 0) {
      // fileId <-> filePath maps for resolving edge endpoints to real file nodes.
      const fileIdToPath = new Map<string, string>();
      const knownFiles = new Set<string>();
      for (const fileNode of fileNodes) {
        if (fileNode.filePath) {
          fileIdToPath.set(fileNode.id, fileNode.filePath);
          knownFiles.add(fileNode.filePath);
        }
      }
      const filePathToId = new Map<string, string>();
      for (const [id, path] of fileIdToPath) filePathToId.set(path, id);

      const workspaceMap = buildWorkspacePackageMap(ctx.repoPath);

      // Group by importing file so each source file is read at most once.
      const edgesBySource = new Map<string, MonographEdge[]>();
      for (const edge of reExportEdges) {
        const arr = edgesBySource.get(edge.sourceId);
        if (arr) arr.push(edge);
        else edgesBySource.set(edge.sourceId, [edge]);
      }

      for (const [sourceId, edges] of edgesBySource) {
        const filePath = fileIdToPath.get(sourceId);
        if (!filePath) continue;

        let source: string;
        try {
          source = readFileSync(join(ctx.repoPath, filePath), 'utf-8');
        } catch {
          continue;
        }

        // Recover each `export * / { ... } from '<specifier>'` string, keyed by the
        // same mangled placeholder id the extractor used (makeId('import', specifier))
        // so it can be matched back to the corresponding edge.
        const specifierByPlaceholder = new Map<string, string>();
        RE_EXPORT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = RE_EXPORT_RE.exec(source)) !== null) {
          const specifier = m[1]!;
          specifierByPlaceholder.set(makeId('import', specifier), specifier);
        }

        for (const edge of edges) {
          const specifier = specifierByPlaceholder.get(edge.targetId);
          if (!specifier) continue;

          // Resolve relative to THIS importing file's own directory (reusing the
          // same resolver scope-resolution.ts uses for IMPORTS) instead of an
          // ambiguous global basename lookup that collides on repeated basenames
          // like index.ts / utils.ts across the repo.
          const resolvedPath = resolveModuleSpecifier(
            filePath,
            specifier,
            ctx.repoPath,
            knownFiles,
            workspaceMap,
          );
          if (!resolvedPath) continue;

          const resolvedId = filePathToId.get(resolvedPath);
          if (!resolvedId || resolvedId === edge.targetId) continue;

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

    if (ctx.db && resolvedEdges.length > 0) {
      insertEdges(ctx.db, resolvedEdges);
    }

    return { resolvedEdges };
  },
};
