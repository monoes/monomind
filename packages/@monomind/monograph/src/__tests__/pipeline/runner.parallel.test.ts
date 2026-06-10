import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../../pipeline/runner.js';
import type { PipelinePhase, PipelineContext } from '../../pipeline/types.js';

function makeCtx(): PipelineContext {
  return { repoPath: '/tmp', options: { ignore: [], codeOnly: false } } as any;
}

describe('PipelineRunner parallel execution', () => {
  it('runs independent phases concurrently', async () => {
    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};

    function makeDelayPhase(name: string, deps: string[], delayMs: number): PipelinePhase<{ name: string }> {
      return {
        name,
        deps,
        async execute() {
          startTimes[name] = Date.now();
          await new Promise(r => setTimeout(r, delayMs));
          endTimes[name] = Date.now();
          return { name };
        },
      };
    }

    // a and b are independent, c depends on both
    const phases = [
      makeDelayPhase('a', [], 50),
      makeDelayPhase('b', [], 50),
      makeDelayPhase('c', ['a', 'b'], 10),
    ];

    const runner = new PipelineRunner(phases);
    const t0 = Date.now();
    await runner.run(makeCtx());
    const elapsed = Date.now() - t0;

    // Sequential would take 110ms+; parallel finishes in ~65ms (200ms budget for CI/load variance)
    expect(elapsed).toBeLessThan(200);
  });

  it('respects deps — c starts only after a and b finish', async () => {
    const endTimes: Record<string, number> = {};
    let cStartTime = 0;

    const phases: PipelinePhase<unknown>[] = [
      { name: 'a', deps: [], async execute() { await new Promise(r => setTimeout(r, 30)); endTimes['a'] = Date.now(); return {}; } },
      { name: 'b', deps: [], async execute() { await new Promise(r => setTimeout(r, 30)); endTimes['b'] = Date.now(); return {}; } },
      { name: 'c', deps: ['a', 'b'], async execute() { cStartTime = Date.now(); return {}; } },
    ];

    const runner = new PipelineRunner(phases);
    await runner.run(makeCtx());

    expect(cStartTime).toBeGreaterThanOrEqual(endTimes['a']!);
    expect(cStartTime).toBeGreaterThanOrEqual(endTimes['b']!);
  });

  it('outputs map contains all phase results', async () => {
    const phases: PipelinePhase<unknown>[] = [
      { name: 'x', deps: [], async execute() { return { val: 1 }; } },
      { name: 'y', deps: ['x'], async execute(_ctx, deps) { const x = deps.get('x') as any; return { val: x.val + 1 }; } },
    ];
    const runner = new PipelineRunner(phases);
    const outputs = await runner.run(makeCtx());
    expect((outputs.get('x') as any).val).toBe(1);
    expect((outputs.get('y') as any).val).toBe(2);
  });

  it('throws on cycle detection', () => {
    const phases: PipelinePhase<unknown>[] = [
      { name: 'a', deps: ['b'], async execute() { return {}; } },
      { name: 'b', deps: ['a'], async execute() { return {}; } },
    ];
    expect(() => new PipelineRunner(phases)).toThrow();
  });
});
