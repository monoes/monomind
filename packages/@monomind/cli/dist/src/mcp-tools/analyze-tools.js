/**
 * Analyze MCP Tools
 * Provides diff analysis and classification via MCP protocol
 */
import { analyzeDiff, assessFileRisk, assessOverallRisk, classifyDiff, suggestReviewers, getGitDiffNumstat, } from '../monovector/diff-classifier.js';
/**
 * Diff Analysis Tool
 * Analyzes git diffs for change risk assessment and classification
 */
export const analyzeDiffTool = {
    name: 'analyze_diff',
    description: 'Analyze git diff for change risk assessment and classification',
    category: 'analyze',
    tags: ['diff', 'risk', 'classification', 'git'],
    inputSchema: {
        type: 'object',
        properties: {
            ref: {
                type: 'string',
                description: 'Git ref to compare against (e.g., HEAD~1, main..feature, commit hash)',
                default: 'HEAD',
            },
            includeFileRisks: {
                type: 'boolean',
                description: 'Include detailed file-level risk analysis',
                default: false,
            },
            includeReviewers: {
                type: 'boolean',
                description: 'Include recommended reviewers',
                default: true,
            },
            useMonoVector: {
                type: 'boolean',
                description: 'Attempt to use monovector for analysis (graceful fallback if unavailable)',
                default: true,
            },
        },
    },
    handler: async (params) => {
        const ref = params.ref || 'HEAD';
        const includeFileRisks = params.includeFileRisks === true;
        const includeReviewers = params.includeReviewers !== false;
        const useMonoVector = params.useMonoVector !== false;
        try {
            const result = await analyzeDiff({
                ref,
                useMonoVector,
            });
            // Build response
            const response = {
                ref: result.ref,
                timestamp: result.timestamp,
                files: result.files,
                risk: result.risk,
                classification: result.classification,
                summary: result.summary,
            };
            if (includeFileRisks) {
                response.fileRisks = result.fileRisks;
            }
            if (includeReviewers) {
                response.recommendedReviewers = result.recommendedReviewers;
            }
            return response;
        }
        catch (error) {
            return {
                error: true,
                message: error instanceof Error ? error.message : String(error),
                ref,
            };
        }
    },
};
/**
 * Diff Risk Assessment Tool
 * Focused risk assessment without full analysis
 */
export const diffRiskTool = {
    name: 'analyze_diff-risk',
    description: 'Quick risk assessment for git diff',
    category: 'analyze',
    tags: ['diff', 'risk', 'git'],
    inputSchema: {
        type: 'object',
        properties: {
            ref: {
                type: 'string',
                description: 'Git ref to compare against',
                default: 'HEAD',
            },
        },
    },
    handler: async (params) => {
        const ref = params.ref || 'HEAD';
        try {
            const files = getGitDiffNumstat(ref);
            const fileRisks = files.map(assessFileRisk);
            const risk = assessOverallRisk(files, fileRisks);
            return {
                ref,
                risk,
                summary: `${risk.overall} risk (score: ${risk.score}/100) - ${files.length} files changed`,
            };
        }
        catch (error) {
            return {
                error: true,
                message: error instanceof Error ? error.message : String(error),
                ref,
            };
        }
    },
};
/**
 * Diff Classification Tool
 * Classify change type without full analysis
 */
export const diffClassifyTool = {
    name: 'analyze_diff-classify',
    description: 'Classify git diff change type',
    category: 'analyze',
    tags: ['diff', 'classification', 'git'],
    inputSchema: {
        type: 'object',
        properties: {
            ref: {
                type: 'string',
                description: 'Git ref to compare against',
                default: 'HEAD',
            },
        },
    },
    handler: async (params) => {
        const ref = params.ref || 'HEAD';
        try {
            const files = getGitDiffNumstat(ref);
            const classification = classifyDiff(files);
            return {
                ref,
                classification,
                files: files.length,
            };
        }
        catch (error) {
            return {
                error: true,
                message: error instanceof Error ? error.message : String(error),
                ref,
            };
        }
    },
};
/**
 * Diff Reviewers Tool
 * Suggest reviewers for changes
 */
