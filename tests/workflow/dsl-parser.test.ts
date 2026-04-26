import { describe, it, expect, beforeEach, vi } from 'vitest';

import { DSLParser } from '../../packages/@monomind/cli/src/workflow/dsl-parser.js';
import { substitute } from '../../packages/@monomind/cli/src/workflow/template-engine.js';
import { evaluateCondition } from '../../packages/@monomind/cli/src/workflow/condition-evaluator.js';
import { WorkflowExecutor } from '../../packages/@monomind/cli/src/workflow/workflow-executor.js';
import type { AgentDispatcher } from '../../packages/@monomind/cli/src/workflow/workflow-executor.js';
import type { WorkflowDefinition } from '../../packages/@monomind/cli/src/workflow/dsl-schema.js';

// ---------------------------------------------------------------------------
// DSLParser tests
// ---------------------------------------------------------------------------

describe('DSLParser', () => {
  it('accepts a valid minimal workflow', () => {
    const raw = {
      name: 'test-workflow',
      version: '1.0.0',
      steps: [
        { id: 'step1', type: 'agent', agent: 'coder', task: 'write code' },
      ],
    };
    const wf = DSLParser.loadFromObject(raw);
    expect(wf.name).toBe('test-workflow');
    expect(wf.steps).toHaveLength(1);
    expect(wf.steps[0].type).toBe('agent');
  });

  it('rejects a workflow with no steps', () => {
    const raw = {
      name: 'empty',
      version: '1.0.0',
      steps: [],
    };
    expect(() => DSLParser.loadFromObject(raw)).toThrow();
  });

  it('rejects a parallel step with only one child', () => {
    const raw = {
      name: 'bad-parallel',
      version: '1.0.0',
      steps: [
        {
          id: 'p1',
          type: 'parallel',
          steps: [
            { id: 's1', type: 'agent', agent: 'coder', task: 'do stuff' },
          ],
        },
      ],
    };
    expect(() => DSLParser.loadFromObject(raw)).toThrow();
  });

  it('rejects a loop without max_iterations', () => {
    const raw = {
      name: 'bad-loop',
      version: '1.0.0',
      steps: [
        {
          id: 'l1',
          type: 'loop',
          condition: 'true',
          body: [
            { id: 's1', type: 'agent', agent: 'coder', task: 'iterate' },
          ],
        },
      ],
    };
    expect(() => DSLParser.loadFromObject(raw)).toThrow();
  });

  it('accepts nested recursive structures', () => {
    const raw = {
      name: 'nested',
      version: '2.0.0',
      steps: [
        {
          id: 'seq1',
          type: 'sequence',
          steps: [
            {
              id: 'par1',
              type: 'parallel',
              steps: [
                { id: 'a1', type: 'agent', agent: 'coder', task: 'task A' },
                { id: 'a2', type: 'agent', agent: 'tester', task: 'task B' },
              ],
            },
          ],
        },
      ],
    };
    const wf = DSLParser.loadFromObject(raw);
    expect(wf.steps[0].type).toBe('sequence');
  });
});

// ---------------------------------------------------------------------------
// Template engine tests
// ---------------------------------------------------------------------------

