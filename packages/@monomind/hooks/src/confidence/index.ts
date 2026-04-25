/**
 * Confidence-gated human input module.
 * @packageDocumentation
 */

export type {
  HumanInputMode,
  ConfidenceConfig,
  InputRequest,
  InputRequestStatus,
} from './types.js';
export { DEFAULT_CONFIDENCE_CONFIG } from './types.js';

export { inject as injectConfidencePrompt, parseScore } from './confidence-prompt.js';

export type { GateAction, GateResult } from './confidence-gate.js';
export { evaluate as evaluateConfidenceGate } from './confidence-gate.js';

export { InputRequestStore } from './input-request-store.js';
