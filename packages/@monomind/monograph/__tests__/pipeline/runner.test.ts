import { PipelineRunner } from '../../src/pipeline/runner.js';
import type { PipelinePhase, PipelineContext } from '../../src/pipeline/types.js';

describe('PipelineRunner', () => {
  it('executes phases in dependency order', async () => {
    const order: string[] = [];

    const phases: PipelinePhase<unknown>[] = [
      { name: 'c', deps: ['a', 'b'], execute: async () => { order.push('c'); return 'c'; } },
      { name: 'a', deps: [],         execute: async () => { order.push('a'); return 'a'; } },
      { name: 'b', deps: ['a'],      execute: async () => { order.push('b'); return 'b'; } },
    ];

    const runner = new PipelineRunner(phases);
    await runner.run({} as PipelineContext);

    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('throws on cycle detection', () => {
    const phases: PipelinePhase<unknown>[] = [
      { name: 'a', deps: ['b'], execute: async () => null },
      { name: 'b', deps: ['a'], execute: async () => null },
    ];
    expect(() => new PipelineRunner(phases)).toThrow(/cycle/i);
  });
});
