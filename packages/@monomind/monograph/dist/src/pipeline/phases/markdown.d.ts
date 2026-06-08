import type { PipelinePhase } from '../types.js';
import type { MonographNode, MonographEdge } from '../../types.js';
export interface MarkdownOutput {
    documentNodes: MonographNode[];
    referencesEdges: MonographEdge[];
}
export declare const markdownPhase: PipelinePhase<MarkdownOutput>;
//# sourceMappingURL=markdown.d.ts.map