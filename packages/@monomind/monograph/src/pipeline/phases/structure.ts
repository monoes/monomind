import { basename, dirname, relative } from 'node:path';
import type { MonographEdge, MonographNode } from '../../types.js';
import { CONFIDENCE_SCORE, fileId, folderId, makeId, toNormLabel } from '../../types.js';
import type { PipelinePhase } from '../types.js';
import type { ScanOutput } from './scan.js';

export interface StructureOutput {
  fileNodes: MonographNode[];
  folderNodes: MonographNode[];
  containsEdges: MonographEdge[];
}

export const structurePhase: PipelinePhase<StructureOutput> = {
  name: 'structure',
  deps: ['scan'],
  async execute(ctx, deps) {
    const { filePaths } = deps.get('scan') as ScanOutput;
    const fileNodes: MonographNode[] = [];
    const folderNodes: MonographNode[] = [];
    const containsEdges: MonographEdge[] = [];
    const seenFolders = new Set<string>();

    for (const absPath of filePaths) {
      const rel = relative(ctx.repoPath, absPath);
      const relFileId = fileId(rel);
      fileNodes.push({
        id: relFileId,
        label: 'File',
        name: basename(rel),
        normLabel: toNormLabel(basename(rel)),
        filePath: rel,
        isExported: false,
      });

      const parts = dirname(rel).split('/');
      let current = '';
      let parentFolderId: string | null = null;
      for (const part of parts) {
        if (part === '.') continue;
        current = current ? `${current}/${part}` : part;
        const currentFolderId = folderId(current);
        if (!seenFolders.has(currentFolderId)) {
          seenFolders.add(currentFolderId);
          folderNodes.push({
            id: currentFolderId,
            label: 'Folder',
            name: part,
            normLabel: toNormLabel(part),
            filePath: current,
            isExported: false,
          });
          if (parentFolderId) {
            containsEdges.push({
              id: makeId(parentFolderId, currentFolderId, 'contains'),
              sourceId: parentFolderId,
              targetId: currentFolderId,
              relation: 'CONTAINS',
              confidence: 'EXTRACTED',
              confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
            });
          }
        }
        parentFolderId = currentFolderId;
      }

      if (parentFolderId) {
        containsEdges.push({
          id: makeId(parentFolderId, relFileId, 'contains'),
          sourceId: parentFolderId,
          targetId: relFileId,
          relation: 'CONTAINS',
          confidence: 'EXTRACTED',
          confidenceScore: CONFIDENCE_SCORE.EXTRACTED,
        });
      }
    }

    return { fileNodes, folderNodes, containsEdges };
  },
};
