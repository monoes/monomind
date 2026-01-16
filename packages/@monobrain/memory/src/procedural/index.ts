/**
 * Procedural Memory — Learn from Successful Executions
 *
 * Barrel export for Task 45.
 *
 * @module @monobrain/memory/procedural
 */

export type {
  ActionOutcome,
  ActionRecord,
  ExtractionConfig,
  SkillTrigger,
  LearnedSkill,
  ActionSequenceGroup,
} from './types.js';

export { DEFAULT_EXTRACTION_CONFIG } from './types.js';

export { ActionRecordStore } from './action-record.js';
export { ActionSequenceExtractor } from './action-sequence-extractor.js';
export { LearnedSkillSerializer } from './learned-skill.js';
export { SkillRegistry } from './skill-registry.js';
