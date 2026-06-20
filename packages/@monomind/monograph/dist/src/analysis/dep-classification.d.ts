import type { MonographDb } from '../storage/db.js';
export interface PackageDepClassification {
    packageName: string;
    usedAsValue: boolean;
    usedAsTypeOnly: boolean;
    recommendation: 'keep-as-dep' | 'move-to-devdeps' | 'type-only' | 'unused';
    importCount: number;
    typeOnlyImportCount: number;
}
export interface DepClassificationResult {
    packages: PackageDepClassification[];
    typeOnlyCount: number;
    mixedCount: number;
    valueOnlyCount: number;
}
export declare function classifyDependencies(db: MonographDb): DepClassificationResult;
/** Format DepClassificationResult as structured text for LLM navigation and actionable guidance. */
export declare function formatDepClassification(result: DepClassificationResult): string;
//# sourceMappingURL=dep-classification.d.ts.map