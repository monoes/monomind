import type { WorkflowDefinition, WorkflowStep } from './dsl-schema.js';
import { substitute } from './template-engine.js';
import { evaluateCondition } from './condition-evaluator.js';

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
    const output = await this.dispatcher.dispatch(step.agent, resolvedTask, context);

    // Store output in context if output_key is set
    if (step.output_key) {
      context[step.output_key] = output;
    }
    // Always store by step id
    context[step.id] = output;

    return { stepId: step.id, output, status: 'success' };
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
    let items: unknown[];
    try {
      items = JSON.parse(resolvedItems);
      if (!Array.isArray(items)) throw new Error('not an array');
    } catch {
      throw new Error(
        `map_reduce step "${step.id}": items must resolve to a JSON array, got: ${resolvedItems}`,
      );
    }

    // Map phase: fan-out to map_agent
    const mapResults = await Promise.all(
      items.map(async (item, idx) => {
        const taskStr = substitute(step.map_task, { ...context, item });
        const output = await this.dispatcher.dispatch(step.map_agent, taskStr, {
          ...context,
          item,
        });
        return { stepId: `${step.id}.map[${idx}]`, output, status: 'success' as const };
      }),
    );

    // Store mapped outputs for reduce
    const mapOutputs = mapResults.map((r) => r.output);
    context[`${step.id}_map_results`] = mapOutputs;

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

    context[step.id] = reduceOutput;

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

    context[`${step.id}_iterations`] = iteration;
    return results;
  }
}
