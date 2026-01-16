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
} from './prompt-optimizer.js';
