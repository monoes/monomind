import type { EdgeRelation, MonographEdge } from '../types.js';
import { hasReviewSourceFile, normaliseReviewPath, resolveReviewFile } from './context.js';
import {
  AI_REVIEW_RELATION_SET,
  type RawReviewEvidence,
  type RawReviewFinding,
  REVIEW_FINDING_TYPES,
  type ReviewEvidence,
  type ReviewUnit,
  type ValidatedReviewFinding,
} from './types.js';

const MAX_FINDINGS_PER_RESPONSE = 32;
const MAX_EVIDENCE_PER_FINDING = 8;
const MAX_TEXT_LENGTH = 2_000;
const MAX_FILE_PATH_LENGTH = 1_000;
const MAX_RESPONSE_CHARS = 200_000;

const FINDING_KEYS = [
  'type',
  'source_node_id',
  'target_node_id',
  'relation',
  'confidence',
  'summary',
  'reason',
  'evidence',
] as const;

const EVIDENCE_KEYS = ['file', 'start_line', 'end_line', 'symbol_id', 'explanation'] as const;

export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function requireText(value: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReviewValidationError(`${field} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > maxLength) throw new ReviewValidationError(`${field} is too long`);
  return text;
}

function parseEvidence(value: unknown, findingIndex: number): RawReviewEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ReviewValidationError(`findings[${findingIndex}].evidence must not be empty`);
  }
  if (value.length > MAX_EVIDENCE_PER_FINDING) {
    throw new ReviewValidationError(`findings[${findingIndex}].evidence exceeds the hard limit`);
  }

  return value.map((item, evidenceIndex) => {
    if (!isRecord(item) || !hasExactKeys(item, EVIDENCE_KEYS)) {
      throw new ReviewValidationError(
        `findings[${findingIndex}].evidence[${evidenceIndex}] has an invalid shape`,
      );
    }
    if (
      !Number.isInteger(item.start_line) ||
      !Number.isInteger(item.end_line) ||
      (typeof item.symbol_id !== 'string' && item.symbol_id !== null)
    ) {
      throw new ReviewValidationError(
        `findings[${findingIndex}].evidence[${evidenceIndex}] has invalid coordinates or symbol_id`,
      );
    }
    const file = requireText(
      item.file,
      `findings[${findingIndex}].evidence[${evidenceIndex}].file`,
      MAX_FILE_PATH_LENGTH,
    );
    const explanation = requireText(
      item.explanation,
      `findings[${findingIndex}].evidence[${evidenceIndex}].explanation`,
    );
    if (typeof item.symbol_id === 'string' && item.symbol_id.trim().length === 0) {
      throw new ReviewValidationError(
        `findings[${findingIndex}].evidence[${evidenceIndex}].symbol_id must not be empty`,
      );
    }
    return {
      file,
      start_line: item.start_line as number,
      end_line: item.end_line as number,
      symbol_id: typeof item.symbol_id === 'string' ? item.symbol_id.trim() : null,
      explanation,
    };
  });
}

/** Parse the model boundary without accepting markdown, prose, or fuzzy repairs. */
export function parseReviewResponse(text: string): RawReviewFinding[] {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ReviewValidationError('Claude returned an empty review response');
  }
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new ReviewValidationError('Claude review response exceeds the hard size limit');
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReviewValidationError('Claude returned malformed JSON');
  }

  if (!isRecord(value) || !hasExactKeys(value, ['findings']) || !Array.isArray(value.findings)) {
    throw new ReviewValidationError(
      'Review response must be exactly an object with a findings array',
    );
  }
  if (value.findings.length > MAX_FINDINGS_PER_RESPONSE) {
    throw new ReviewValidationError('Review response exceeds the hard finding limit');
  }

  return value.findings.map((item, index) => {
    if (!isRecord(item) || !hasExactKeys(item, FINDING_KEYS)) {
      throw new ReviewValidationError(`findings[${index}] has an invalid shape`);
    }
    if (!REVIEW_FINDING_TYPES.includes(item.type as (typeof REVIEW_FINDING_TYPES)[number])) {
      throw new ReviewValidationError(`findings[${index}].type is unsupported`);
    }
    if (typeof item.source_node_id !== 'string' || item.source_node_id.trim().length === 0) {
      throw new ReviewValidationError(
        `findings[${index}].source_node_id must be a non-empty string`,
      );
    }
    if (item.target_node_id !== null && typeof item.target_node_id !== 'string') {
      throw new ReviewValidationError(`findings[${index}].target_node_id must be a string or null`);
    }
    if (item.relation !== null && typeof item.relation !== 'string') {
      throw new ReviewValidationError(`findings[${index}].relation must be a string or null`);
    }
    if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence)) {
      throw new ReviewValidationError(`findings[${index}].confidence must be finite`);
    }

    return {
      type: item.type as RawReviewFinding['type'],
      source_node_id: item.source_node_id.trim(),
      target_node_id:
        typeof item.target_node_id === 'string' ? item.target_node_id.trim() : item.target_node_id,
      relation: typeof item.relation === 'string' ? item.relation.trim() : item.relation,
      confidence: item.confidence,
      summary: requireText(item.summary, `findings[${index}].summary`),
      reason: requireText(item.reason, `findings[${index}].reason`),
      evidence: parseEvidence(item.evidence, index),
    };
  });
}

function rangesCover(
  ranges: ReadonlyArray<{ startLine: number; endLine: number }>,
  startLine: number,
  endLine: number,
): boolean {
  return ranges.some((range) => range.startLine <= startLine && range.endLine >= endLine);
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA <= endB && endA >= startB;
}

function existingEdgeExists(
  edges: readonly MonographEdge[],
  sourceId: string,
  targetId: string,
  relation: EdgeRelation,
): boolean {
  return edges.some(
    (edge) =>
      edge.sourceId === sourceId && edge.targetId === targetId && edge.relation === relation,
  );
}

function validateEvidence(
  rawEvidence: RawReviewEvidence[],
  unit: ReviewUnit,
  repoPath: string,
): ReviewEvidence[] {
  return rawEvidence.map((evidence, index) => {
    const file = normaliseReviewPath(evidence.file);
    const sourceFile = unit.sourceFiles.find((candidate) => candidate.filePath === file);
    if (!sourceFile || !hasReviewSourceFile(unit, file)) {
      throw new ReviewValidationError(
        `evidence[${index}] references a file outside the displayed review context: ${evidence.file}`,
      );
    }
    if (!resolveReviewFile(repoPath, file)) {
      throw new ReviewValidationError(
        `evidence[${index}] references a missing or unsafe file: ${file}`,
      );
    }
    if (
      evidence.start_line < 1 ||
      evidence.end_line < evidence.start_line ||
      evidence.end_line > sourceFile.totalLines
    ) {
      throw new ReviewValidationError(`evidence[${index}] has an invalid line range`);
    }
    if (!rangesCover(sourceFile.ranges, evidence.start_line, evidence.end_line)) {
      throw new ReviewValidationError(
        `evidence[${index}] cites lines that were not included in the bounded context`,
      );
    }

    if (evidence.symbol_id !== null) {
      const symbol = unit.nodes.find((node) => node.id === evidence.symbol_id);
      if (!symbol)
        throw new ReviewValidationError(`evidence[${index}] references an unknown symbol`);
      if (normaliseReviewPath(symbol.filePath ?? '') !== file) {
        throw new ReviewValidationError(`evidence[${index}] symbol does not belong to its file`);
      }
      if (
        symbol.startLine != null &&
        symbol.endLine != null &&
        !rangesOverlap(evidence.start_line, evidence.end_line, symbol.startLine, symbol.endLine)
      ) {
        throw new ReviewValidationError(`evidence[${index}] range does not cover its symbol`);
      }
    }

    return {
      file,
      startLine: evidence.start_line,
      endLine: evidence.end_line,
      symbolId: evidence.symbol_id,
      explanation: evidence.explanation,
    };
  });
}

export function validateReviewFinding(
  raw: RawReviewFinding,
  unit: ReviewUnit,
  repoPath: string,
): ValidatedReviewFinding {
  const source = unit.nodes.find((node) => node.id === raw.source_node_id);
  if (!source) throw new ReviewValidationError('source_node_id is not present in the review unit');
  if (raw.confidence < 0 || raw.confidence > 1) {
    throw new ReviewValidationError('confidence must be between 0 and 1');
  }

  const edgeFinding =
    raw.type === 'missing_relationship' ||
    raw.type === 'behavioral_dependency' ||
    raw.type === 'suspicious_relationship';
  if (edgeFinding) {
    if (raw.target_node_id === null || raw.relation === null) {
      throw new ReviewValidationError('relationship findings require target_node_id and relation');
    }
    const target = unit.nodes.find((node) => node.id === raw.target_node_id);
    if (!target)
      throw new ReviewValidationError('target_node_id is not present in the review unit');
    if (source.id === target.id)
      throw new ReviewValidationError('self-relationships are not allowed');
    const relation = raw.relation.toUpperCase() as EdgeRelation;
    if (raw.type !== 'suspicious_relationship' && !AI_REVIEW_RELATION_SET.has(relation)) {
      throw new ReviewValidationError(`relation is not allowed for AI review: ${raw.relation}`);
    }
    if (
      raw.type === 'suspicious_relationship' &&
      !existingEdgeExists(unit.edges, source.id, target.id, relation)
    ) {
      throw new ReviewValidationError(
        'suspicious_relationship must reference an existing listed edge',
      );
    }

    const evidence = validateEvidence(raw.evidence, unit, repoPath);
    return {
      type: raw.type,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      relation,
      confidence: raw.confidence,
      summary: raw.summary,
      reason: raw.reason,
      evidence,
      unitId: unit.id,
    };
  }

  if (raw.target_node_id !== null || raw.relation !== null) {
    throw new ReviewValidationError(
      'non-relationship findings require null target_node_id and relation',
    );
  }

  return {
    type: raw.type,
    sourceNodeId: source.id,
    targetNodeId: null,
    relation: null,
    confidence: raw.confidence,
    summary: raw.summary,
    reason: raw.reason,
    evidence: validateEvidence(raw.evidence, unit, repoPath),
    unitId: unit.id,
  };
}