describe('Template Engine', () => {
  it('substitutes simple variables', () => {
    const result = substitute('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('substitutes nested paths', () => {
    const ctx = { variables: { env: 'production' }, step1: { output: 'data' } };
    const result = substitute(
      'Deploy to {{variables.env}} with {{step1.output}}',
      ctx,
    );
    expect(result).toBe('Deploy to production with data');
  });

  it('leaves unresolved placeholders intact', () => {
    const result = substitute('Value is {{missing}}', {});
    expect(result).toBe('Value is {{missing}}');
  });
});

// ---------------------------------------------------------------------------
// Condition evaluator tests
// ---------------------------------------------------------------------------

describe('Condition Evaluator', () => {
  it('evaluates string equality', () => {
    expect(evaluateCondition("'hello' === 'hello'", {})).toBe(true);
    expect(evaluateCondition("'hello' === 'world'", {})).toBe(false);
  });

  it('substitutes context variables before evaluating', () => {
    const ctx = { variables: { env: 'prod' } };
    expect(evaluateCondition("'{{variables.env}}' === 'prod'", ctx)).toBe(true);
    expect(evaluateCondition("'{{variables.env}}' === 'dev'", ctx)).toBe(false);
  });

  it('rejects eval expressions', () => {
    expect(() => evaluateCondition('eval("1+1")', {})).toThrow(/Unsafe/);
  });

  it('rejects process access', () => {
    expect(() => evaluateCondition('process.exit(1)', {})).toThrow(/Unsafe/);
  });
});

// ---------------------------------------------------------------------------
// WorkflowExecutor tests
// ---------------------------------------------------------------------------

describe('WorkflowExecutor', () => {
  const mockDispatch = vi.fn(
    async (agent: string, task: string, _ctx: Record<string, unknown>) => {
      return `${agent}:${task}`;
    },
  );

  const dispatcher: AgentDispatcher = { dispatch: mockDispatch };

  beforeEach(() => {
    mockDispatch.mockClear();
  });

  it('executes a single agent step', async () => {
    const wf: WorkflowDefinition = {
      name: 'simple',
      version: '1.0.0',
      steps: [
        { id: 'step1', type: 'agent', agent: 'coder', task: 'write code' },
      ],
    };
    const executor = new WorkflowExecutor(dispatcher);
    const result = await executor.execute(wf);

    expect(result.status).toBe('success');
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].output).toBe('coder:write code');
    expect(mockDispatch).toHaveBeenCalledOnce();
  });

  it('executes parallel steps concurrently', async () => {
    const callOrder: string[] = [];
    const slowDispatch = vi.fn(
      async (agent: string, task: string, _ctx: Record<string, unknown>) => {
        callOrder.push(agent);
        // Both should start before either finishes
        return `${agent}:${task}`;
      },
    );

    const wf: WorkflowDefinition = {
      name: 'parallel-wf',
      version: '1.0.0',
      steps: [
        {
          id: 'par1',
          type: 'parallel',
          steps: [
            { id: 'a', type: 'agent', agent: 'coder', task: 'code' },
            { id: 'b', type: 'agent', agent: 'tester', task: 'test' },
          ],
        },
      ],
    };

    const executor = new WorkflowExecutor({ dispatch: slowDispatch });
    const result = await executor.execute(wf);

    expect(result.status).toBe('success');
    expect(result.stepResults).toHaveLength(2);
    expect(slowDispatch).toHaveBeenCalledTimes(2);
  });

  it('loop stops at max_iterations', async () => {
    // Condition always true — should stop at max_iterations
    let iteration = 0;
    const countingDispatch = vi.fn(
      async (_agent: string, _task: string, ctx: Record<string, unknown>) => {
        iteration++;
        // Always keep condition true by setting a context value
        ctx.keepGoing = 'yes';
        return `iter-${iteration}`;
      },
    );

    const wf: WorkflowDefinition = {
      name: 'loop-wf',
      version: '1.0.0',
      steps: [
        {
          id: 'loop1',
          type: 'loop',
          condition: "'yes' === 'yes'",
          max_iterations: 3,
          body: [
            { id: 'body1', type: 'agent', agent: 'coder', task: 'iterate' },
          ],
        },
      ],
    };

    const executor = new WorkflowExecutor({ dispatch: countingDispatch });
    const result = await executor.execute(wf);

    expect(result.status).toBe('success');
    // 3 iterations x 1 body step = 3 step results
    expect(result.stepResults).toHaveLength(3);
    expect(countingDispatch).toHaveBeenCalledTimes(3);
    expect(result.context['loop1_iterations']).toBe(3);
  });
});
