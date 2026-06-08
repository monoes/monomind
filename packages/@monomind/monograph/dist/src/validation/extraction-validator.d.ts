import type { MonographNode, MonographEdge } from '../types.js';
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export declare function validateExtraction(nodes: MonographNode[], edges: MonographEdge[]): ValidationResult;
//# sourceMappingURL=extraction-validator.d.ts.map