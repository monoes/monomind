import type { PipelinePhase } from '../types.js';
import type { MonographNode } from '../../types.js';
export interface PdfParseOutput {
    sectionNodes: MonographNode[];
    pdfFiles: number;
}
export declare const pdfParsePhase: PipelinePhase<PdfParseOutput>;
//# sourceMappingURL=pdf-parse.d.ts.map