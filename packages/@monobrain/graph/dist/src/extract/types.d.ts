import type { ExtractionResult } from '../types.js';
export interface LanguageExtractor {
    language: string;
    extensions: string[];
    extract(filePath: string, content: string): ExtractionResult;
}
//# sourceMappingURL=types.d.ts.map