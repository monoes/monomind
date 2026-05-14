/**
 * Anonymization Pipeline
 * PII detection and redaction for pattern export
 */
import type { CFPFormat, AnonymizationLevel, PIIDetectionResult } from '../types.js';
/**
 * Detect PII in a string
 */
export declare function detectPII(content: string): PIIDetectionResult;
/**
 * Redact PII from a string
 */
export declare function redactPII(content: string): string;
/**
 * Apply anonymization to CFP document
 */
export declare function anonymizeCFP(cfp: CFPFormat, level: AnonymizationLevel): {
    cfp: CFPFormat;
    transforms: string[];
};
/**
 * Scan CFP for PII without modification
 */
export declare function scanCFPForPII(cfp: CFPFormat): PIIDetectionResult;
//# sourceMappingURL=index.d.ts.map