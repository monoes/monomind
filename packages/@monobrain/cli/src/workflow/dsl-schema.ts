import { z } from 'zod';

// ---------- Retry policy (reuse shape from dag-types) ----------
const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).optional(),
  initialDelayMs: z.number().int().min(0).optional(),
  backoffMultiplier: z.number().min(1).optional(),
  jitterMs: z.number().int().min(0).optional(),
  retryOn: z
    .array(z.enum(['RATE_LIMIT', 'TIMEOUT', 'VALIDATION', 'UNKNOWN']))
    .optional(),
});

// ---------- Lazy wrapper for recursive step references ----------
// Use ZodTypeAny to avoid circular type reference (WorkflowStep is defined below)
const lazyStep: z.ZodTypeAny = z.lazy(() => workflowStepSchema);

// ---------- 6 step-type schemas ----------

export const agentStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('agent'),
  agent: z.string().min(1),
  task: z.string().min(1),
  context_deps: z.array(z.string()).optional(),
  output_key: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
  retry_policy: retryPolicySchema.optional(),
});

export const parallelStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('parallel'),
  steps: z.array(lazyStep).min(2),
});

export const sequenceStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('sequence'),
  steps: z.array(lazyStep).min(1),
});

export const conditionalStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('conditional'),
  condition: z.string().min(1),
  if_true: lazyStep,
  if_false: lazyStep.optional(),
});

export const mapReduceStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('map_reduce'),
  items: z.string().min(1),
  map_agent: z.string().min(1),
  map_task: z.string().min(1),
  reduce_agent: z.string().min(1),
  reduce_task: z.string().min(1),
});

export const loopStepSchema = z.object({
  id: z.string().min(1),
  type: z.literal('loop'),
  condition: z.string().min(1),
  max_iterations: z.number().int().min(1).max(100),
  body: z.array(lazyStep).min(1),
});

// ---------- Discriminated union of all step types ----------

export const workflowStepSchema = z.discriminatedUnion('type', [
  agentStepSchema,
  parallelStepSchema,
  sequenceStepSchema,
  conditionalStepSchema,
  mapReduceStepSchema,
  loopStepSchema,
]);

export type WorkflowStep = z.infer<typeof workflowStepSchema>;

// ---------- Semver regex ----------
const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

// ---------- Top-level workflow definition ----------

export const workflowDefinitionSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(semverRegex, 'version must be valid semver (e.g. 1.0.0)'),
  description: z.string().optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(workflowStepSchema).min(1),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
