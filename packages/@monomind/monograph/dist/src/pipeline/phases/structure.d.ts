import type { PipelinePhase } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
export interface StructureOutput {
    fileNodes: MonographNode[];
    folderNodes: MonographNode[];
    containsEdges: MonographEdge[];
}
export declare const structurePhase: PipelinePhase<StructureOutput>;
//# sourceMappingURL=structure.d.ts.map