import type { WorkflowDefinition, WorkflowStep } from './dsl-schema.js';
import { substitute } from './template-engine.js';
import { evaluateCondition } from './condition-evaluator.js';

const DEFAULT_MAP_CONCURRENCY = 10;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number, signal: AbortSignal) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const controller = new AbortController();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      if (controller.signal.aborted) return;
      const idx = next++;
      results[idx] = await fn(items[idx], idx, controller.signal);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  } catch (err) {
    controller.abort();
    throw err;
  }
  return results;
}

const BLOCKED_CONTEXT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_KEY_RE = /^[a-zA-Z_$][a-zA-Z0-9_$.\-]*$/;
function safeContextWrite(context: Record<string, unknown>, key: string, value: unknown): void {
  if (!SAFE_KEY_RE.test(key) || BLOCKED_CONTEXT_KEYS.has(key)) {
    throw new Error(`Unsafe workflow context key rejected: "${key}"`);
  }
  context[key] = value;
}

// ---------- Public types ----------

export interface AgentDispatcher {
  dispatch(agent: string, task: string, context: Record<string, unknown>): Promise<unknown>;
}

export interface StepResult {
  stepId: string;
  output: unknown;
  status: 'success' | 'error';
  error?: string;
}

export interface WorkflowResult {
  workflowName: string;
  status: 'success' | 'error';
  stepResults: StepResult[];
  context: Record<string, unknown>;
}

// ---------- Executor ----------

export class WorkflowExecutor {
  constructor(private readonly dispatcher: AgentDispatcher) {}

