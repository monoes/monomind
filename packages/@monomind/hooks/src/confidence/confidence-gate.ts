/**
 * Confidence gate — decides whether to proceed, pause, or abort.
 * @packageDocumentation
 */

import { parseScore } from './confidence-prompt.js';
import type { ConfidenceConfig } from './types.js';

/** Action the gate recommends */
export type GateAction = 'PROCEED' | 'PAUSE' | 'ABORT';

/** Result of evaluating the confidence gate */
export interface GateResult {
  action: GateAction;
  score: number | null;
  reason: string;
}

/**
 * Evaluate raw agent output against the confidence config.
 */
export function evaluate(rawOutput: string, config: ConfidenceConfig): GateResult {
  // ALWAYS mode: always pause for human input
  if (config.mode === 'ALWAYS') {
    const score = parseScore(rawOutput);
    return { action: 'PAUSE', score, reason: 'Mode is ALWAYS — human input required.' };
  }

  // NEVER mode: never request human input
  if (config.mode === 'NEVER') {
    const score = parseScore(rawOutput);
    return { action: 'PROCEED', score, reason: 'Mode is NEVER — proceeding without human input.' };
  }

  // ON_LOW_CONFIDENCE mode
  const score = parseScore(rawOutput);

  if (score === null) {
    return {
      action: 'PROCEED',
      score: null,
      reason: 'No confidence score found in output — proceeding with warning.',
    };
  }

  if (score >= config.threshold) {
    return {
      action: 'PROCEED',
      score,
      reason: `Confidence ${score} meets threshold ${config.threshold}.`,
    };
  }

  // Score below threshold
  if (config.ciAbortOnLowConfidence) {
    return {
      action: 'ABORT',
      score,
      reason: `Confidence ${score} below threshold ${config.threshold} — aborting (CI mode).`,
    };
  }

  return {
    action: 'PAUSE',
    score,
    reason: `Confidence ${score} below threshold ${config.threshold} — requesting human input.`,
  };
}
