import { describe, it, expect } from 'vitest';
import { calculateSecurityConsensus } from '../src/index.js';
import type { AttentionContext, ThreatDetectionResult, Threat } from '../src/index.js';

function makeAssessment(
  safe: boolean,
  overallRisk: number,
  weight: number,
  severity: Threat['severity'] = 'medium'
): AttentionContext {
  const threats: Threat[] = safe
    ? []
    : [
        {
          id: `t-${Math.random()}`,
          type: 'prompt_injection',
          confidence: overallRisk,
          pattern: 'test',
          severity,
          description: 'test threat',
          detectedAt: new Date(),
        },
      ];
  return {
    weight,
    threatAssessment: {
      safe,
      threats,
      overallRisk,
      detectionTimeMs: 1,
      piiFound: false,
      inputHash: 'h',
    },
  };
}

describe('calculateSecurityConsensus', () => {
  it('returns uncertain with zero assessments', () => {
    const result = calculateSecurityConsensus([]);
    expect(result.consensus).toBe('uncertain');
    expect(result.confidence).toBe(0);
  });

  it('returns uncertain when all weights are zero', () => {
    const result = calculateSecurityConsensus([
      makeAssessment(false, 0.9, 0),
      makeAssessment(false, 0.8, 0),
    ]);
    expect(result.consensus).toBe('uncertain');
    expect(result.confidence).toBe(0);
  });

  it('returns safe when all agents assess safe', () => {
    const result = calculateSecurityConsensus([
      makeAssessment(true, 0, 1),
      makeAssessment(true, 0, 1),
    ]);
    expect(result.consensus).toBe('safe');
  });

  it('returns threat when majority (>50%) of weight assesses unsafe', () => {
    const result = calculateSecurityConsensus([
      makeAssessment(false, 0.9, 3),  // 60% of weight — unsafe
      makeAssessment(true, 0, 2),     // 40% — safe
    ]);
    expect(result.consensus).toBe('threat');
  });

  it('critical threat short-circuits to threat regardless of that agent weight', () => {
    // One low-weight agent reports critical; five high-weight agents say safe.
    // Fail-secure: critical always wins.
    const result = calculateSecurityConsensus([
      makeAssessment(false, 0.99, 1, 'critical'), // 1/6 weight, critical severity
      makeAssessment(true, 0, 5),                  // 5/6 weight, safe
    ]);
    expect(result.consensus).toBe('threat');
    expect(result.criticalThreats).toHaveLength(1);
    expect(result.confidence).toBeCloseTo(0.99);
  });

  it('non-critical threat respects weight (minority unsafe agent → uncertain/safe)', () => {
    const result = calculateSecurityConsensus([
      makeAssessment(false, 0.9, 1, 'medium'), // 1/6 weight — unsafe but not critical
      makeAssessment(true, 0, 5),               // 5/6 weight — safe
    ]);
    // threatScore = 1/6 ≈ 0.167, below 0.5 (threat) and 0.2 (safe) boundary → uncertain
    expect(['safe', 'uncertain']).toContain(result.consensus);
    expect(result.criticalThreats).toHaveLength(0);
  });

  it('returns uncertain for borderline threat score (0.2–0.5)', () => {
    const result = calculateSecurityConsensus([
      makeAssessment(false, 0.8, 1, 'medium'), // 1/3 weight ≈ 0.33 threat score
      makeAssessment(true, 0, 2),
    ]);
    expect(result.consensus).toBe('uncertain');
  });
});