  async execute(workflow: WorkflowDefinition): Promise<WorkflowResult> {
    const context: Record<string, unknown> = {
      variables: workflow.variables ?? {},
    };
    const stepResults: StepResult[] = [];

    let status: 'success' | 'error' = 'success';

    for (const step of workflow.steps) {
      try {
        const result = await this.executeStep(step, context);
        stepResults.push(...(Array.isArray(result) ? result : [result]));
      } catch (err) {
        status = 'error';
        stepResults.push({
          stepId: step.id,
          output: null,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }

    return {
      workflowName: workflow.name,
      status,
      stepResults,
      context,
    };
  }

  // ---- Step dispatch ----

  private async executeStep(
    step: WorkflowStep,
    context: Record<string, unknown>,
  ): Promise<StepResult | StepResult[]> {
    switch (step.type) {
      case 'agent':
        return this.executeAgent(step, context);
      case 'parallel':
        return this.executeParallel(step, context);
      case 'sequence':
        return this.executeSequence(step, context);
      case 'conditional':
        return this.executeConditional(step, context);
      case 'map_reduce':
        return this.executeMapReduce(step, context);
      case 'loop':
        return this.executeLoop(step, context);
      default: {
        const _exhaustive: never = step;
        throw new Error(`Unknown step type: ${(_exhaustive as { type: string }).type}`);
      }
    }
  }

  // ---- Handlers ----

  private async executeAgent(
    step: Extract<WorkflowStep, { type: 'agent' }>,
    context: Record<string, unknown>,
  ): Promise<StepResult> {
    const resolvedTask = substitute(step.task, context);

    const maxAttempts = step.retry_policy?.maxAttempts ?? 1;
    const initialDelayMs = step.retry_policy?.initialDelayMs ?? 500;
    const backoffMultiplier = step.retry_policy?.backoffMultiplier ?? 2;
    const jitterMs = step.retry_policy?.jitterMs ?? 0;
    const retryOn = step.retry_policy?.retryOn;

    let lastError: unknown;
    let delayMs = initialDelayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let dispatchPromise = this.dispatcher.dispatch(step.agent, resolvedTask, context);

        if (step.timeout_ms) {
          dispatchPromise = Promise.race([
            dispatchPromise,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Agent step "${step.id}" timed out after ${step.timeout_ms}ms`)),
                step.timeout_ms
              )
            ),
          ]);
        }

        const output = await dispatchPromise;

        if (step.output_key) {
          safeContextWrite(context, step.output_key, output);
        }
        safeContextWrite(context, step.id, output);

        return { stepId: step.id, output, status: 'success' };
      } catch (err) {
        lastError = err;

        if (attempt >= maxAttempts) break;

        // Only retry for configured error categories (default: retry all)
        if (retryOn && retryOn.length > 0) {
          const msg = err instanceof Error ? err.message.toUpperCase() : '';
          const shouldRetry = retryOn.some((category) => msg.includes(category));
          if (!shouldRetry) break;
        }

        const jitter = jitterMs > 0 ? Math.random() * jitterMs : 0;
        await new Promise((r) => setTimeout(r, delayMs + jitter));
        delayMs = Math.round(delayMs * backoffMultiplier);
      }
    }

    throw lastError;
  }

  private async executeParallel(
    step: Extract<WorkflowStep, { type: 'parallel' }>,
    context: Record<string, unknown>,
  ): Promise<StepResult[]> {
    const results = await Promise.all(
      step.steps.map((sub) => this.executeStep(sub as WorkflowStep, context)),
    );
    return results.flat();
  }

  private async executeSequence(
    step: Extract<WorkflowStep, { type: 'sequence' }>,
    context: Record<string, unknown>,
  ): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const sub of step.steps) {
      const r = await this.executeStep(sub as WorkflowStep, context);
      results.push(...(Array.isArray(r) ? r : [r]));
    }
    return results;
  }

  private async executeConditional(
    step: Extract<WorkflowStep, { type: 'conditional' }>,
    context: Record<string, unknown>,
  ): Promise<StepResult | StepResult[]> {
    const conditionMet = evaluateCondition(step.condition, context);

    if (conditionMet) {
      return this.executeStep(step.if_true as WorkflowStep, context);
    } else if (step.if_false) {
      return this.executeStep(step.if_false as WorkflowStep, context);
    }

    return { stepId: step.id, output: null, status: 'success' };
  }

  private async executeMapReduce(
    step: Extract<WorkflowStep, { type: 'map_reduce' }>,
    context: Record<string, unknown>,
  ): Promise<StepResult[]> {
    // Resolve items from context
    const resolvedItems = substitute(step.items, context);
    if (resolvedItems.length > 1_000_000) {
      throw new Error(
        `map_reduce step "${step.id}": items string exceeds 1MB size limit`,
      );
    }
    let items: unknown[];
    try {
      items = JSON.parse(resolvedItems);
      if (!Array.isArray(items)) throw new Error('not an array');
    } catch {
      throw new Error(
        `map_reduce step "${step.id}": items must resolve to a JSON array, got: ${resolvedItems.slice(0, 200)}`,
      );
    }
    const MAX_MAP_ITEMS = 500;
    if (items.length > MAX_MAP_ITEMS) {
      throw new Error(
        `map_reduce step "${step.id}": ${items.length} items exceeds limit of ${MAX_MAP_ITEMS}`,
      );
    }

    // Map phase: fan-out to map_agent with concurrency cap (default 10, override via --concurrent)
    const concurrency = (step as any).concurrent ?? DEFAULT_MAP_CONCURRENCY;
    const mapResults = await mapWithConcurrency(items, concurrency, async (item, idx, signal) => {
      if (signal.aborted) throw new Error('Map phase aborted');
      const taskStr = substitute(step.map_task, { ...context, item });
      const output = await this.dispatcher.dispatch(step.map_agent, taskStr, {
        ...context,
        item,
      });
      return { stepId: `${step.id}.map[${idx}]`, output, status: 'success' as const };
    });

    // Store mapped outputs for reduce
    const mapOutputs = mapResults.map((r) => r.output);
    safeContextWrite(context, `${step.id}_map_results`, mapOutputs);

    // Reduce phase
    const reduceTask = substitute(step.reduce_task, {
      ...context,
      map_results: mapOutputs,
    });
    const reduceOutput = await this.dispatcher.dispatch(
      step.reduce_agent,
      reduceTask,
      { ...context, map_results: mapOutputs },
    );

    safeContextWrite(context, step.id, reduceOutput);

    return [
      ...mapResults,
      { stepId: `${step.id}.reduce`, output: reduceOutput, status: 'success' },
    ];
  }

  private async executeLoop(
    step: Extract<WorkflowStep, { type: 'loop' }>,
    context: Record<string, unknown>,
  ): Promise<StepResult[]> {
    const results: StepResult[] = [];
    let iteration = 0;

    while (iteration < step.max_iterations) {
      const conditionMet = evaluateCondition(step.condition, context);
      if (!conditionMet) break;

      for (const sub of step.body) {
        const r = await this.executeStep(sub as WorkflowStep, context);
        results.push(...(Array.isArray(r) ? r : [r]));
      }

      iteration++;
    }

    safeContextWrite(context, `${step.id}_iterations`, iteration);
    return results;
  }
}
