import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { buildPlanningPrompt } from '../../packages/@monomind/hooks/src/planning/planning-prompt.js';
import { validatePlan } from '../../packages/@monomind/hooks/src/planning/plan-validator.js';
import { PlanStore } from '../../packages/@monomind/hooks/src/planning/plan-store.js';
import type { PlanningConfig, AgentPlan } from '../../packages/@monomind/hooks/src/planning/types.js';
import { DEFAULT_PLANNING_CONFIG } from '../../packages/@monomind/hooks/src/planning/types.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<PlanningConfig> = {}): PlanningConfig {
  return { ...DEFAULT_PLANNING_CONFIG, ...overrides };
}

function makePlan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    planId: 'plan-001',
    agentSlug: 'coder',
    taskDescription: 'Implement feature X',
    plan: '- Step 1\n- Step 2',
    format: 'markdown',
    estimatedSteps: 2,
    createdAt: new Date('2026-04-07T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildPlanningPrompt
// ---------------------------------------------------------------------------

describe('buildPlanningPrompt', () => {
  it('includes markdown format instructions', () => {
    const prompt = buildPlanningPrompt(makeConfig({ format: 'markdown' }), 'Do something');
    expect(prompt).toContain('## Plan');
    expect(prompt).toContain('- Step 1:');
    expect(prompt).toContain('Do something');
  });

  it('includes JSON format instructions', () => {
    const prompt = buildPlanningPrompt(makeConfig({ format: 'json' }), 'Do something');
    expect(prompt).toContain('"steps"');
    expect(prompt).toContain('"estimatedSteps"');
    expect(prompt).toContain('"confidence"');
  });

  it('includes token budget instruction', () => {
    const prompt = buildPlanningPrompt(makeConfig({ maxPlanTokens: 300 }), 'Task');
    expect(prompt).toContain('300 tokens');
    expect(prompt).toContain('1200 characters');
  });
});

// ---------------------------------------------------------------------------
// validatePlan
// ---------------------------------------------------------------------------

describe('validatePlan', () => {
  it('accepts a valid markdown plan with bullets', () => {
    const result = validatePlan('- First thing\n- Second thing\n- Third thing', makeConfig({ format: 'markdown' }));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.parsedSteps).toBe(3);
  });

  it('accepts a valid JSON plan with steps array', () => {
    const json = JSON.stringify({ steps: ['a', 'b'], estimatedSteps: 2, confidence: 0.9 });
    const result = validatePlan(json, makeConfig({ format: 'json' }));
    expect(result.valid).toBe(true);
    expect(result.parsedSteps).toBe(2);
    expect(result.confidence).toBe(0.9);
  });

  it('rejects plan with no steps found', () => {
    const result = validatePlan('just some text with no structure', makeConfig({ format: 'markdown' }));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.parsedSteps).toBe(0);
  });

  it('rejects plan that exceeds token budget', () => {
    // maxPlanTokens=10 means ~40 chars max
    const longPlan = '- ' + 'A'.repeat(200);
    const result = validatePlan(longPlan, makeConfig({ format: 'markdown', maxPlanTokens: 10 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds token budget'))).toBe(true);
  });

  it('counts numbered-list steps correctly', () => {
    const plan = '1. First step\n2. Second step\n3. Third step';
    const result = validatePlan(plan, makeConfig({ format: 'numbered-list' }));
    expect(result.valid).toBe(true);
    expect(result.parsedSteps).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// PlanStore
// ---------------------------------------------------------------------------

describe('PlanStore', () => {
  let storeDir: string;
  let store: PlanStore;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'plan-store-'));
    store = new PlanStore(storeDir);
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  it('saves and retrieves a plan by id', () => {
    const plan = makePlan();
    store.save(plan);

    const retrieved = store.get('plan-001');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.planId).toBe('plan-001');
    expect(retrieved!.agentSlug).toBe('coder');
    expect(retrieved!.plan).toBe('- Step 1\n- Step 2');
    expect(retrieved!.createdAt).toEqual(new Date('2026-04-07T00:00:00Z'));
  });

  it('approves a plan and persists the change', () => {
    const plan = makePlan({ approved: false });
    store.save(plan);

    store.approve('plan-001');

    const retrieved = store.get('plan-001');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.approved).toBe(true);
  });
});
