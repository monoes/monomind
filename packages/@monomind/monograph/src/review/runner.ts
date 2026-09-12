import { join, resolve } from 'node:path';
import { claudeCliCall, isClaudeCliAvailable } from '../claude-cli.js';
import type { MonographDb } from '../storage/db.js';
import { closeDb, openDb } from '../storage/db.js';
import { rowToEdge } from '../storage/edge-store.js';
import type { EdgeRelation, EvidenceEntry, MonographEdge } from '../types.js';
import { makeId } from '../types.js';
import { selectReviewUnits } from './context.js';
import type {
  CodeGraphReviewOptions,
  CodeGraphReviewResult,
  ReviewModel,
  ReviewProgress,
  ValidatedReviewFinding,
} from './types.js';
import { REVIEW_LIMITS } from './types.js';
import { parseReviewResponse, ReviewValidationError, validateReviewFinding } from './validation.js';

const MAX_INFERRED_SCORE = 0.75;
const STRONGER_SCORE_DELTA = 0.05;

const defaultReviewModel: ReviewModel = {
  isAvailable: isClaudeCliAvailable,
  review: claudeCliCall,
};

interface NormalisedReviewOptions {
  maxUnits: number;
  maxFilesPerUnit: number;
  maxNodesPerUnit: number;
  maxSourceChars: number;
  timeoutMs: number;
  dryRun: boolean;
}

interface EdgePlan {
  proposed: MonographEdge[];
  newEdges: MonographEdge[];
  updatedEdges: MonographEdge[];
  existingEdgesConfirmed: number;
  existingEdgesProtected: number;
  warnings: string[];
}

function positiveInt(value: number | undefined, fallback: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), maximum);
}

