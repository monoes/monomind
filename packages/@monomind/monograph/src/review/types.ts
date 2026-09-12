import type { EdgeRelation, MonographEdge, MonographNode } from '../types.js';

export const REVIEW_FINDING_TYPES = [
  'missing_relationship',
  'behavioral_dependency',
  'side_effect',
  'invariant',
  'architectural_role',
  'suspicious_relationship',
] as const;

export type ReviewFindingType = (typeof REVIEW_FINDING_TYPES)[number];

/**
 * Relations the first code-review implementation may infer. Structural
 * relations remain deterministic and are deliberately excluded.
 */
export const AI_REVIEW_RELATIONS = [
  'USES',
  'FETCHES',
  'QUERIES',
  'WRAPS',
  'REFERENCES',
  'RELATED_TO',
  'CAUSES',
] as const satisfies readonly EdgeRelation[];

export type AiReviewRelation = (typeof AI_REVIEW_RELATIONS)[number];

export const AI_REVIEW_RELATION_SET = new Set<EdgeRelation>(AI_REVIEW_RELATIONS);

export const REVIEW_LIMITS = {
  defaultMaxUnits: 8,
  maxUnits: 32,
  defaultMaxFilesPerUnit: 6,
  maxFilesPerUnit: 12,
  defaultMaxNodesPerUnit: 24,
  maxNodesPerUnit: 50,
  defaultMaxSourceChars: 12_000,
  // Claude is invoked through a process argument. Keep the hard context cap
  // below Windows command-line limits after prompt overhead is included.
  maxSourceChars: 20_000,
  defaultTimeoutMs: 60_000,
  maxTimeoutMs: 180_000,
} as const;

export interface ReviewModel {
  isAvailable(): boolean;
  review(prompt: string, timeoutMs: number): Promise<string>;
}

export interface CodeGraphReviewOptions {
  maxUnits?: number;
  maxFilesPerUnit?: number;
  maxNodesPerUnit?: number;
  maxSourceChars?: number;
  timeoutMs?: number;
  dryRun?: boolean;
  model?: ReviewModel;
  onProgress?: (progress: ReviewProgress) => void;
}

export interface ReviewProgress {
  phase: 'select' | 'review' | 'validate' | 'persist';
  unit: number;
  totalUnits: number;
  message?: string;
}

export interface RawReviewEvidence {
  file: string;
  start_line: number;
  end_line: number;
  symbol_id: string | null;
  explanation: string;
}

export interface RawReviewFinding {
  type: ReviewFindingType;
  source_node_id: string;
  target_node_id: string | null;
  relation: string | null;
  confidence: number;
  summary: string;
  reason: string;
  evidence: RawReviewEvidence[];
}

export interface ReviewEvidence {
  file: string;
  startLine: number;
  endLine: number;
  symbolId: string | null;
  explanation: string;
}

export interface ValidatedReviewFinding {
  type: ReviewFindingType;
  sourceNodeId: string;
  targetNodeId: string | null;
  relation: EdgeRelation | null;
  confidence: number;
  summary: string;
  reason: string;
  evidence: ReviewEvidence[];
  unitId: string;
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface ReviewSourceFile {
  filePath: string;
  totalLines: number;
  ranges: LineRange[];
  content: string;
}

export interface ReviewUnit {
  id: string;
  centerNodeId: string;
  nodes: MonographNode[];
  edges: MonographEdge[];
  sourceFiles: ReviewSourceFile[];
  prompt: string;
}

export interface ReviewUnitSummary {
  id: string;
  centerNodeId: string;
  centerName: string;
  centerLabel: string;
  nodeCount: number;
  fileCount: number;
}

export interface ReviewRejection {
  unitId?: string;
  index: number | null;
  reason: string;
}

export type CodeGraphReviewStatus = 'completed' | 'skipped' | 'failed';

export interface CodeGraphReviewResult {
  status: CodeGraphReviewStatus;
  dryRun: boolean;
  reviewedUnits: number;
  findingCount: number;
  validatedFindingCount: number;
  reviewedUnitSummaries: ReviewUnitSummary[];
  findings: ValidatedReviewFinding[];
  rejectedFindings: ReviewRejection[];
  edgesProposed: MonographEdge[];
  newInferredEdges: MonographEdge[];
  updatedInferredEdges: MonographEdge[];
  edgesPersisted: MonographEdge[];
  existingEdgesConfirmed: number;
  existingEdgesProtected: number;
  warnings: string[];
}
