import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewCodeGraphDb } from '../../src/review/runner.js';
import { openDb, closeDb, type MonographDb } from '../../src/storage/db.js';
import { getEdgesForSource, insertEdge } from '../../src/storage/edge-store.js';
import { insertNode } from '../../src/storage/node-store.js';
import type { MonographNode, ReviewModel } from '../../src/index.js';

interface Fixture {
  root: string;
  db: MonographDb;
}

const authNode: MonographNode = {
  id: 'auth_login',
  label: 'Function',
  name: 'login',
  normLabel: 'login',
  filePath: 'src/auth.ts',
  startLine: 1,
  endLine: 4,
  isExported: true,
};

const sessionNode: MonographNode = {
  id: 'session_create',
  label: 'Function',
  name: 'createSession',
  normLabel: 'createsession',
  filePath: 'src/session.ts',
  startLine: 1,
  endLine: 4,
  isExported: false,
};

function responseFor(
  overrides: Partial<{
    type: string;
    source_node_id: string;
    target_node_id: string | null;
    relation: string | null;
    confidence: number;
    summary: string;
    reason: string;
    evidence: Array<{
      file: string;
      start_line: number;
      end_line: number;
      symbol_id: string | null;
      explanation: string;
    }>;
  }> = {},
): string {
  return JSON.stringify({
    findings: [
      {
        type: 'missing_relationship',
        source_node_id: 'auth_login',
        target_node_id: 'session_create',
        relation: 'USES',
        confidence: 0.65,
        summary: 'Login uses the session service',
        reason: 'The login flow creates a session after validation.',
        evidence: [
          {
            file: 'src/auth.ts',
            start_line: 1,
            end_line: 4,
            symbol_id: 'auth_login',
            explanation: 'The function validates credentials and creates a session.',
          },
        ],
        ...overrides,
      },
    ],
  });
}

function modelFor(response: string, available = true): ReviewModel {
  return {
    isAvailable: () => available,
    review: vi.fn(async () => response),
  };
}

function baseCallEdge() {
  return {
    id: 'auth_login_calls_session_create',
    sourceId: 'auth_login',
    targetId: 'session_create',
    relation: 'CALLS' as const,
    confidence: 'EXTRACTED' as const,
    confidenceScore: 1,
    reason: 'deterministic call resolution',
  };
}

beforeEach(() => {
  // Keep the fixture source small and line-addressable so evidence checks are
  // exercising the same file and line invariants as a real graph.
});

let fixture: Fixture;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'monograph-ai-review-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'auth.ts'),
    'export function login(input: string) {\n  validate(input);\n  return createSession(input);\n}\n',
  );
  writeFileSync(
    join(root, 'src', 'session.ts'),
    'export function createSession(input: string) {\n  return persistSession(input);\n}\n',
  );
  const db = openDb(join(root, '.monomind', 'monograph.db'));
  insertNode(db, authNode);
  insertNode(db, sessionNode);
  insertEdge(db, baseCallEdge());
  fixture = { root, db };
});

afterEach(() => {
  closeDb(fixture.db);
  if (existsSync(fixture.root)) rmSync(fixture.root, { recursive: true, force: true });
});

async function runReview(response: string, options: Record<string, unknown> = {}) {
  return reviewCodeGraphDb(fixture.db, fixture.root, {
    model: modelFor(response),
    maxUnits: 1,
    maxFilesPerUnit: 2,
    ...options,
  });
}

