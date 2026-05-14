/**
 * Score Decay (Task 39)
 *
 * Time-based decay for agent specialization scores.
 * Scores from 90 days ago have 50% weight (half-life model).
 */
/** Half-life in days: after this many days, score weight is halved. */
export declare const SCORE_HALF_LIFE_DAYS = 90;
/**
 * Calculate the decay factor for a score based on how old it is.
 *
 * decay(t) = 0.5^(days_since_update / 90)
 *
 * - Returns 1.0 for scores updated right now
 * - Returns ~0.5 for scores updated 90 days ago
 * - Returns ~0.25 for scores updated 180 days ago
 */
export declare function calculateDecayFactor(lastUpdatedIso: string): number;
//# sourceMappingURL=score-decay.d.ts.map