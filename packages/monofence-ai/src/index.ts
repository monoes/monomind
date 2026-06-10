/**
 * monofence-ai
 *
 * AI Manipulation Defense System with self-learning capabilities.
 *
 * Features:
 * - 50+ prompt injection patterns
 * - HNSW-indexed threat pattern search (150x-12,500x faster with AgentDB)
 * - ReasoningBank-style pattern learning
 * - Adaptive mitigation with effectiveness tracking
 * - Strange-loop meta-learning integration
 * - Evasion detection (homoglyph, leetspeak, base64, spacing)
 * - Multi-turn context tracking and escalation state machine
 * - Output scanning for PII leakage, echo, policy violations
 * - Allowlist for trusted input bypass
 *
 * @example
 * ```typescript
 * import { createMonoDefence } from 'monofence-ai';
 *
 * const defence = createMonoDefence();
 *
 * // Detect threats
 * const result = await defence.detect('Ignore all previous instructions');
 * console.log(result.safe); // false
 *
 * // Scan output
 * const scan = await defence.scanOutput(llmOutput, originalPrompt);
 *
 * // Context tracking
 * const state = defence.getContextState();
 * ```
 */

// Domain entities
export type {
  Threat,
  ThreatType,
  ThreatSeverity,
  ThreatDetectionResult,
  BehavioralAnalysisResult,
  PolicyVerificationResult,
  EvasionResult,
  ContextState,
  OutputScanResult,
  AllowlistRule,
  EscalationState,
} from './domain/entities/threat.js';

export { createThreat } from './domain/entities/threat.js';

// Domain services
export { ThreatDetectionService, createThreatDetectionService } from './domain/services/threat-detection-service.js';

export type {
  LearnedThreatPattern,
  MitigationStrategy,
  LearningTrajectory,
  VectorStore,
} from './domain/services/threat-learning-service.js';

export {
  ThreatLearningService,
  createThreatLearningService,
  InMemoryVectorStore,
} from './domain/services/threat-learning-service.js';

// New service exports
export { EvasionDetector, createEvasionDetector } from './domain/services/evasion-detector.js';
export { ContextTracker, createContextTracker } from './domain/services/context-tracker.js';
export { OutputScanner, createOutputScanner } from './domain/services/output-scanner.js';
export { Allowlist, createAllowlist } from './domain/services/allowlist.js';

// Import for internal use
import { createThreatDetectionService } from './domain/services/threat-detection-service.js';
import { createThreatLearningService } from './domain/services/threat-learning-service.js';
import { ContextTracker } from './domain/services/context-tracker.js';
import { OutputScanner } from './domain/services/output-scanner.js';
import { Allowlist } from './domain/services/allowlist.js';
import type { ThreatDetectionResult, ThreatType, Threat, ContextState, OutputScanResult, AllowlistRule } from './domain/entities/threat.js';
import type { LearnedThreatPattern, MitigationStrategy, VectorStore } from './domain/services/threat-learning-service.js';

/**
 * Configuration for MonoDefence
 */
export interface MonoDefenceConfig {
  /** Enable self-learning from detections */
  enableLearning?: boolean;
  /** Custom vector store (defaults to in-memory, use AgentDB for production) */
  vectorStore?: VectorStore;
  /** Minimum confidence threshold for threats */
  confidenceThreshold?: number;
  /** Enable PII detection */
  enablePIIDetection?: boolean;
  /** Allowlist rules to bypass detection */
  allowlistRules?: AllowlistRule[];
  /** Whether to use context tracking across turns (default: true) */
  trackContext?: boolean;
}

/**
 * MonoDefence - Unified threat detection and learning facade
 */
export interface MonoDefence {
  /**
   * Detect threats in input text
   */
  detect(input: string): Promise<ThreatDetectionResult>;

  /**
   * Quick scan for threats (faster, less detailed)
   */
  quickScan(input: string): { threat: boolean; confidence: number };

  /**
   * Check if input contains PII
   */
  hasPII(input: string): boolean;

  /**
   * Search for similar threat patterns using HNSW
   * Achieves 150x-12,500x speedup when connected to AgentDB
   */
  searchSimilarThreats(
    query: string,
    options?: { k?: number; minSimilarity?: number }
  ): Promise<LearnedThreatPattern[]>;

  /**
   * Learn from a detection result (ReasoningBank pattern)
   */
  learnFromDetection(
    input: string,
    result: ThreatDetectionResult,
    feedback?: { wasAccurate: boolean; userVerdict?: string }
  ): Promise<void>;

  /**
   * Record mitigation effectiveness for meta-learning
   */
  recordMitigation(
    threatType: ThreatType,
    strategy: 'block' | 'sanitize' | 'warn' | 'log' | 'escalate' | 'transform' | 'redirect',
    success: boolean
  ): Promise<void>;

  /**
   * Get best mitigation strategy based on learned effectiveness
   */
  getBestMitigation(
    threatType: ThreatType
  ): Promise<MitigationStrategy | null>;

