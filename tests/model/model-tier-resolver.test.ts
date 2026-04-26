import { describe, it, expect } from 'vitest';

import { scoreComplexity } from '../../packages/@monomind/cli/src/model/complexity-scorer.js';
import { resolveModelTier } from '../../packages/@monomind/cli/src/model/model-tier-resolver.js';
import { TIER_DEFAULTS } from '../../packages/@monomind/cli/src/model/model-settings.js';

describe('scoreComplexity', () => {
  it('scores simple formatting task below 30', () => {
    const score = scoreComplexity('format the file');
    expect(score).toBeLessThan(30);
  });

  it('scores architecture task above 70', () => {
    const score = scoreComplexity(
      'Design the distributed architecture for the new microservices platform with fault-tolerant consensus across multiple regions and database schema migration strategy. Step 1: define the service boundaries and communication patterns. Step 2: implement the event sourcing layer with CQRS for each bounded context. Step 3: set up the deployment pipeline with blue-green rollouts and canary releases. This requires careful consideration of network partitions, data replication lag, and eventual consistency guarantees across all participating nodes in the cluster.',
    );
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it('gives +20 bonus to high-complexity agent slugs', () => {
    const base = scoreComplexity('do some work');
    const boosted = scoreComplexity('do some work', 'security-architect');
    expect(boosted - base).toBe(20);
  });
});

describe('resolveModelTier', () => {
  it('selects haiku for a simple task', () => {
    const result = resolveModelTier('coder', 'fix typo');
    expect(result.model).toBe('haiku');
    expect(result.resolutionReason).toBe('low_complexity');
  });

  it('selects opus for a complex task', () => {
    const result = resolveModelTier(
      'coder',
      'Design the distributed architecture for the new microservices platform with fault-tolerant consensus across multiple regions and database schema migration strategy. Step 1: define the service boundaries and communication patterns. Step 2: implement the event sourcing layer with CQRS for each bounded context. Step 3: set up the deployment pipeline with blue-green rollouts and canary releases. This requires careful consideration of network partitions, data replication lag, and eventual consistency guarantees across all participating nodes in the cluster.',
    );
    expect(result.model).toBe('opus');
  });

  it('applies orchestrator override regardless of complexity', () => {
    const result = resolveModelTier('coder', 'fix typo', undefined, {
      model: 'opus',
    });
    expect(result.model).toBe('opus');
    expect(result.resolutionReason).toBe('orchestrator_override');
  });

  it('respects agent preference default for medium tasks', () => {
    // A medium-length task that should land in the default range
    const result = resolveModelTier(
      'coder',
      'Implement the user profile page with avatar upload and a settings section for notifications',
      { default: 'sonnet' },
    );
    expect(result.model).toBe('sonnet');
    expect(result.resolutionReason).toBe('default_preference');
  });

  it('never selects haiku for high-complexity agents', () => {
    const result = resolveModelTier('security-architect', 'check this');
    // security-architect is in HIGH_COMPLEXITY_AGENTS → forces opus
    expect(result.model).toBe('opus');
    expect(result.model).not.toBe('haiku');
  });

  it('propagates maxCostUsd from preference', () => {
    const result = resolveModelTier('coder', 'fix typo', {
      default: 'haiku',
      maxCostUsd: 0.05,
    });
    expect(result.maxCostUsd).toBe(0.05);
  });

  it('defaults to sonnet for medium-complexity tasks without preference', () => {
    const result = resolveModelTier(
      'coder',
      'Implement the user profile page with avatar upload and a settings section for notifications',
    );
    expect(result.model).toBe('sonnet');
  });

  it('includes complexityScore in resolved settings', () => {
    const result = resolveModelTier('coder', 'fix typo');
    expect(typeof result.complexityScore).toBe('number');
    expect(result.complexityScore).toBeGreaterThanOrEqual(0);
    expect(result.complexityScore).toBeLessThanOrEqual(100);
  });

  it('uses tier defaults for maxTokens and temperature', () => {
    const result = resolveModelTier('coder', 'fix typo');
    expect(result.model).toBe('haiku');
    expect(result.maxTokens).toBe(TIER_DEFAULTS.haiku.maxTokens);
    expect(result.temperature).toBe(TIER_DEFAULTS.haiku.temperature);
  });

  it('propagates extendedThinking from preference', () => {
    const result = resolveModelTier('coder', 'fix typo', {
      default: 'haiku',
      extendedThinking: true,
    });
    expect(result.extendedThinking).toBe(true);
  });
});
