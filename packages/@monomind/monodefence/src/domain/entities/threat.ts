/**
 * Threat Domain Entity
 *
 * Represents a detected security threat from AI manipulation attempts.
 */

export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ThreatType =
  | 'prompt_injection'
  | 'jailbreak'
  | 'pii_exposure'
  | 'instruction_override'
  | 'role_switching'
  | 'context_manipulation'
  | 'encoding_attack'
  | 'unknown';

export interface Threat {
  readonly id: string;
  readonly type: ThreatType;
  readonly severity: ThreatSeverity;
  readonly confidence: number;
  readonly pattern: string;
  readonly description: string;
  readonly location?: {
    start: number;
    end: number;
  };
  readonly detectedAt: Date;
}

export interface ThreatDetectionResult {
  readonly safe: boolean;
  readonly threats: Threat[];
  readonly detectionTimeMs: number;
  readonly piiFound: boolean;
  readonly inputHash: string;
  readonly wasObfuscated?: boolean;
  /** Aggregate risk score [0, 1] derived from highest-confidence threat; boosted when obfuscation detected */
  readonly overallRisk: number;
}

export interface BehavioralAnalysisResult {
  readonly agentId: string;
  readonly anomalyScore: number;
  readonly attractorType: 'point' | 'cycle' | 'torus' | 'strange';
  readonly lyapunovExponent: number;
  readonly analysisTimeMs: number;
  readonly windowSize: string;
  readonly actionCount: number;
}

export interface PolicyVerificationResult {
  readonly agentId: string;
  readonly policy: string;
  readonly valid: boolean;
  readonly violations: string[];
  readonly proofStatus: 'valid' | 'invalid' | 'timeout';
  readonly verificationTimeMs: number;
}

export type EscalationState = 'clean' | 'probing' | 'escalating' | 'attack';

export interface EvasionResult {
  readonly normalizedInput: string;
  readonly wasObfuscated: boolean;
  readonly techniqueDetected?: 'homoglyph' | 'leetspeak' | 'spacing' | 'base64' | 'zero_width';
}

export interface ContextState {
  readonly escalationState: EscalationState;
  readonly cumulativeThreatScore: number;
  readonly turnCount: number;
  readonly recentThreats: Threat[];
}

export interface OutputScanResult {
  readonly safe: boolean;
  readonly leakageFound: boolean;
  readonly leakageTypes: string[];
  readonly echoDetected: boolean;
  readonly policyViolation: boolean;
  readonly contradictionSignal: boolean;
  readonly scanTimeMs: number;
}

export interface AllowlistRule {
  readonly id: string;
  readonly pattern: RegExp | string;
  /**
   * Threat types this rule applies to.
   * - Empty array `[]`: full bypass — matching inputs skip detection entirely.
   * - Non-empty array: reserved for future per-type suppression.
   *   Currently treated the same as empty (full bypass). Do not rely on
   *   selective suppression behavior until a future release implements it.
   */
  readonly types: ThreatType[];
  readonly context?: string;
  readonly reason: string;
  readonly source: 'builtin' | 'user';
}

/**
 * Factory function to create a Threat entity
 */
export function createThreat(params: {
  type: ThreatType;
  severity: ThreatSeverity;
  confidence: number;
  pattern: string;
  description: string;
  location?: { start: number; end: number };
}): Threat {
  return {
    id: `threat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: params.type,
    severity: params.severity,
    confidence: params.confidence,
    pattern: params.pattern,
    description: params.description,
    location: params.location,
    detectedAt: new Date(),
  };
}