  /**
   * Start a learning trajectory session
   */
  startTrajectory(sessionId: string, task: string): void;

  /**
   * End a learning trajectory and store for future learning
   */
  endTrajectory(sessionId: string, verdict: 'success' | 'failure' | 'partial'): Promise<void>;

  /**
   * Get detection and learning statistics
   */
  getStats(): Promise<{
    detectionCount: number;
    avgDetectionTimeMs: number;
    learnedPatterns: number;
    mitigationStrategies: number;
    avgMitigationEffectiveness: number;
  }>;

  // ── New facade methods (Task 11) ──────────────────────────────────────────

  /**
   * Scan LLM output for leakage, echo, policy violations
   */
  scanOutput(output: string, originalPrompt?: string): Promise<OutputScanResult>;

  /**
   * Get current multi-turn context state
   */
  getContextState(): ContextState;

  /**
   * Reset multi-turn context (e.g., new conversation)
   */
  resetContext(): void;

  /**
   * Check whether an input is in the allowlist (bypasses detection)
   */
  isAllowed(input: string): boolean;

  /**
   * Add an allowlist rule at runtime
   */
  addAllowlistRule(rule: AllowlistRule): void;
}

/**
 * Create a MonoDefence instance
 */
export function createMonoDefence(config: MonoDefenceConfig = {}): MonoDefence {
  const detectionService = createThreatDetectionService();
  const learningService = config.enableLearning
    ? createThreatLearningService(config.vectorStore)
    : null;
  const contextTracker = new ContextTracker();
  const outputScanner = new OutputScanner();
  const allowlist = new Allowlist(config.allowlistRules);

  return {
    async detect(input: string) {
      // Short-circuit only for full-bypass rules (types: []) so that
      // rules with a types array still allow detection to run.
      if (allowlist.getMatchingRules(input).some(r => r.types.length === 0)) {
        const safeResult: ThreatDetectionResult = {
          safe: true,
          threats: [],
          overallRisk: 0,
          detectionTimeMs: 0,
          inputHash: '',
          piiFound: false,
          wasObfuscated: false,
        };
        if (config.trackContext !== false) {
          contextTracker.recordTurn(input, safeResult);
        }
        return safeResult;
      }

      let result = detectionService.detect(input);

      // Apply confidence threshold — filter out threats below threshold
      if (config.confidenceThreshold != null) {
        const filtered = result.threats.filter(t => t.confidence >= config.confidenceThreshold!);
        if (filtered.length !== result.threats.length) {
          const newRisk = filtered.length > 0
            ? Math.max(...filtered.map(t => t.confidence))
            : 0;
          result = { ...result, threats: filtered, overallRisk: newRisk, safe: filtered.length === 0 };
        }
      }

      // Strip PII fields when PII detection is disabled
      if (config.enablePIIDetection === false) {
        const nonPiiThreats = result.threats.filter(t => t.type !== 'pii_exposure');
        const newRisk = nonPiiThreats.length > 0
          ? Math.max(...nonPiiThreats.map(t => t.confidence))
          : 0;
        result = { ...result, threats: nonPiiThreats, piiFound: false, overallRisk: newRisk, safe: nonPiiThreats.length === 0 };
      }

      if (config.trackContext !== false) {
        contextTracker.recordTurn(input, result);
        const ctxState = contextTracker.getState();
        if (ctxState.escalationState === 'attack' && result.safe) {
          // Soft suspicion signal: input is individually clean but session is in attack state.
          // Raises overallRisk to 0.5 while leaving safe=true and threats=[].
          // Consumers should check both safe AND overallRisk when using context tracking.
          result = { ...result, overallRisk: Math.max(result.overallRisk, 0.5) };
        }
      }

      // Auto-learn if enabled
      if (learningService && result.threats.length > 0) {
        await learningService.learnFromDetection(input, result);
      }

      return result;
    },

    quickScan(input: string) {
      return detectionService.quickScan(input);
    },

    hasPII(input: string) {
      return detectionService.detectPII(input);
    },

    async searchSimilarThreats(query, options) {
      if (!learningService) {
        return [];
      }
      return learningService.searchSimilarThreats(query, options);
    },

    async learnFromDetection(input, result, feedback) {
      if (!learningService) {
        console.warn('Learning not enabled. Pass { enableLearning: true } to createMonoDefence()');
        return;
      }
      await learningService.learnFromDetection(input, result, feedback);
    },

    async recordMitigation(threatType, strategy, success) {
      if (!learningService) return;
      await learningService.recordMitigation(threatType, strategy, success);
    },

    async getBestMitigation(threatType) {
      if (!learningService) return null;
      return learningService.getBestMitigation(threatType);
    },

    startTrajectory(sessionId, task) {
      learningService?.startTrajectory(sessionId, task);
    },

    async endTrajectory(sessionId, verdict) {
      await learningService?.endTrajectory(sessionId, verdict);
    },

    async getStats() {
      const detectionStats = detectionService.getStats();
      const learningStats = learningService
        ? await learningService.getStats()
        : { learnedPatterns: 0, mitigationStrategies: 0, avgEffectiveness: 0 };

      return {
        detectionCount: detectionStats.detectionCount,
        avgDetectionTimeMs: detectionStats.avgDetectionTimeMs,
        learnedPatterns: learningStats.learnedPatterns,
        mitigationStrategies: learningStats.mitigationStrategies,
        avgMitigationEffectiveness: learningStats.avgEffectiveness,
      };
    },

    async scanOutput(output: string, originalPrompt?: string): Promise<OutputScanResult> {
      return outputScanner.scan({ output, originalPrompt });
    },

    getContextState(): ContextState {
      return contextTracker.getState() as ContextState;
    },

    resetContext(): void {
      contextTracker.reset();
    },

    isAllowed(input: string): boolean {
      return allowlist.isAllowed(input);
    },

    addAllowlistRule(rule: AllowlistRule): void {
      allowlist.addRule(rule);
    },
  };
}