function normaliseOptions(options: CodeGraphReviewOptions): NormalisedReviewOptions {
  return {
    maxUnits: positiveInt(options.maxUnits, REVIEW_LIMITS.defaultMaxUnits, REVIEW_LIMITS.maxUnits),
    maxFilesPerUnit: positiveInt(
      options.maxFilesPerUnit,
      REVIEW_LIMITS.defaultMaxFilesPerUnit,
      REVIEW_LIMITS.maxFilesPerUnit,
    ),
    maxNodesPerUnit: positiveInt(
      options.maxNodesPerUnit,
      REVIEW_LIMITS.defaultMaxNodesPerUnit,
      REVIEW_LIMITS.maxNodesPerUnit,
    ),
    maxSourceChars: positiveInt(
      options.maxSourceChars,
      REVIEW_LIMITS.defaultMaxSourceChars,
      REVIEW_LIMITS.maxSourceChars,
    ),
    timeoutMs: positiveInt(
      options.timeoutMs,
      REVIEW_LIMITS.defaultTimeoutMs,
      REVIEW_LIMITS.maxTimeoutMs,
    ),
    dryRun: options.dryRun === true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportProgress(options: CodeGraphReviewOptions, progress: ReviewProgress): void {
  try {
    options.onProgress?.(progress);
  } catch {
    // Progress reporting must not turn a completed review into a failed one.
  }
}

function sourceEvidence(finding: ValidatedReviewFinding, score: number): EvidenceEntry[] {
  return finding.evidence.map((evidence) => {
    const entry: EvidenceEntry = {
      kind: 'ai-review',
      weight: score,
      note: evidence.explanation,
      file: evidence.file,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      source: 'ai-review',
    };
    if (evidence.symbolId !== null) entry.symbolId = evidence.symbolId;
    return entry;
  });
}

function edgeFromFinding(
  finding: ValidatedReviewFinding,
  id = makeId(
    'ai_review_edge',
    finding.sourceNodeId,
    finding.targetNodeId ?? '',
    finding.relation ?? '',
  ),
): MonographEdge | undefined {
  if (finding.targetNodeId === null || finding.relation === null) return undefined;
  const confidenceScore = Math.min(finding.confidence, MAX_INFERRED_SCORE);
  return {
    id,
    sourceId: finding.sourceNodeId,
    targetId: finding.targetNodeId,
    relation: finding.relation,
    confidence: 'INFERRED',
    confidenceScore,
    weight: confidenceScore,
    reason: `AI review: ${finding.summary} ${finding.reason}`.slice(0, 4_000),
    evidence: sourceEvidence(finding, confidenceScore),
  };
}

function equivalentEdge(db: MonographDb, edge: MonographEdge): MonographEdge | undefined {
  const row = db
    .prepare(`
      SELECT * FROM edges
      WHERE source_id = ? AND target_id = ? AND relation = ?
      ORDER BY CASE confidence
        WHEN 'EXTRACTED' THEN 3
        WHEN 'AMBIGUOUS' THEN 2
        WHEN 'INFERRED' THEN 1
        ELSE 0
      END DESC, id
      LIMIT 1
    `)
    .get(edge.sourceId, edge.targetId, edge.relation) as Record<string, unknown> | undefined;
  return row ? rowToEdge(row) : undefined;
}

function edgeWithMergedProvenance(existing: MonographEdge, proposed: MonographEdge): MonographEdge {
  return {
    ...proposed,
    id: existing.id,
    reason: [existing.reason, proposed.reason].filter(Boolean).join(' | ').slice(0, 4_000),
    evidence: [...(existing.evidence ?? []), ...(proposed.evidence ?? [])],
  };
}

function isClearlyStronger(existing: MonographEdge, proposed: MonographEdge): boolean {
  if (existing.confidence !== 'INFERRED') return false;
  const evidenceCount = proposed.evidence?.length ?? 0;
  const existingEvidenceCount = existing.evidence?.length ?? 0;
  return (
    proposed.confidenceScore >= existing.confidenceScore + STRONGER_SCORE_DELTA &&
    evidenceCount >= existingEvidenceCount
  );
}

function edgePlan(db: MonographDb, findings: ValidatedReviewFinding[]): EdgePlan {
  const proposed: MonographEdge[] = [];
  const newEdges: MonographEdge[] = [];
  const updatedEdges: MonographEdge[] = [];
  const warnings: string[] = [];
  const seenKeys = new Set<string>();
  let existingEdgesConfirmed = 0;
  let existingEdgesProtected = 0;

  const edgeFindings = findings
    .filter((finding) => finding.targetNodeId !== null && finding.relation !== null)
    .sort((a, b) => b.confidence - a.confidence);

  for (const finding of edgeFindings) {
    const relation = finding.relation as EdgeRelation;
    const key = `${finding.sourceNodeId}\u0000${finding.targetNodeId}\u0000${relation}`;
    if (seenKeys.has(key)) {
      warnings.push(`Ignored duplicate AI edge proposal: ${key}`);
      continue;
    }
    seenKeys.add(key);

    const candidate = edgeFromFinding(finding);
    if (!candidate) continue;
    const existing = equivalentEdge(db, candidate);

    // A suspicious relationship is a report-only finding by design.
    if (finding.type === 'suspicious_relationship') continue;

    if (!existing) {
      const idCollision = db
        .prepare('SELECT source_id, target_id, relation FROM edges WHERE id = ?')
        .get(candidate.id) as
        | { source_id: string; target_id: string; relation: string }
        | undefined;
      if (idCollision) {
        warnings.push(
          `Ignored AI edge ID collision without replacing existing edge: ${candidate.id}`,
        );
        continue;
      }
      proposed.push(candidate);
      newEdges.push(candidate);
      continue;
    }

    if (existing.confidence === 'EXTRACTED') {
      existingEdgesConfirmed++;
      continue;
    }

    if (existing.confidence === 'INFERRED' && isClearlyStronger(existing, candidate)) {
      const updated = edgeWithMergedProvenance(existing, candidate);
      proposed.push(updated);
      updatedEdges.push(updated);
      continue;
    }

    if (existing.confidence === 'INFERRED') {
      existingEdgesConfirmed++;
      continue;
    }

    // AMBIGUOUS is deliberately protected. A review can report it, but cannot
    // turn uncertain static output into an AI assertion in this first version.
    existingEdgesProtected++;
    warnings.push(
      `Protected existing AMBIGUOUS edge from AI review: ${existing.sourceId} -[${existing.relation}]-> ${existing.targetId}`,
    );
  }

  return {
    proposed,
    newEdges,
    updatedEdges,
    existingEdgesConfirmed,
    existingEdgesProtected,
    warnings,
  };
}

function insertEdgeRow(db: MonographDb, edge: MonographEdge): void {
  db.prepare(`
    INSERT INTO edges
      (id, source_id, target_id, relation, confidence, confidence_score, weight, reason, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    edge.id,
    edge.sourceId,
    edge.targetId,
    edge.relation,
    edge.confidence,
    edge.confidenceScore,
    edge.weight ?? 1,
    edge.reason ?? null,
    edge.evidence != null ? JSON.stringify(edge.evidence) : null,
  );
}

function persistPlan(
  db: MonographDb,
  plan: EdgePlan,
): { persisted: MonographEdge[]; warnings: string[] } {
  const persisted: MonographEdge[] = [];
  const warnings: string[] = [];
  const transaction = db.transaction(() => {
    for (const edge of plan.newEdges) {
      const current = equivalentEdge(db, edge);
      if (current) {
        warnings.push(
          `Skipped concurrent AI edge proposal already present: ${edge.sourceId} -[${edge.relation}]-> ${edge.targetId}`,
        );
        continue;
      }
      insertEdgeRow(db, edge);
      persisted.push(edge);
    }

    for (const edge of plan.updatedEdges) {
      const current = equivalentEdge(db, edge);
      if (!current || current.id !== edge.id || current.confidence !== 'INFERRED') {
        warnings.push(`Skipped AI update because the existing edge changed: ${edge.id}`);
        continue;
      }
      const update = db
        .prepare(`
        UPDATE edges
        SET confidence = 'INFERRED', confidence_score = ?, weight = ?, reason = ?, evidence = ?
        WHERE id = ? AND confidence = 'INFERRED'
      `)
        .run(
          edge.confidenceScore,
          edge.weight ?? 1,
          edge.reason ?? null,
          edge.evidence != null ? JSON.stringify(edge.evidence) : null,
          edge.id,
        );
      if (update.changes === 1) persisted.push(edge);
      else warnings.push(`Skipped AI update because the existing edge changed: ${edge.id}`);
    }
  });
  transaction();
  return { persisted, warnings };
}

function createResult(dryRun: boolean): CodeGraphReviewResult {
  return {
    status: 'completed',
    dryRun,
    reviewedUnits: 0,
    findingCount: 0,
    validatedFindingCount: 0,
    reviewedUnitSummaries: [],
    findings: [],
    rejectedFindings: [],
    edgesProposed: [],
    newInferredEdges: [],
    updatedInferredEdges: [],
    edgesPersisted: [],
    existingEdgesConfirmed: 0,
    existingEdgesProtected: 0,
    warnings: [],
  };
}

export async function reviewCodeGraphDb(
  db: MonographDb,
  repoPath: string,
  options: CodeGraphReviewOptions = {},
): Promise<CodeGraphReviewResult> {
  const settings = normaliseOptions(options);
  const result = createResult(settings.dryRun);
  const model = options.model ?? defaultReviewModel;

  try {
    if (!model.isAvailable()) {
      result.status = 'skipped';
      result.warnings.push(
        'AI graph review skipped: the `claude` CLI was not found on PATH. Install it with: npm install -g @anthropic-ai/claude-code',
      );
      return result;
    }
  } catch (error) {
    result.status = 'failed';
    result.warnings.push(`Could not check Claude CLI availability: ${errorMessage(error)}`);
    return result;
  }

  const selection = selectReviewUnits(db, resolve(repoPath), settings);
  result.reviewedUnitSummaries = selection.summaries;
  result.reviewedUnits = selection.units.length;
  result.warnings.push(...selection.warnings);
  reportProgress(options, {
    phase: 'select',
    unit: 0,
    totalUnits: selection.units.length,
    message: `Selected ${selection.units.length} bounded review units`,
  });

  if (selection.units.length === 0) {
    result.warnings.push('No reviewable code nodes with readable source evidence were found.');
    return result;
  }

  for (const [index, unit] of selection.units.entries()) {
    reportProgress(options, {
      phase: 'review',
      unit: index + 1,
      totalUnits: selection.units.length,
      message: `Reviewing ${unit.id}`,
    });

    let rawFindings;
    try {
      const response = await model.review(unit.prompt, settings.timeoutMs);
      rawFindings = parseReviewResponse(response);
    } catch (error) {
      const reason =
        error instanceof ReviewValidationError
          ? `Rejected Claude response for ${unit.id}: ${error.message}`
          : `Claude review failed for ${unit.id}: ${errorMessage(error)}`;
      result.rejectedFindings.push({ unitId: unit.id, index: null, reason });
      result.warnings.push(reason);
      continue;
    }

    result.findingCount += rawFindings.length;
    for (const [findingIndex, rawFinding] of rawFindings.entries()) {
      reportProgress(options, {
        phase: 'validate',
        unit: index + 1,
        totalUnits: selection.units.length,
        message: `Validating finding ${findingIndex + 1}/${rawFindings.length}`,
      });
      try {
        result.findings.push(validateReviewFinding(rawFinding, unit, resolve(repoPath)));
        result.validatedFindingCount++;
      } catch (error) {
        const reason = errorMessage(error);
        result.rejectedFindings.push({ unitId: unit.id, index: findingIndex, reason });
      }
    }
  }

  const plan = edgePlan(db, result.findings);
  result.edgesProposed = plan.proposed;
  result.newInferredEdges = plan.newEdges;
  result.updatedInferredEdges = plan.updatedEdges;
  result.existingEdgesConfirmed = plan.existingEdgesConfirmed;
  result.existingEdgesProtected = plan.existingEdgesProtected;
  result.warnings.push(...plan.warnings);

  if (settings.dryRun) {
    result.warnings.push('Dry run: no graph changes were written.');
    return result;
  }

  if (plan.proposed.length === 0) return result;

  reportProgress(options, {
    phase: 'persist',
    unit: selection.units.length,
    totalUnits: selection.units.length,
    message: `Persisting ${plan.proposed.length} validated inferred edge changes`,
  });
  try {
    const persisted = persistPlan(db, plan);
    result.edgesPersisted = persisted.persisted;
    result.warnings.push(...persisted.warnings);
  } catch (error) {
    result.status = 'failed';
    result.warnings.push(`AI edge persistence rolled back: ${errorMessage(error)}`);
  }

  return result;
}

export async function reviewCodeGraph(
  repoPath: string,
  options: CodeGraphReviewOptions = {},
): Promise<CodeGraphReviewResult> {
  const root = resolve(repoPath);
  const db = openDb(join(root, '.monomind', 'monograph.db'), { fileMustExist: true });
  try {
    return await reviewCodeGraphDb(db, root, options);
  } finally {
    closeDb(db);
  }
}
