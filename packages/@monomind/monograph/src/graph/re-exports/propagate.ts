import type { ModuleNode } from '../node-types.js';

export interface Edge {
  sourceIdx: number;
  targetIdx: number;
  importedName?: string;
  exportedName?: string;
  isTypeOnly: boolean;
}

export function propagateStarReExport(
  modules: ModuleNode[],
  edges: Edge[],
  edgesByTarget: Map<number, number[]>,
  barrelId: number,
  barrelIdx: number,
  sourceIdx: number,
  entryStarTargets: Set<number>,
): boolean {
  const barrel = modules[barrelIdx];
  const source = modules[sourceIdx];
  const before = barrel.exports.length;

  const existingNames = new Set(barrel.exports.map(e => e.name));

  for (const sym of source.exports) {
    if (!existingNames.has(sym.name)) {
      barrel.exports.push({ ...sym, isReExport: true });
      existingNames.add(sym.name);
    }
  }

  const changed = barrel.exports.length > before;

  if (changed && entryStarTargets.has(barrelId)) {
    const upstreamEdgeIndices = edgesByTarget.get(barrelIdx) ?? [];
    for (const ei of upstreamEdgeIndices) {
      const edge = edges[ei];
      if (edge.importedName === undefined) {
        propagateStarReExport(
          modules,
          edges,
          edgesByTarget,
          modules[edge.targetIdx].fileId,
          edge.targetIdx,
          barrelIdx,
          entryStarTargets,
        );
      }
    }
  }

  return changed;
}

export function propagateNamedReExport(
  modules: ModuleNode[],
  barrelId: number,
  barrelIdx: number,
  sourceIdx: number,
  importedName: string,
  exportedName: string,
  existingRefs: Set<number>,
): boolean {
  const source = modules[sourceIdx];
  const barrel = modules[barrelIdx];

  const sourceSym = source.exports.find(e => e.name === importedName);
  if (!sourceSym) return false;

  const existing = barrel.exports.find(e => e.name === exportedName);
  if (existing) return false;

  barrel.exports.push({
    name: exportedName,
    isType: sourceSym.isType,
    isReExport: true,
    line: sourceSym.line,
  });

  for (const refId of existingRefs) {
    const refIdx = modules.findIndex(m => m.fileId === refId);
    if (refIdx !== -1) {
      const refMod = modules[refIdx];
      const alreadyRefs = refMod.references.some(
        r => r.name === exportedName && r.fromFile === barrel.filePath,
      );
      if (!alreadyRefs) {
        refMod.references.push({ name: exportedName, kind: 'Unknown', fromFile: barrel.filePath });
      }
    }
  }

  return true;
}