describe('AI code graph review', () => {
  it('accepts a valid inferred edge and persists provenance', async () => {
    const result = await runReview(responseFor());

    expect(result.status).toBe('completed');
    expect(result.validatedFindingCount).toBe(1);
    expect(result.newInferredEdges).toHaveLength(1);
    expect(result.edgesPersisted).toHaveLength(1);
    const persisted = getEdgesForSource(fixture.db, 'auth_login').find(
      (edge) => edge.relation === 'USES',
    );
    expect(persisted?.confidence).toBe('INFERRED');
    expect(persisted?.evidence?.[0]).toMatchObject({
      kind: 'ai-review',
      source: 'ai-review',
      file: 'src/auth.ts',
      startLine: 1,
      endLine: 4,
      symbolId: 'auth_login',
    });
  });

  it('rejects a nonexistent source node without mutation', async () => {
    const result = await runReview(responseFor({ source_node_id: 'missing_node' }));

    expect(result.findingCount).toBe(1);
    expect(result.validatedFindingCount).toBe(0);
    expect(result.rejectedFindings).toHaveLength(1);
    expect(getEdgesForSource(fixture.db, 'auth_login')).toHaveLength(1);
  });

  it('rejects evidence for a nonexistent file', async () => {
    const result = await runReview(
      responseFor({
        evidence: [
          {
            file: 'src/missing.ts',
            start_line: 1,
            end_line: 2,
            symbol_id: null,
            explanation: 'This file does not exist.',
          },
        ],
      }),
    );

    expect(result.validatedFindingCount).toBe(0);
    expect(result.rejectedFindings[0]?.reason).toContain('outside the displayed review context');
  });

  it('rejects an invalid evidence line range', async () => {
    const result = await runReview(
      responseFor({
        evidence: [
          {
            file: 'src/auth.ts',
            start_line: 2,
            end_line: 999,
            symbol_id: 'auth_login',
            explanation: 'The range exceeds the file.',
          },
        ],
      }),
    );

    expect(result.validatedFindingCount).toBe(0);
    expect(result.rejectedFindings[0]?.reason).toContain('invalid line range');
  });

  it('rejects self-relationships', async () => {
    const result = await runReview(
      responseFor({ target_node_id: 'auth_login', relation: 'USES' }),
    );

    expect(result.validatedFindingCount).toBe(0);
    expect(result.rejectedFindings[0]?.reason).toContain('self-relationships');
  });

  it('rejects unsupported relations', async () => {
    const result = await runReview(responseFor({ relation: 'CALLS' }));

    expect(result.validatedFindingCount).toBe(0);
    expect(result.rejectedFindings[0]?.reason).toContain('not allowed');
  });

  it('reports suspicious structural relationships without mutating them', async () => {
    const result = await runReview(
      responseFor({ type: 'suspicious_relationship', relation: 'CALLS' }),
    );

    expect(result.validatedFindingCount).toBe(1);
    expect(result.edgesProposed).toHaveLength(0);
    expect(result.edgesPersisted).toHaveLength(0);
  });

  it('ignores duplicate edge proposals', async () => {
    const model = modelFor(
      JSON.stringify({ findings: [JSON.parse(responseFor()).findings[0], JSON.parse(responseFor()).findings[0]] }),
    );
    const result = await reviewCodeGraphDb(fixture.db, fixture.root, {
      model,
      maxUnits: 1,
      maxFilesPerUnit: 2,
    });

    expect(result.validatedFindingCount).toBe(2);
    expect(result.edgesProposed).toHaveLength(1);
    expect(result.edgesPersisted).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes('duplicate'))).toBe(true);
  });

  it('never overwrites an EXTRACTED edge', async () => {
    insertEdge(fixture.db, {
      ...baseCallEdge(),
      id: 'auth_login_uses_session_create',
      relation: 'USES',
      reason: 'static relationship',
    });

    const result = await runReview(responseFor({ type: 'behavioral_dependency' }));
    const existing = getEdgesForSource(fixture.db, 'auth_login').find(
      (edge) => edge.relation === 'USES',
    );

    expect(result.edgesProposed).toHaveLength(0);
    expect(result.edgesPersisted).toHaveLength(0);
    expect(result.existingEdgesConfirmed).toBe(1);
    expect(existing?.confidence).toBe('EXTRACTED');
    expect(existing?.reason).toBe('static relationship');
  });

  it('protects an EXTRACTED duplicate even when an INFERRED duplicate also exists', async () => {
    insertEdge(fixture.db, {
      ...baseCallEdge(),
      id: 'auth_login_uses_session_create_inferred',
      relation: 'USES',
      confidence: 'INFERRED',
      confidenceScore: 0.4,
      reason: 'older inference',
    });
    insertEdge(fixture.db, {
      ...baseCallEdge(),
      id: 'auth_login_uses_session_create_extracted',
      relation: 'USES',
      confidence: 'EXTRACTED',
      confidenceScore: 1,
      reason: 'static relationship',
    });

    const result = await runReview(responseFor({ confidence: 0.75 }));

    expect(result.edgesProposed).toHaveLength(0);
    expect(result.edgesPersisted).toHaveLength(0);
    expect(result.existingEdgesConfirmed).toBe(1);
    expect(
      getEdgesForSource(fixture.db, 'auth_login').find(
        (edge) => edge.id === 'auth_login_uses_session_create_extracted',
      )?.reason,
    ).toBe('static relationship');
  });

  it('updates an INFERRED edge only with clearly stronger evidence', async () => {
    insertEdge(fixture.db, {
      ...baseCallEdge(),
      id: 'auth_login_uses_session_create',
      relation: 'USES',
      confidence: 'INFERRED',
      confidenceScore: 0.5,
      reason: 'older inference',
    });

    const result = await runReview(responseFor({ confidence: 0.7 }));
    const updated = getEdgesForSource(fixture.db, 'auth_login').find(
      (edge) => edge.relation === 'USES',
    );

    expect(result.updatedInferredEdges).toHaveLength(1);
    expect(result.edgesPersisted).toHaveLength(1);
    expect(updated?.id).toBe('auth_login_uses_session_create');
    expect(updated?.confidenceScore).toBe(0.7);
    expect(updated?.reason).toContain('older inference');
  });

  it('protects an AMBIGUOUS edge from an AI assertion', async () => {
    insertEdge(fixture.db, {
      ...baseCallEdge(),
      id: 'auth_login_uses_session_create_ambiguous',
      relation: 'USES',
      confidence: 'AMBIGUOUS',
      confidenceScore: 0.2,
      reason: 'ambiguous static match',
    });

    const result = await runReview(responseFor());

    expect(result.edgesProposed).toHaveLength(0);
    expect(result.edgesPersisted).toHaveLength(0);
    expect(result.existingEdgesProtected).toBe(1);
  });

  it('fails safely on malformed model output', async () => {
    const result = await runReview('```json\n{"findings": []}\n```');

    expect(result.status).toBe('completed');
    expect(result.findingCount).toBe(0);
    expect(result.edgesPersisted).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes('malformed JSON'))).toBe(true);
  });

  it('performs zero graph mutation in dry-run mode', async () => {
    const before = getEdgesForSource(fixture.db, 'auth_login').length;
    const result = await runReview(responseFor(), { dryRun: true });
    const after = getEdgesForSource(fixture.db, 'auth_login').length;

    expect(result.edgesProposed).toHaveLength(1);
    expect(result.edgesPersisted).toHaveLength(0);
    expect(after).toBe(before);
    expect(result.warnings).toContain('Dry run: no graph changes were written.');
  });

  it('reports an unavailable Claude CLI explicitly', async () => {
    const model: ReviewModel = {
      isAvailable: () => false,
      review: vi.fn(),
    };
    const result = await reviewCodeGraphDb(fixture.db, fixture.root, { model });

    expect(result.status).toBe('skipped');
    expect(result.warnings[0]).toContain('claude');
    expect(result.warnings[0]).toContain('npm install -g @anthropic-ai/claude-code');
    expect(model.review).not.toHaveBeenCalled();
  });

  it('respects bounded unit, file, node, and source limits', async () => {
    const prompts: string[] = [];
    const model: ReviewModel = {
      isAvailable: () => true,
      review: vi.fn(async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify({ findings: [] });
      }),
    };
    const result = await reviewCodeGraphDb(fixture.db, fixture.root, {
      model,
      maxUnits: 1,
      maxFilesPerUnit: 1,
      maxNodesPerUnit: 1,
      maxSourceChars: 300,
    });

    expect(result.reviewedUnits).toBe(1);
    expect(prompts).toHaveLength(1);
    expect((prompts[0].match(/FILE:/g) ?? []).length).toBe(1);
    expect((prompts[0].match(/id=auth_login/g) ?? []).length).toBe(1);
    expect(prompts[0]).not.toContain('id=session_create');
    expect(readFileSync(join(fixture.root, 'src', 'auth.ts'), 'utf8')).toContain('createSession');
  });
});
