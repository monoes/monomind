/**
 * Tests for Three-Mode Team Routing (Task 22)
 *
 * Uses vitest with --globals (describe/it/expect available globally).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// We import directly from source TS files so vitest can resolve them
// without a build step.
import {
  RouteModeExecutor,
  CoordinateModeExecutor,
  CollaborateModeExecutor,
} from '../../packages/@monobrain/cli/src/orchestration/routing-modes.js';
import { ModeDispatcher } from '../../packages/@monobrain/cli/src/orchestration/mode-dispatcher.js';
import { SharedScratchpad } from '../../packages/@monobrain/shared/src/scratchpad.js';

import type { AgentDispatcher } from '../../packages/@monobrain/cli/src/orchestration/routing-modes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockDispatcher(
  impl?: AgentDispatcher['dispatch'],
): AgentDispatcher {
  return {
    dispatch: vi.fn(
      impl ??
        (async (_slug: string, _task: string) => ({
          output: 'mock-output',
          tokenUsage: { input: 10, output: 20 },
        })),
    ),
  };
}

// ---------------------------------------------------------------------------
// RouteModeExecutor
// ---------------------------------------------------------------------------

describe('RouteModeExecutor', () => {
  it('calls dispatcher once and returns result with mode="route"', async () => {
    const dispatcher = mockDispatcher();
    const executor = new RouteModeExecutor(dispatcher);

    const result = await executor.execute({
      agentSlug: 'coder',
      task: 'write code',
    });

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatch).toHaveBeenCalledWith('coder', 'write code');
    expect(result.mode).toBe('route');
    expect(result.output).toBe('mock-output');
    expect(result.agentsInvolved).toEqual(['coder']);
    expect(result.iterationCount).toBe(1);
    expect(result.tokenUsage).toEqual({ input: 10, output: 20 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// CoordinateModeExecutor
// ---------------------------------------------------------------------------

describe('CoordinateModeExecutor', () => {
  it('calls planner, fans out subtasks, then calls synthesizer', async () => {
    let callCount = 0;
    const dispatcher = mockDispatcher(async (slug: string) => {
      callCount++;
      if (slug === 'planner') {
        return {
          output: JSON.stringify({ subtasks: ['task-a', 'task-b'] }),
          tokenUsage: { input: 5, output: 5 },
        };
      }
      if (slug === 'hierarchical-coordinator') {
        return {
          output: 'synthesized',
          tokenUsage: { input: 3, output: 3 },
        };
      }
      return {
        output: `done-${slug}`,
        tokenUsage: { input: 1, output: 1 },
      };
    });

    const executor = new CoordinateModeExecutor(dispatcher);
    const result = await executor.execute({ task: 'build feature' });

    // planner + 2 workers + synthesizer = 4 calls
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(4);
    expect(result.mode).toBe('coordinate');
    expect(result.output).toBe('synthesized');
    expect(result.agentsInvolved).toContain('planner');
    expect(result.agentsInvolved).toContain('hierarchical-coordinator');
    // Token totals: planner(5+5) + 2 workers(1+1 each) + synth(3+3)
    expect(result.tokenUsage.input).toBe(5 + 1 + 1 + 3);
    expect(result.tokenUsage.output).toBe(5 + 1 + 1 + 3);
  });

  it('caps subtasks at maxSubtasks', async () => {
    const dispatcher = mockDispatcher(async (slug: string) => {
      if (slug === 'planner') {
        return {
          output: JSON.stringify({
            subtasks: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
          }),
          tokenUsage: { input: 1, output: 1 },
        };
      }
      return { output: 'ok', tokenUsage: { input: 1, output: 1 } };
    });

    const executor = new CoordinateModeExecutor(dispatcher);
    const result = await executor.execute({
      task: 'big plan',
      maxSubtasks: 3,
    });

    // planner + 3 capped workers + synthesizer = 5 calls
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(5);
    // workers: worker-0, worker-1, worker-2
    expect(result.agentsInvolved.filter((a) => a.startsWith('worker-'))).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// CollaborateModeExecutor
// ---------------------------------------------------------------------------

describe('CollaborateModeExecutor', () => {
  it('stops after convergence phrase from agentB', async () => {
    let round = 0;
    const dispatcher = mockDispatcher(async (slug: string) => {
      if (slug === 'reviewer') {
        round++;
        // Converge on round 2
        const text = round >= 2 ? 'Looks good. APPROVED' : 'Needs changes';
        return { output: text, tokenUsage: { input: 2, output: 2 } };
      }
      return { output: 'draft code', tokenUsage: { input: 2, output: 2 } };
    });

    const executor = new CollaborateModeExecutor(dispatcher);
    const result = await executor.execute({
      agentA: 'coder',
      agentB: 'reviewer',
      task: 'implement feature',
      maxIterations: 5,
    });

    expect(result.mode).toBe('collaborate');
    expect(result.iterationCount).toBe(2);
    expect(String(result.output)).toContain('APPROVED');
    expect(result.agentsInvolved).toEqual(['coder', 'reviewer']);
  });

  it('stops at maxIterations when no convergence', async () => {
    const dispatcher = mockDispatcher(async () => ({
      output: 'still working',
      tokenUsage: { input: 1, output: 1 },
    }));

    const executor = new CollaborateModeExecutor(dispatcher);
    const result = await executor.execute({
      agentA: 'coder',
      agentB: 'reviewer',
      task: 'hard problem',
      maxIterations: 3,
    });

    expect(result.iterationCount).toBe(3);
    // 3 iterations * 2 agents = 6 dispatch calls
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(6);
  });
});

// ---------------------------------------------------------------------------
// SharedScratchpad
// ---------------------------------------------------------------------------

describe('SharedScratchpad', () => {
  it('append increments iteration', () => {
    const pad = new SharedScratchpad();
    expect(pad.iteration).toBe(0);

    pad.append('agent-1', 'hello');
    expect(pad.iteration).toBe(1);

    pad.append('agent-2', 'world');
    expect(pad.iteration).toBe(2);

    expect(pad.entries).toHaveLength(2);
  });

  it('read formats entries with agent/timestamp headers separated by ---', () => {
    const pad = new SharedScratchpad();
    pad.append('alice', 'first message');
    pad.append('bob', 'second message');

    const output = pad.read();
    expect(output).toContain('[alice @');
    expect(output).toContain('first message');
    expect(output).toContain('---');
    expect(output).toContain('[bob @');
    expect(output).toContain('second message');
  });
});

// ---------------------------------------------------------------------------
// ModeDispatcher
// ---------------------------------------------------------------------------

describe('ModeDispatcher', () => {
  it('defaults to route mode', async () => {
    const dispatcher = mockDispatcher();
    const md = new ModeDispatcher(dispatcher);

    const result = await md.dispatchWithMode(undefined, {
      agentSlug: 'coder',
      task: 'do stuff',
    });

    expect(result.mode).toBe('route');
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });
});
