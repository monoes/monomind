/**
 * Planning module — mandatory planning step before agent execution.
 * @packageDocumentation
 */

export type { PlanFormat, PlanningConfig, AgentPlan } from './types.js';
export { DEFAULT_PLANNING_CONFIG } from './types.js';
export { buildPlanningPrompt } from './planning-prompt.js';
export type { PlanValidationResult } from './plan-validator.js';
export { validatePlan } from './plan-validator.js';
export { PlanStore } from './plan-store.js';
// LATS — Language Agent Tree Search for coordinator planning (Task 48 Tier 4)
// Source: arXiv:2310.04406
export { buildLATSPlan, type LATSConfig } from './lats-planner.js';
