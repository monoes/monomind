import { randomUUID } from 'crypto';
import type { WorkflowDef, NodeDef, Item, RunRecord, StepEvent } from './types.js';
import { resolveConfig } from './expression.js';
import { writeRunRecord } from './store.js';

export class DagError extends Error {
  constructor(message: string) { super(message); this.name = 'DagError'; }
}

export function buildDag(wf: WorkflowDef): string[] {
  const nodeIds = new Set(wf.nodes.map(n => n.id));
  for (const conn of wf.connections) {
    if (!nodeIds.has(conn.from)) throw new DagError(`Connection references unknown node: ${conn.from}`);
    if (!nodeIds.has(conn.to)) throw new DagError(`Connection references unknown node: ${conn.to}`);
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const n of wf.nodes) { inDegree.set(n.id, 0); adjacency.set(n.id, []); }
  for (const conn of wf.connections) {
    adjacency.get(conn.from)!.push(conn.to);
    inDegree.set(conn.to, (inDegree.get(conn.to) ?? 0) + 1);
  }

  const queue = wf.nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    order.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  if (order.length !== wf.nodes.length) throw new DagError('Workflow contains a cycle');
  return order;
}

export interface RunOptions {
  items?: Item[];
  params?: Record<string, string>;
  signal?: AbortSignal;
  onEvent?: (event: StepEvent) => void;
  executeNode?: NodeExecutor;
}

export type NodeExecutor = (
  node: NodeDef,
  items: Item[],
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
  signal?: AbortSignal,
) => Promise<Item[]>;

export async function runWorkflow(
  wf: WorkflowDef,
  options: RunOptions = {},
): Promise<RunRecord> {
  const runId = randomUUID();
  const startedAt = Date.now();
  const items = options.items ?? [{ data: {} }];
  const params = options.params ?? {};
  const emit = options.onEvent ?? (() => {});
  const execute = options.executeNode ?? defaultNodeExecutor;

  const record: RunRecord = {
    id: runId,
    workflowId: wf.id,
    workflowName: wf.name,
    status: 'running',
    startedAt,
    itemsProcessed: 0,
    itemsTotal: items.length,
  };

  emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId: '', nodeName: '',
    eventType: 'run_started', itemTotal: items.length, timestamp: Date.now() });

  const order = buildDag(wf);
  const nodeMap = new Map(wf.nodes.map(n => [n.id, n]));
  const nodeOutputs: Record<string, Item[]> = {};
  let currentItems = items;

  try {
    for (const nodeId of order) {
      if (options.signal?.aborted) {
        record.status = 'stopped';
        record.completedAt = Date.now();
        emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId, nodeName: nodeId,
          eventType: 'run_stopped', timestamp: Date.now() });
        await writeRunRecord(record);
        return record;
      }

      const node = nodeMap.get(nodeId)!;
      const stepStart = Date.now();
      emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId, nodeName: node.name ?? nodeId,
        eventType: 'step_started', itemTotal: currentItems.length, timestamp: stepStart });

      try {
        const output = await execute(node, currentItems, nodeOutputs, params, options.signal);
        nodeOutputs[nodeId] = output;
        record.itemsProcessed = output.length;
        emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId, nodeName: node.name ?? nodeId,
          eventType: 'step_completed', durationMs: Date.now() - stepStart,
          itemTotal: output.length, timestamp: Date.now() });
        if (!node.type.startsWith('trigger.')) currentItems = output;
      } catch (err) {
        emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId, nodeName: node.name ?? nodeId,
          eventType: 'step_failed', error: (err as Error).message,
          durationMs: Date.now() - stepStart, timestamp: Date.now() });
        if (node.onError === 'skip') continue;
        throw err;
      }
    }

    record.status = 'completed';
    record.completedAt = Date.now();
    emit({ runId, workflowId: wf.id, workflowName: wf.name, nodeId: '', nodeName: '',
      eventType: 'run_completed', timestamp: Date.now() });
  } catch (err) {
    record.status = 'failed';
    record.error = (err as Error).message;
    record.completedAt = Date.now();
  }

  await writeRunRecord(record);
  return record;
}

async function defaultNodeExecutor(
  node: NodeDef,
  items: Item[],
  nodeOutputs: Record<string, Item[]>,
  params: Record<string, string>,
): Promise<Item[]> {
  if (node.type.startsWith('trigger.')) return items;

  if (node.type === 'core.filter') {
    const field = node.config['field'] as string;
    const value = node.config['value'];
    return items.filter(item => item.data[field] === value);
  }

  if (node.type === 'core.set') {
    const assignments = node.config['fields'] as Record<string, unknown>;
    return items.map(item => {
      const resolved = resolveConfig(assignments, item, nodeOutputs, params);
      return { ...item, data: { ...item.data, ...resolved } };
    });
  }

  // action.* nodes — resolved by caller who passes a real executeNode
  return items;
}
