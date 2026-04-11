import type { ExtractionResult } from './types.js';
export declare class FileCache {
    private cacheDir;
    constructor(outputDir: string);
    key(filePath: string, content: string): string;
    get(key: string): ExtractionResult | null;
    set(key: string, result: ExtractionResult): void;
    has(key: string): boolean;
}
//# sourceMappingURL=cache.d.ts.map