export const diffReviewersTool = {
    name: 'analyze_diff-reviewers',
    description: 'Suggest reviewers for git diff changes',
    category: 'analyze',
    tags: ['diff', 'reviewers', 'git'],
    inputSchema: {
        type: 'object',
        properties: {
            ref: {
                type: 'string',
                description: 'Git ref to compare against',
                default: 'HEAD',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of reviewers to suggest',
                default: 5,
            },
        },
    },
    handler: async (params) => {
        const ref = params.ref || 'HEAD';
        const limit = params.limit || 5;
        try {
            const files = getGitDiffNumstat(ref);
            const fileRisks = files.map(assessFileRisk);
            const reviewers = suggestReviewers(files, fileRisks);
            return {
                ref,
                recommendedReviewers: reviewers.slice(0, limit),
                filesAnalyzed: files.length,
            };
        }
        catch (error) {
            return {
                error: true,
                message: error instanceof Error ? error.message : String(error),
                ref,
            };
        }
    },
};
/**
 * File Risk Tool
 * Assess risk for a specific file path
 */
export const fileRiskTool = {
    name: 'analyze_file-risk',
    description: 'Assess risk for a specific file change',
    category: 'analyze',
    tags: ['file', 'risk'],
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'File path to assess',
            },
            additions: {
                type: 'number',
                description: 'Number of lines added',
                default: 0,
            },
            deletions: {
                type: 'number',
                description: 'Number of lines deleted',
                default: 0,
            },
            status: {
                type: 'string',
                description: 'File status: added, modified, deleted, renamed',
                default: 'modified',
            },
        },
        required: ['path'],
    },
    handler: async (params) => {
        try {
            const file = {
                path: params.path,
                status: params.status || 'modified',
                additions: params.additions || 0,
                deletions: params.deletions || 0,
                hunks: 1,
                binary: false,
            };
            const risk = assessFileRisk(file);
            return {
                file: file.path,
                risk: risk.risk,
                score: risk.score,
                reasons: risk.reasons,
            };
        }
        catch (error) {
            return {
                error: true,
                message: error instanceof Error ? error.message : String(error),
                path: params.path,
            };
        }
    },
};
/**
 * Diff Stats Tool
 * Get quick diff statistics
 */
export const diffStatsTool = {
    name: 'analyze_diff-stats',
    description: 'Get quick statistics for git diff',
    category: 'analyze',
    tags: ['diff', 'stats', 'git'],
    inputSchema: {
        type: 'object',
        properties: {
            ref: {
                type: 'string',
                description: 'Git ref to compare against',
                default: 'HEAD',
            },
        },
    },
    handler: async (params) => {
        const ref = params.ref || 'HEAD';
        try {
            const files = getGitDiffNumstat(ref);
            const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
            const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
            const addedFiles = files.filter(f => f.status === 'added').length;
            const modifiedFiles = files.filter(f => f.status === 'modified').length;
            const deletedFiles = files.filter(f => f.status === 'deleted').length;
            const renamedFiles = files.filter(f => f.status === 'renamed').length;
            const binaryFiles = files.filter(f => f.binary).length;
            return {
                ref,
                totalFiles: files.length,
                totalAdditions,
                totalDeletions,
                totalChanges: totalAdditions + totalDeletions,
                byStatus: {
                    added: addedFiles,
                    modified: modifiedFiles,
                    deleted: deletedFiles,
                    renamed: renamedFiles,
                },
                binaryFiles,
            };
        }
        catch (error) {
            return {
                error: true,
                message: error instanceof Error ? error.message : String(error),
                ref,
            };
        }
    },
};
// Export all analyze tools
export const analyzeTools = [
    analyzeDiffTool,
    diffRiskTool,
    diffClassifyTool,
    diffReviewersTool,
    fileRiskTool,
    diffStatsTool,
];
export default analyzeTools;
//# sourceMappingURL=analyze-tools.js.map