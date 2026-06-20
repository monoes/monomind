import { randomUUID } from 'node:crypto';
import { resolveExpression, resolveConfig } from './expression.js';
import { getDashboard } from '../dashboard/server.js';
import type { WorkflowDef, NodeDef, Item, RunRecord, StepEvent, RunStatus } from './types.js';

export type NodeHandler = (items: Item[], config: Record<string, unknown>) => Promise<Item[]>;

export interface EngineOptions {
  handlers?: Map<string, NodeHandler>;
  onEvent?: (event: StepEvent) => void;
  signal?: AbortSignal;
  params?: Record<string, string>;
}

export async function runWorkflow(
  def: WorkflowDef,
  options: EngineOptions = {},
): Promise<RunRecord> {
  const { handlers = new Map(), onEvent = () => {}, signal, params = {} } = options;
  const runId = randomUUID();
  const startedAt = Date.now();

  // Build a unified abort controller that merges the caller's signal with dashboard stop-requests.
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  const dashboard = getDashboard();
  let stopPollTimer: ReturnType<typeof setInterval> | undefined;
  if (dashboard) {
    stopPollTimer = setInterval(() => {
      if (dashboard.isStopRequested(runId)) controller.abort();
    }, 500);
    // Avoid keeping Node.js event loop alive if nothing else is running
    stopPollTimer.unref?.();
  }

  const emit = (partial: Omit<StepEvent, 'runId' | 'workflowId' | 'workflowName' | 'timestamp'>) =>
    onEvent({ runId, workflowId: def.id, workflowName: def.name, timestamp: Date.now(), ...partial });

  emit({ nodeId: '', nodeName: '', eventType: 'run_started' });

  // Build adjacency structures
  const nodeMap = new Map(def.nodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>(def.nodes.map(n => [n.id, 0]));
  const outEdges = new Map<string, { to: string; handle?: string }[]>();
  const toEdges = new Map<string, { from: string; handle?: string }[]>();

  for (const conn of def.connections) {
    inDegree.set(conn.to, (inDegree.get(conn.to) ?? 0) + 1);
    const edges = outEdges.get(conn.from) ?? [];
    edges.push({ to: conn.to, handle: conn.handle });
    outEdges.set(conn.from, edges);
    const toList = toEdges.get(conn.to) ?? [];
    toList.push({ from: conn.from, handle: conn.handle });
    toEdges.set(conn.to, toList);
  }

  // Kahn's topological sort
  const queue: string[] = [];
  const sorted: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const edge of outEdges.get(id) ?? []) {
      const newDeg = (inDegree.get(edge.to) ?? 0) - 1;
      inDegree.set(edge.to, newDeg);
      if (newDeg === 0) queue.push(edge.to);
    }
  }
  if (sorted.length !== def.nodes.length) {
    throw new Error('Workflow contains a cycle');
  }

  // Node output accumulator
  const nodeOutputs = new Map<string, Item[]>();
  let itemsProcessed = 0;
  let runStatus: RunStatus = 'completed';
  let runError: string | undefined;

  try {
    for (const nodeId of sorted) {
      if (controller.signal.aborted) {
        runStatus = 'stopped';
        emit({ nodeId, nodeName: nodeId, eventType: 'run_stopped' });
        break;
      }

      const node = nodeMap.get(nodeId)!;
      const nodeName = node.name ?? node.id;
      const t0 = Date.now();

      // Collect inputs from predecessor outputs
      const inputItems = collectInputs(nodeId, nodeOutputs, toEdges);

      emit({ nodeId, nodeName, eventType: 'step_started', itemTotal: inputItems.length });

      try {
        const outputs = await executeNode(node, inputItems, handlers, nodeOutputs, params);
        nodeOutputs.set(nodeId, outputs);
        itemsProcessed += outputs.length;
        emit({ nodeId, nodeName, eventType: 'step_completed', durationMs: Date.now() - t0, itemTotal: outputs.length });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        emit({ nodeId, nodeName, eventType: 'step_failed', error, durationMs: Date.now() - t0 });
        if (node.onError === 'skip') {
          nodeOutputs.set(nodeId, []);
        } else {
          runStatus = 'failed';
          runError = error;
          break;
        }
      }
    }
  } finally {
    if (stopPollTimer !== undefined) clearInterval(stopPollTimer);
  }

  const completedAt = Date.now();
  const record: RunRecord = {
    id: runId,
    workflowId: def.id,
    workflowName: def.name,
    status: runStatus,
    startedAt,
    completedAt,
    itemsProcessed,
    itemsTotal: itemsProcessed,
    error: runError,
  };

  emit({ nodeId: '', nodeName: '', eventType: runStatus === 'completed' ? 'run_completed' : 'run_stopped', error: runError });
  return record;
}

function collectInputs(nodeId: string, nodeOutputs: Map<string, Item[]>, toEdges: Map<string, { from: string; handle?: string }[]>): Item[] {
  const predecessors = toEdges.get(nodeId) ?? [];
  if (predecessors.length === 0) return [{ data: {} }];
  return predecessors.flatMap(({ from, handle }) => {
    const items = nodeOutputs.get(from) ?? [];
    if (handle === 'true') return items.filter(item => item.data['__ifResult'] === true);
    if (handle === 'false') return items.filter(item => item.data['__ifResult'] === false);
    return items;
  });
}

async function executeNode(
  node: NodeDef,
  inputs: Item[],
  handlers: Map<string, NodeHandler>,
  nodeOutputs: Map<string, Item[]>,
  params: Record<string, string>,
): Promise<Item[]> {
  const allOutputs: Record<string, Item[]> = Object.fromEntries(nodeOutputs);
  const { type, config } = node;

  if (type === 'trigger.manual') {
    const items = config['items'];
    if (Array.isArray(items)) return items as Item[];
    return inputs;
  }

  if (type === 'core.set') {
    return inputs.map(item => {
      const resolved = resolveConfig(config, item, allOutputs, params);
      return { ...item, data: { ...item.data, ...resolved } };
    });
  }

  if (type === 'core.filter') {
    const predicate = config['expression'] as string;
    return inputs.filter(item => {
      try {
        return Boolean(resolveExpression(predicate, item, allOutputs, params));
      } catch {
        return false;
      }
    });
  }

  if (type === 'core.if') {
    const predicate = config['expression'] as string;
    return inputs.map(item => {
      const result = Boolean(resolveExpression(predicate, item, allOutputs, params));
      return { ...item, data: { ...item.data, __ifResult: result } };
    });
  }

  // action.* — delegate to registered handler
  const handler = handlers.get(type);
  if (!handler) throw new Error(`No handler registered for node type: ${type}`);
  const resolvedConfig = resolveConfig(config, inputs[0] ?? { data: {} }, allOutputs, params);
  return handler(inputs, resolvedConfig);
}
