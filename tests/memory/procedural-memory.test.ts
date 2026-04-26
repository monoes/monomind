import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ActionSequenceExtractor } from '../../packages/@monomind/memory/src/procedural/action-sequence-extractor.js';
import { LearnedSkillSerializer } from '../../packages/@monomind/memory/src/procedural/learned-skill.js';
import { ActionRecordStore } from '../../packages/@monomind/memory/src/procedural/action-record.js';
import { SkillRegistry } from '../../packages/@monomind/memory/src/procedural/skill-registry.js';
import type { ActionRecord } from '../../packages/@monomind/memory/src/procedural/types.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/** Helper: create an ActionRecord with sensible defaults */
function makeRecord(
  overrides: Partial<ActionRecord> & Pick<ActionRecord, 'runId' | 'toolName'>,
): ActionRecord {
  return {
    recordId: `rec-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'agent-1',
    agentSlug: 'coder',
    toolInput: {},
    outcome: 'success',
    durationMs: 100,
    qualityScore: 0.9,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Build N identical runs each with the given tool sequence */
function buildRuns(
  toolNames: string[],
  count: number,
  agentSlug = 'coder',
  outcome: 'success' | 'failure' = 'success',
  qualityScore = 0.9,
): ActionRecord[] {
  const records: ActionRecord[] = [];
  for (let i = 0; i < count; i++) {
    const runId = `run-${i}`;
    for (let j = 0; j < toolNames.length; j++) {
      records.push(
        makeRecord({
          runId,
          agentSlug,
          toolName: toolNames[j],
          outcome,
          qualityScore,
          timestamp: new Date(Date.now() + i * 10000 + j * 1000).toISOString(),
        }),
      );
    }
  }
  return records;
}

// ============================================================
// ActionSequenceExtractor
// ============================================================
describe('ActionSequenceExtractor', () => {
  it('extracts a group when the same sequence appears 3+ times', () => {
    const records = buildRuns(['Read', 'Edit', 'Grep'], 3);
    const extractor = new ActionSequenceExtractor();
    const groups = extractor.extract(records);

    expect(groups).toHaveLength(1);
    expect(groups[0].fingerprint).toBe('Read -> Edit -> Grep');
    expect(groups[0].successCount).toBe(3);
  });

  it('rejects groups below minSuccessCount', () => {
    const records = buildRuns(['Read', 'Edit'], 2); // only 2 runs
    const extractor = new ActionSequenceExtractor({ minSuccessCount: 3 });
    const groups = extractor.extract(records);

    expect(groups).toHaveLength(0);
  });

  it('rejects groups below minAvgQualityScore', () => {
    const records = buildRuns(['Read', 'Edit'], 4, 'coder', 'success', 0.5);
    const extractor = new ActionSequenceExtractor({ minAvgQualityScore: 0.75 });
    const groups = extractor.extract(records);

    expect(groups).toHaveLength(0);
  });

  it('rejects sequences exceeding maxSequenceLength', () => {
    const longChain = Array.from({ length: 15 }, (_, i) => `tool-${i}`);
    const records = buildRuns(longChain, 4);
    const extractor = new ActionSequenceExtractor({ maxSequenceLength: 12 });
    const groups = extractor.extract(records);

    expect(groups).toHaveLength(0);
  });

  it('groups by different agentSlug separately', () => {
    const coderRecords = buildRuns(['Read', 'Edit'], 3, 'coder');
    const testerRecords = buildRuns(['Read', 'Edit'], 3, 'tester');
    const all = [...coderRecords, ...testerRecords];

    // Both sets use the same runId scheme, so re-tag tester runs to avoid collision
    for (let i = 0; i < testerRecords.length; i++) {
      testerRecords[i].runId = `tester-${testerRecords[i].runId}`;
    }

    const extractor = new ActionSequenceExtractor();
    const groups = extractor.extract(all);

    expect(groups).toHaveLength(2);
    const slugs = groups.map((g) => g.agentSlug).sort();
    expect(slugs).toEqual(['coder', 'tester']);
  });
});

// ============================================================
// LearnedSkillSerializer
// ============================================================
describe('LearnedSkillSerializer', () => {
  const sampleRecords = buildRuns(['Read', 'Edit'], 1);

  it('create produces a valid LearnedSkill', () => {
    const skill = LearnedSkillSerializer.create(
      'read-edit-pattern',
      'coder',
      'read then edit',
      sampleRecords,
      5,
      0.92,
      ['run-0', 'run-1'],
    );

    expect(skill.skillId).toBeDefined();
    expect(skill.name).toBe('read-edit-pattern');
    expect(skill.agentSlug).toBe('coder');
    expect(skill.trigger.pattern).toBe('read then edit');
    expect(skill.actionSequence).toHaveLength(2);
    expect(skill.successCount).toBe(5);
    expect(skill.avgQualityScore).toBe(0.92);
    expect(skill.version).toBe(1);
    expect(skill.createdAt).toBeDefined();
    expect(skill.lastUpdatedAt).toBeDefined();
  });

  it('toMarkdown contains YAML frontmatter', () => {
    const skill = LearnedSkillSerializer.create(
      'test-skill',
      'coder',
      'trigger',
      sampleRecords,
      3,
      0.85,
      ['r1'],
    );
    const md = LearnedSkillSerializer.toMarkdown(skill);

    expect(md).toMatch(/^---\n/);
    expect(md).toContain('---');
  });

  it('toMarkdown contains skill_id, success_count, avg_quality_score', () => {
    const skill = LearnedSkillSerializer.create(
      'test-skill',
      'coder',
      'trigger',
      sampleRecords,
      3,
      0.85,
      ['r1'],
    );
    const md = LearnedSkillSerializer.toMarkdown(skill);

    expect(md).toContain(`skill_id: ${skill.skillId}`);
    expect(md).toContain('success_count: 3');
    expect(md).toContain('avg_quality_score: 0.85');
  });

  it('toMarkdown contains action sequence steps', () => {
    const skill = LearnedSkillSerializer.create(
      'test-skill',
      'coder',
      'trigger',
      sampleRecords,
      3,
      0.85,
      ['r1'],
    );
    const md = LearnedSkillSerializer.toMarkdown(skill);

    expect(md).toContain('Step 1: Read');
    expect(md).toContain('Step 2: Edit');
  });
});

// ============================================================
// ActionRecordStore
// ============================================================
describe('ActionRecordStore', () => {
  let tempDir: string;
  let store: ActionRecordStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'action-record-test-'));
    store = new ActionRecordStore(join(tempDir, 'action-records.jsonl'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('record appends to JSONL', () => {
    const rec = makeRecord({ runId: 'run-1', toolName: 'Read' });
    store.record(rec);
    store.record(makeRecord({ runId: 'run-1', toolName: 'Edit' }));

    const seq = store.getRunSequence('run-1');
    expect(seq).toHaveLength(2);
  });

  it('queryByAgentSlug filters correctly', () => {
    store.record(makeRecord({ runId: 'r1', toolName: 'Read', agentSlug: 'coder' }));
    store.record(makeRecord({ runId: 'r2', toolName: 'Edit', agentSlug: 'tester' }));
    store.record(makeRecord({ runId: 'r3', toolName: 'Grep', agentSlug: 'coder' }));

    const coderRecords = store.queryByAgentSlug('coder');
    expect(coderRecords).toHaveLength(2);
    expect(coderRecords.every((r) => r.agentSlug === 'coder')).toBe(true);
  });

  it('getRunSequence returns sorted records', () => {
    const early = makeRecord({
      runId: 'run-x',
      toolName: 'Read',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const late = makeRecord({
      runId: 'run-x',
      toolName: 'Edit',
      timestamp: '2026-01-01T00:01:00.000Z',
    });
    // Insert in reverse order
    store.record(late);
    store.record(early);

    const seq = store.getRunSequence('run-x');
    expect(seq).toHaveLength(2);
    expect(seq[0].toolName).toBe('Read');
    expect(seq[1].toolName).toBe('Edit');
  });
});

// ============================================================
// SkillRegistry
// ============================================================
describe('SkillRegistry', () => {
  let tempDir: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'skill-registry-test-'));
    registry = new SkillRegistry(join(tempDir, 'learned-skills.jsonl'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('register and list work', () => {
    const skill = LearnedSkillSerializer.create(
      'skill-a',
      'coder',
      'pattern-a',
      buildRuns(['Read'], 1),
      3,
      0.9,
      ['r1'],
    );
    registry.register(skill);

    const all = registry.list();
    expect(all).toHaveLength(1);
    expect(all[0].skillId).toBe(skill.skillId);
  });

  it('findByFingerprint matches existing skills', () => {
    const records = buildRuns(['Read', 'Edit'], 1);
    const skill = LearnedSkillSerializer.create(
      'skill-b',
      'coder',
      'pattern-b',
      records,
      3,
      0.9,
      ['r1'],
    );
    registry.register(skill);

    // Create another skill with same agent + tool chain
    const sameFingerprint = LearnedSkillSerializer.create(
      'skill-c',
      'coder',
      'pattern-c',
      buildRuns(['Read', 'Edit'], 1),
      5,
      0.95,
      ['r2'],
    );

    const found = registry.findByFingerprint(sameFingerprint);
    expect(found).toBeDefined();
    expect(found!.skillId).toBe(skill.skillId);
  });
});
