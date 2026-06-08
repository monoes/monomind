import type { ContextState, EscalationState, Threat, ThreatDetectionResult } from '../entities/threat.js';

// Escalation thresholds
const PROBING_THRESHOLD = 0.3;
const ESCALATING_THRESHOLD = 0.6;    // cumulative score
const ATTACK_CONFIDENCE = 0.9;        // single-turn jump-to-attack

const ESCALATION_ORDER: EscalationState[] = ['clean', 'probing', 'escalating', 'attack'];

// Mutable internal state (ContextState uses readonly fields)
interface MutableContextState {
  escalationState: EscalationState;
  cumulativeThreatScore: number;
  turnCount: number;
  recentThreats: Threat[];
}

export class ContextTracker {
  private state: MutableContextState = {
    escalationState: 'clean',
    cumulativeThreatScore: 0,
    turnCount: 0,
    recentThreats: [],
  };

  private lastTurnAt: number = 0;
  private readonly idleDecayMs: number;

  constructor(opts: { idleDecayMs?: number } = {}) {
    this.idleDecayMs = opts.idleDecayMs ?? 30 * 60 * 1000; // 30 min default
  }

  recordTurn(input: string, result: ThreatDetectionResult): void {
    const now = Date.now();
    // Decay escalation state if session has been idle
    if (this.lastTurnAt > 0 && now - this.lastTurnAt > this.idleDecayMs) {
      const currentIndex = ESCALATION_ORDER.indexOf(this.state.escalationState);
      if (currentIndex > 0) {
        this.state.escalationState = ESCALATION_ORDER[currentIndex - 1];
      }
    }
    this.lastTurnAt = now;

    this.state.turnCount++;

    // Update cumulative score
    this.state.cumulativeThreatScore += result.overallRisk;

    // Maintain sliding window of 10
    if (!result.safe) {
      this.state.recentThreats = [
        ...this.state.recentThreats.slice(-9),
        ...result.threats,
      ].slice(-10);
    }

    // Escalation state machine (monotonic — only moves forward)
    this.state.escalationState = this.computeNextState(result);
  }

  getState(): Readonly<ContextState> {
    return { ...this.state, recentThreats: [...this.state.recentThreats] };
  }

  reset(): void {
    this.state = {
      escalationState: 'clean',
      cumulativeThreatScore: 0,
      turnCount: 0,
      recentThreats: [],
    };
  }

  private computeNextState(result: ThreatDetectionResult): EscalationState {
    const current: EscalationState = this.state.escalationState;
    const currentIndex = ESCALATION_ORDER.indexOf(current);

    let targetIndex = currentIndex; // monotonic: never go back

    // Jump to attack on high single-turn confidence
    if (result.overallRisk >= ATTACK_CONFIDENCE) {
      targetIndex = ESCALATION_ORDER.indexOf('attack');
    } else if (this.state.cumulativeThreatScore >= ESCALATING_THRESHOLD) {
      targetIndex = Math.max(targetIndex, ESCALATION_ORDER.indexOf('escalating'));
    } else if (result.overallRisk >= PROBING_THRESHOLD) {
      targetIndex = Math.max(targetIndex, ESCALATION_ORDER.indexOf('probing'));
    }

    return ESCALATION_ORDER[targetIndex];
  }
}

export function createContextTracker(): ContextTracker {
  return new ContextTracker();
}
