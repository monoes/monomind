import type { PipelinePhase, PipelineContext } from './types.js';
import { MonographError } from '../types.js';

export class PipelineRunner {
  private readonly order: string[];

  constructor(private readonly phases: PipelinePhase<unknown>[]) {
    this.order = topoSort(phases);
  }

  async run(ctx: PipelineContext): Promise<Map<string, unknown>> {
    const outputs = new Map<string, unknown>();
    const phaseMap = new Map(this.phases.map(p => [p.name, p]));

    for (const name of this.order) {
      const phase = phaseMap.get(name)!;
      ctx.onProgress?.({ phase: name });
      const output = await phase.execute(ctx, outputs);
      outputs.set(name, output);
    }

    return outputs;
  }
}

function topoSort(phases: PipelinePhase<unknown>[]): string[] {
  const names = new Set(phases.map(p => p.name));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const p of phases) {
    inDegree.set(p.name, p.deps.length);
    for (const dep of p.deps) {
      if (!names.has(dep)) {
        throw new MonographError(`Phase '${p.name}' depends on unknown phase '${dep}'`);
      }
      const adj = adjList.get(dep) ?? [];
      adj.push(p.name);
      adjList.set(dep, adj);
    }
  }

  const queue = phases.filter(p => (inDegree.get(p.name) ?? 0) === 0).map(p => p.name);
  const result: string[] = [];

  while (queue.length) {
    const name = queue.shift()!;
    result.push(name);
    for (const next of (adjList.get(name) ?? [])) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  if (result.length !== phases.length) {
    throw new MonographError('Cycle detected in pipeline phase graph');
  }

  return result;
}
