/**
 * Analyze MCP Tools
 * Provides diff analysis and classification via MCP protocol
 */

import type { MCPTool } from './types.js';
import {
  analyzeDiff,
  assessFileRisk,
  assessOverallRisk,
  classifyDiff,
  suggestReviewers,
  getGitDiffNumstat,
  type DiffFile,
  type RiskLevel,
} from '../monovector/diff-classifier.js';

// ===== Shared validation helpers =====

const MAX_REF_LEN = 256;      // git ref: branch/commit/tag names are bounded
const MAX_PATH_LEN = 4096;    // OS path limit
const MAX_LIMIT = 100;
const VALID_FILE_STATUS = new Set(['added', 'modified', 'deleted', 'renamed']);
// Strip filesystem paths from error messages to avoid leaking internal layout
function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
      .replace(/\/[^\s:]+(\/|(?=\s|:|$))/g, '<path>/')
      .substring(0, 500);
  }
  return 'Internal error';
}
// Validate a git ref: non-empty string, bounded length, no shell metacharacters.
// execFileSync already prevents shell injection but we still cap the length and
// reject control chars / obvious injection patterns so error messages don't echo
// attacker-supplied content back.
const REF_SAFE_RE = /^[a-zA-Z0-9_./:@^~\-\.{}\[\]]+$/;
function validateRef(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'HEAD';
  if (value.length > MAX_REF_LEN) return null;
  if (!REF_SAFE_RE.test(value)) return null;
  return value;
}

/**
 * Diff Analysis Tool
 * Analyzes git diffs for change risk assessment and classification
 */
export const analyzeDiffTool: MCPTool = {
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
  handler: async (params: Record<string, unknown>) => {
    const ref = validateRef(params.ref);
    if (ref === null) return { error: true, message: 'Invalid ref: must be a safe git ref (max 256 chars, alphanumeric/._/:@^~-)' };
    const includeFileRisks = params.includeFileRisks === true;
    const includeReviewers = params.includeReviewers !== false;
    const useMonoVector = params.useMonoVector !== false;

    try {
      const result = await analyzeDiff({
        ref,
        useMonoVector,
      });

      // Build response
      const response: Record<string, unknown> = {
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
    } catch (error) {
      return {
        error: true,
        message: sanitizeError(error),
        ref,
      };
    }
  },
};

/**
 * Diff Risk Assessment Tool
 * Focused risk assessment without full analysis
 */
export const diffRiskTool: MCPTool = {
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
  handler: async (params: Record<string, unknown>) => {
    const ref = validateRef(params.ref);
    if (ref === null) return { error: true, message: 'Invalid ref: must be a safe git ref (max 256 chars, alphanumeric/._/:@^~-)' };

    try {
      const files = getGitDiffNumstat(ref);
      const fileRisks = files.map(assessFileRisk);
      const risk = assessOverallRisk(files, fileRisks);

      return {
        ref,
        risk,
        summary: `${risk.overall} risk (score: ${risk.score}/100) - ${files.length} files changed`,
      };
    } catch (error) {
      return {
        error: true,
        message: sanitizeError(error),
        ref,
      };
    }
  },
};

/**
 * Diff Classification Tool
 * Classify change type without full analysis
 */
export const diffClassifyTool: MCPTool = {
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
  handler: async (params: Record<string, unknown>) => {
    const ref = validateRef(params.ref);
    if (ref === null) return { error: true, message: 'Invalid ref: must be a safe git ref (max 256 chars, alphanumeric/._/:@^~-)' };

    try {
      const files = getGitDiffNumstat(ref);
      const classification = classifyDiff(files);

      return {
        ref,
        classification,
        files: files.length,
      };
    } catch (error) {
      return {
        error: true,
        message: sanitizeError(error),
        ref,
      };
    }
  },
};

/**
 * Diff Reviewers Tool
 * Suggest reviewers for changes
 */
export const diffReviewersTool: MCPTool = {
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
  handler: async (params: Record<string, unknown>) => {
    const ref = validateRef(params.ref);
    if (ref === null) return { error: true, message: 'Invalid ref: must be a safe git ref (max 256 chars, alphanumeric/._/:@^~-)' };
    const rawLimit = params.limit;
    const limit = (typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit > 0)
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : 5;

    try {
      const files = getGitDiffNumstat(ref);
      const fileRisks = files.map(assessFileRisk);
      const reviewers = suggestReviewers(files, fileRisks);

      return {
        ref,
        recommendedReviewers: reviewers.slice(0, limit),
        filesAnalyzed: files.length,
      };
    } catch (error) {
      return {
        error: true,
        message: sanitizeError(error),
        ref,
      };
    }
  },
};

/**
 * File Risk Tool
 * Assess risk for a specific file path
 */
export const fileRiskTool: MCPTool = {
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
  handler: async (params: Record<string, unknown>) => {
    try {
      const rawPath = params.path;
      if (typeof rawPath !== 'string' || rawPath.length === 0) {
        return { error: true, message: 'path is required (non-empty string)' };
      }
      if (rawPath.length > MAX_PATH_LEN) {
        return { error: true, message: `path too long (max ${MAX_PATH_LEN} chars)` };
      }
      // Only use the path for regex matching (assessFileRisk); still reject
      // control characters to prevent log injection.
      if (/[\x00-\x1F]/.test(rawPath)) {
        return { error: true, message: 'path must not contain control characters' };
      }
      const rawStatus = params.status;
      const status: DiffFile['status'] = (typeof rawStatus === 'string' && VALID_FILE_STATUS.has(rawStatus))
        ? rawStatus as DiffFile['status']
        : 'modified';
      const rawAdd = params.additions;
      const additions = (typeof rawAdd === 'number' && Number.isFinite(rawAdd) && rawAdd >= 0)
        ? Math.min(Math.floor(rawAdd), 1_000_000) : 0;
      const rawDel = params.deletions;
      const deletions = (typeof rawDel === 'number' && Number.isFinite(rawDel) && rawDel >= 0)
        ? Math.min(Math.floor(rawDel), 1_000_000) : 0;

      const file: DiffFile = {
        path: rawPath,
        status,
        additions,
        deletions,
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
    } catch (error) {
      return {
        error: true,
        message: sanitizeError(error),
        path: typeof params.path === 'string' ? params.path.substring(0, 200) : '',
      };
    }
  },
};

/**
 * Diff Stats Tool
 * Get quick diff statistics
 */
export const diffStatsTool: MCPTool = {
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
  handler: async (params: Record<string, unknown>) => {
    const ref = validateRef(params.ref);
    if (ref === null) return { error: true, message: 'Invalid ref: must be a safe git ref (max 256 chars, alphanumeric/._/:@^~-)' };

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
    } catch (error) {
      return {
        error: true,
        message: sanitizeError(error),
        ref,
      };
    }
  },
};

// Export all analyze tools
export const analyzeTools: MCPTool[] = [
  analyzeDiffTool,
  diffRiskTool,
  diffClassifyTool,
  diffReviewersTool,
  fileRiskTool,
  diffStatsTool,
];

export default analyzeTools;
