import type { ContextState, EscalationState, Threat, ThreatDetectionResult } from '../entities/threat.js';

// Escalation thresholds
const PROBING_THRESHOLD = 0.3;
const ESCALATING_THRESHOLD = 0.6;    // cumulative score
const ATTACK_CONFIDENCE = 0.9;        // single-turn jump-to-attack

// Matches must clear this confidence floor to count toward cumulative escalation.
// Low-confidence matches (e.g. hypothetical/educational framing) are still
// reported in recentThreats but must not push a session toward 'attack'.
const CUMULATIVE_SCORE_CONFIDENCE_FLOOR = 0.5;

// Gradual per-turn de-escalation: after this many consecutive clean (no-threat)
// turns, decay the cumulative score and step the escalation state back down —
// on top of the existing long-idle decay, so a session doesn't get stuck at
// 'attack' for its entire lifetime after a few early false positives.
const CLEAN_TURNS_FOR_DECAY = 3;
const CLEAN_TURN_DECAY_FACTOR = 0.5;

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
  // Consecutive turns with no detected threat — drives gradual de-escalation
  // independent of the long idle-time decay above.
  private consecutiveCleanTurns = 0;

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
      // Also decay cumulative score so computeNextState doesn't immediately re-escalate
      this.state.cumulativeThreatScore = Math.max(0, this.state.cumulativeThreatScore * 0.5);
    }
    this.lastTurnAt = now;

    this.state.turnCount++;

    // Only let matches that clear a reasonable confidence floor accumulate
    // toward escalation. Low-confidence matches are still recorded in
    // recentThreats (below) but must not by themselves push a session
    // toward 'attack' — otherwise a handful of low-confidence false
    // positives permanently escalates every future turn.
    if (result.overallRisk >= CUMULATIVE_SCORE_CONFIDENCE_FLOOR) {
      this.state.cumulativeThreatScore += result.overallRisk;
    }

    // Maintain sliding window of 10
    if (!result.safe) {
      this.state.recentThreats = [
        ...this.state.recentThreats.slice(-9),
        ...result.threats,
      ].slice(-10);
    }

    // Gradual per-turn de-escalation: N consecutive clean turns decay the
    // cumulative score and step escalation back one level, so a session
    // doesn't stay stuck in 'attack'/'escalating' for its whole lifetime
    // after a burst of unrelated false positives — without waiting for the
    // full idle-timeout decay above.
    if (result.safe) {
      this.consecutiveCleanTurns++;
      if (this.consecutiveCleanTurns >= CLEAN_TURNS_FOR_DECAY) {
        this.consecutiveCleanTurns = 0;
        this.state.cumulativeThreatScore = Math.max(
          0,
          this.state.cumulativeThreatScore * CLEAN_TURN_DECAY_FACTOR
        );
        const currentIndex = ESCALATION_ORDER.indexOf(this.state.escalationState);
        if (currentIndex > 0) {
          this.state.escalationState = ESCALATION_ORDER[currentIndex - 1];
        }
      }
    } else {
      this.consecutiveCleanTurns = 0;
    }

    // Escalation state machine (monotonic upward — only computeNextState moves
    // it forward; the clean-turn decay above is the sole path back down)
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
    this.lastTurnAt = 0;
    this.consecutiveCleanTurns = 0;
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
