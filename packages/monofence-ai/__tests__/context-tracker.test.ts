import { describe, it, expect, beforeEach } from 'vitest';
import { ContextTracker } from '../src/domain/services/context-tracker.js';
import type { ThreatDetectionResult } from '../src/domain/entities/threat.js';

function makeResult(score: number, types: string[] = ['prompt_injection']): ThreatDetectionResult {
  return {
    safe: score <= 0.3,
    threats: types.map(t => ({
      id: `test-${t}-${Date.now()}`,
      type: t as any,
      confidence: score,
      pattern: 'test',
      severity: 'medium' as const,
      description: '',
      detectedAt: new Date(),
    })),
    overallRisk: score,
    detectionTimeMs: 1,
    piiFound: false,
    inputHash: 'testhash',
  };
}

describe('ContextTracker', () => {
  let tracker: ContextTracker;

  beforeEach(() => {
    tracker = new ContextTracker();
  });

  it('starts in clean escalation state', () => {
    const state = tracker.getState();
    expect(state.escalationState).toBe('clean');
    expect(state.turnCount).toBe(0);
  });

  it('transitions to probing after a low-threat turn', () => {
    tracker.recordTurn('hello world', makeResult(0.35));
    const state = tracker.getState();
    expect(state.escalationState).toBe('probing');
  });

  it('transitions to escalating after multiple medium-threat turns', () => {
    tracker.recordTurn('turn1', makeResult(0.5));
    tracker.recordTurn('turn2', makeResult(0.5));
    tracker.recordTurn('turn3', makeResult(0.5));
    const state = tracker.getState();
    expect(['escalating', 'attack']).toContain(state.escalationState);
  });

  it('jumps straight to attack on a high-confidence threat', () => {
    tracker.recordTurn('ignore all', makeResult(0.95));
    const state = tracker.getState();
    expect(state.escalationState).toBe('attack');
  });

  it('state is monotonic — never regresses', () => {
    tracker.recordTurn('high', makeResult(0.95));
    expect(tracker.getState().escalationState).toBe('attack');
    tracker.recordTurn('clean', makeResult(0.0));
    expect(tracker.getState().escalationState).toBe('attack');
  });

  it('keeps a sliding window of max 10 recent threats', () => {
    for (let i = 0; i < 15; i++) {
      tracker.recordTurn(`turn${i}`, makeResult(0.5));
    }
    expect(tracker.getState().recentThreats.length).toBeLessThanOrEqual(10);
  });

  it('cumulative threat score increases with each threat turn', () => {
    const before = tracker.getState().cumulativeThreatScore;
    tracker.recordTurn('threat', makeResult(0.6));
    const after = tracker.getState().cumulativeThreatScore;
    expect(after).toBeGreaterThan(before);
  });

  it('reset() clears all state back to clean', () => {
    tracker.recordTurn('attack', makeResult(0.95));
    tracker.reset();
    const state = tracker.getState();
    expect(state.escalationState).toBe('clean');
    expect(state.turnCount).toBe(0);
    expect(state.cumulativeThreatScore).toBe(0);
  });

  it('TTL decay steps escalation down and halves cumulative score after idle', () => {
    // Use a 1ms decay window so it fires immediately in tests
    const shortDecayTracker = new ContextTracker({ idleDecayMs: 1 });
    shortDecayTracker.recordTurn('probe', makeResult(0.95)); // → attack
    expect(shortDecayTracker.getState().escalationState).toBe('attack');

    // Wait >1ms then send a benign turn — decay fires, steps back to escalating
    return new Promise<void>(resolve => setTimeout(() => {
      shortDecayTracker.recordTurn('benign', makeResult(0.0));
      const state = shortDecayTracker.getState();
      // Should have stepped back at least one level from attack
      expect(['clean', 'probing', 'escalating']).toContain(state.escalationState);
      // Cumulative score should have been halved
      expect(state.cumulativeThreatScore).toBeLessThan(0.95);
      resolve();
    }, 10));
  });

  it('reset() also clears lastTurnAt so decay does not fire on fresh session', () => {
    const shortDecayTracker = new ContextTracker({ idleDecayMs: 1 });
    shortDecayTracker.recordTurn('attack', makeResult(0.95));
    shortDecayTracker.reset();
    // After reset, a new turn should not trigger decay (lastTurnAt = 0)
    shortDecayTracker.recordTurn('fresh', makeResult(0.95));
    expect(shortDecayTracker.getState().escalationState).toBe('attack');
    expect(shortDecayTracker.getState().turnCount).toBe(1);
  });
});
