/**
 * Optimization module - Few-Shot Prompt Optimization
 *
 * @module @monobrain/hooks/optimization
 */

export {
  type QualityMetric,
  LengthBasedMetric,
  JSONValidityMetric,
  LLMJudgeMetric,
  // Agent-as-a-Judge (arXiv:2410.10934)
  TraceAwareJudgeMetric,
  type TraceStep,
} from './quality-metric.js';

export {
  BootstrapFewShot,
  type TraceRecord,
  type FewShotExample,
  type BootstrapFewShotConfig,
} from './bootstrap-fewshot.js';

export {
  TraceQualityStore,
} from './trace-quality-store.js';

export {
  PromptOptimizer,
  type OptimizationResult,
  type OptimizeOptions,
  // GEPA multi-prompt co-evolution (source: https://arxiv.org/abs/2507.19457)
  GEPAOptimizer,
  type GEPAConfig,
  type GEPACandidate,
  type GEPAResult,
} from './prompt-optimizer.js';

// EvoAgentX Coordinator — GEPA + SubGraphRegistry + memory orchestration (Tier 4)
export {
  EvoAgentXCoordinator,
  type EvoAgentXConfig,
  type EvoAgentXResult,
} from './evoagentx-coordinator.js';
