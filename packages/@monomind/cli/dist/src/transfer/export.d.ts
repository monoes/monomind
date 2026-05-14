/**
 * Pattern Export Pipeline
 * Export patterns with anonymization and optional IPFS upload
 */
import type { CFPFormat, ExportOptions, ExportResult } from './types.js';
/**
 * Export patterns to file or IPFS
 */
export declare function exportPatterns(cfp: CFPFormat, options?: ExportOptions): Promise<ExportResult>;
/**
 * Export Seraphine genesis model
 */
export declare function exportSeraphine(options?: ExportOptions): Promise<ExportResult>;
/**
 * Quick export to file
 */
export declare function quickExport(cfp: CFPFormat, outputPath: string): Promise<ExportResult>;
/**
 * Quick export to IPFS
 */
export declare function quickExportToIPFS(cfp: CFPFormat, options?: {
    gateway?: string;
    pin?: boolean;
}): Promise<ExportResult>;
//# sourceMappingURL=export.d.ts.map