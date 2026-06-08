import type { PipelinePhase } from '../types.js';
import type { MonographNode } from '../../types.js';
export interface DocsParseOutput {
    sectionNodes: MonographNode[];
    docFiles: number;
}
export declare const docsParsePhase: PipelinePhase<DocsParseOutput>;
//# sourceMappingURL=docs-parse.d.ts.map