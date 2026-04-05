import type { Checkpointer } from './checkpointer.js';

const registry = new Map<string, Checkpointer>();

export function registerCheckpointer(swarmId: string, cp: Checkpointer): void {
  registry.set(swarmId, cp);
}

export function getCheckpointer(swarmId: string): Checkpointer | undefined {
  return registry.get(swarmId);
}

export function removeCheckpointer(swarmId: string): boolean {
  return registry.delete(swarmId);
}

export function listCheckpointers(): string[] {
  return [...registry.keys()];
}