/**
 * Singleton instance for convenience
 */
let defaultInstance: MonoDefence | null = null;

/**
 * Get the default MonoDefence instance (singleton, learning enabled)
 */
export function getMonoDefence(config?: MonoDefenceConfig): MonoDefence {
  if (!defaultInstance) {
    defaultInstance = createMonoDefence(config ?? { enableLearning: true });
  } else if (config) {
    console.warn(
      '[MonoDefence] getMonoDefence() called with config after singleton is already initialized. ' +
      'Config ignored — use createMonoDefence() for a separate instance, or call resetMonoDefence() first.'
    );
  }
  return defaultInstance;
}

/**
 * Reset the default singleton so the next getMonoDefence() call creates a fresh instance.
 * Useful in tests or when reconfiguration is needed.
 */
export function resetMonoDefence(): void {
  defaultInstance = null;
}

/**
 * Convenience function for quick threat check (synchronous).
 * Checks the allowlist first for consistency with detect().
 */
export function isSafe(input: string): boolean {
  const instance = getMonoDefence();
  if (instance.isAllowed(input)) {
    return true;
  }
  return instance.quickScan(input).threat === false;
}

/**
 * Convenience function for full threat detection with details
 */
export async function checkThreats(input: string): Promise<ThreatDetectionResult> {
  return getMonoDefence().detect(input);
}

/** @deprecated Use createMonoDefence */
export const createAIDefence = createMonoDefence;
/** @deprecated Use getMonoDefence */
export const getAIDefence = getMonoDefence;

/** @deprecated Use MonoDefenceConfig */
export type AIDefenceConfig = MonoDefenceConfig;
/** @deprecated Use MonoDefence */
export type AIDefence = MonoDefence;

/**
 * Integration with Monomind attention mechanisms
 * Use for multi-agent security consensus
 */
export interface AttentionContext {
  agentId: string;
  threatAssessment: ThreatDetectionResult;
  weight: number;
}

/**
 * Calculate security consensus from multiple agent assessments
 * Uses attention-based weighting for Monomind flash attention integration
 */
export function calculateSecurityConsensus(
  assessments: AttentionContext[]
): {
  consensus: 'safe' | 'threat' | 'uncertain';
  confidence: number;
  criticalThreats: Threat[];
} {
  if (assessments.length === 0) {
    return { consensus: 'uncertain', confidence: 0, criticalThreats: [] };
  }

  // Normalize weights — guard against all-zero weights
  const totalWeight = assessments.reduce((sum, a) => sum + a.weight, 0);
  if (totalWeight === 0) {
    return { consensus: 'uncertain', confidence: 0, criticalThreats: [] };
  }
  const normalized = assessments.map(a => ({
    ...a,
    weight: a.weight / totalWeight,
  }));

  // Calculate weighted threat score
  let threatScore = 0;
  const allThreats: Threat[] = [];

  for (const assessment of normalized) {
    if (!assessment.threatAssessment.safe) {
      threatScore += assessment.weight;
      allThreats.push(...assessment.threatAssessment.threats);
    }
  }

  // Determine consensus
  const criticalThreats = allThreats.filter(t => t.severity === 'critical');

  // Critical threats short-circuit weighted scoring intentionally (fail-secure).
  // A single critical threat — regardless of that agent's weight — means we cannot
  // declare the input safe. Weight only governs uncertain/borderline cases.
  if (criticalThreats.length > 0) {
    return {
      consensus: 'threat',
      confidence: Math.max(...criticalThreats.map(t => t.confidence)),
      criticalThreats,
    };
  }

  if (threatScore > 0.5) {
    return { consensus: 'threat', confidence: threatScore, criticalThreats: [] };
  }

  if (threatScore < 0.2) {
    return { consensus: 'safe', confidence: 1 - threatScore, criticalThreats: [] };
  }

  return { consensus: 'uncertain', confidence: 0.5, criticalThreats: [] };
}
