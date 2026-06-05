/**
 * Diff Classifier for Change Analysis
 */
export interface DiffClassifierConfig {
    maxDiffSize: number;
    classifyByImpact: boolean;
    detectRefactoring: boolean;
    minConfidence: number;
}
export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
    changes: DiffChange[];
}
export interface DiffChange {
    type: 'add' | 'remove' | 'context';
    lineNumber: number;
    content: string;
}
export interface DiffClassification {
    primary: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'config' | 'style' | 'unknown';
    secondary: string[];
    confidence: number;
    impactLevel: 'low' | 'medium' | 'high' | 'critical';
    suggestedReviewers: string[];
    testingStrategy: string[];
    riskFactors: string[];
}
export interface FileDiff {
    path: string;
    hunks: DiffHunk[];
    additions: number;
    deletions: number;
    classification: DiffClassification;
}
export interface DiffAnalysis {
    files: FileDiff[];
    overall: DiffClassification;
    stats: {
        totalAdditions: number;
        totalDeletions: number;
        filesChanged: number;
        avgConfidence: number;
    };
    timestamp: number;
}
export declare class DiffClassifier {
    private config;
    private classificationCache;
    private static readonly MAX_CLASSIFICATION_CACHE;
    constructor(config?: Partial<DiffClassifierConfig>);
    initialize(): Promise<void>;
    parseDiff(diffContent: string): FileDiff[];
    classify(files: FileDiff[]): DiffAnalysis;
    classifyCommitMessage(message: string): DiffClassification['primary'];
    getStats(): Record<string, number | boolean>;
    clearCache(): void;
    private parseHunks;
    private parseChanges;
    private classifyFile;
    private getCacheKey;
    private determinePrimaryClassification;
    private isRefactoring;
    private determineSecondaryClassifications;
    private calculateConfidence;
    private determineImpactLevel;
    private suggestReviewers;
    private determineTestingStrategy;
    private identifyRiskFactors;
    private computeOverallClassification;
}
export declare function createDiffClassifier(config?: Partial<DiffClassifierConfig>): DiffClassifier;
/**
 * Risk level type for file risk assessment
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
/**
 * Diff file interface for analyze tools
 */
export interface DiffFile {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
    hunks: number;
    binary: boolean;
}
/**
 * File risk assessment result
 */
export interface FileRisk {
    file: string;
    risk: RiskLevel;
    score: number;
    reasons: string[];
}
/**
 * Overall risk assessment result
 */
export interface OverallRisk {
    overall: RiskLevel;
    score: number;
    breakdown: {
        low: number;
        medium: number;
        high: number;
        critical: number;
    };
}
/**
 * Diff analysis result
 */
export interface DiffAnalysisResult {
    ref: string;
    timestamp: number;
    files: DiffFile[];
    risk: OverallRisk;
    classification: DiffClassification;
    summary: string;
    fileRisks?: FileRisk[];
    recommendedReviewers?: string[];
}
/**
 * Get git diff statistics using SINGLE combined command (optimized)
 * Replaces two separate git commands with one
 */
export declare function getGitDiffNumstat(ref?: string): DiffFile[];
/**
 * Async version of getGitDiffNumstat for non-blocking operation
 */
export declare function getGitDiffNumstatAsync(ref?: string): Promise<DiffFile[]>;
/**
 * Clear the diff cache (call when git state changes)
 */
export declare function clearDiffCache(): void;
/**
 * Assess risk for a single file
 */
export declare function assessFileRisk(file: DiffFile): FileRisk;
/**
 * Assess overall risk from files and file risks
 */
export declare function assessOverallRisk(files: DiffFile[], fileRisks: FileRisk[]): OverallRisk;
/**
 * Classify a diff based on files (uses singleton classifier)
 */
export declare function classifyDiff(files: DiffFile[]): DiffClassification;
/**
 * Suggest reviewers based on files and risks
 */
export declare function suggestReviewers(files: DiffFile[], fileRisks: FileRisk[]): string[];
/**
 * Analyze a diff with full analysis (optimized with caching)
 */
export declare function analyzeDiff(options: {
    ref?: string;
    useMonoVector?: boolean;
    skipCache?: boolean;
}): Promise<DiffAnalysisResult>;
/**
 * Synchronous version of analyzeDiff for backward compatibility
 */
export declare function analyzeDiffSync(options: {
    ref?: string;
    useMonoVector?: boolean;
}): DiffAnalysisResult;
/**
 * Clear all diff-related caches
 */
export declare function clearAllDiffCaches(): void;
//# sourceMappingURL=diff-classifier.d.ts.map