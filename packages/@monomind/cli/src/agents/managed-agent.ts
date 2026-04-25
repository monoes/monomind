import { randomBytes } from 'node:crypto';

export interface AgentRunResult {
  agentSlug: string;
  taskId: string;
  output: string;
  status: 'success' | 'error' | 'timeout';
  durationMs: number;
  tokens?: { inputTokens: number; outputTokens: number };
  error?: string;
}

export interface ManagedAgentOptions {
  timeoutMs?: number;       // default 120_000
  pollIntervalMs?: number;  // default 500
}

/**
 * Simulates spawn-and-await by creating a taskId, delegating to a runner function,
 * and applying timeout.
 */
export async function spawnAndAwait(
  agentSlug: string,
  task: string,
  runner: (agentSlug: string, taskId: string, task: string) => Promise<string>,
  options: ManagedAgentOptions = {}
): Promise<AgentRunResult> {
  const { timeoutMs = 120_000 } = options;
  const startedAt = Date.now();
  const taskId = `managed-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

  try {
    const output = await Promise.race([
      runner(agentSlug, taskId, task),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    return {
      agentSlug, taskId, output, status: 'success',
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const isTimeout = String(err).includes('Timeout');
    return {
      agentSlug, taskId, output: '',
      status: isTimeout ? 'timeout' : 'error',
      durationMs: Date.now() - startedAt,
      error: String(err),
    };
  }
}

export class ManagedAgent {
  constructor(
    private readonly agentSlug: string,
    private readonly runner: (agentSlug: string, taskId: string, task: string) => Promise<string>,
    private readonly options: ManagedAgentOptions = {}
  ) {}

  async run(task: string): Promise<AgentRunResult> {
    return spawnAndAwait(this.agentSlug, task, this.runner, this.options);
  }

  /** Generate an MCP-style tool descriptor for this agent */
  toToolDescriptor(): { name: string; description: string; inputSchema: Record<string, unknown> } {
    const toolName = `agent_${this.agentSlug.replace(/-/g, '_')}`;
    return {
      name: toolName,
      description: `Delegate a task to the ${this.agentSlug} specialist agent`,
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task description' },
          timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000)' },
        },
        required: ['task'],
      },
    };
  }

  static create(
    agentSlug: string,
    runner: (slug: string, id: string, task: string) => Promise<string>,
    options?: ManagedAgentOptions
  ): ManagedAgent {
    return new ManagedAgent(agentSlug, runner, options);
  }
}

/** Run multiple agents in parallel */
export async function runBatch(
  agents: Array<{ agentSlug: string; task: string }>,
  runner: (agentSlug: string, taskId: string, task: string) => Promise<string>,
  options: ManagedAgentOptions = {}
): Promise<AgentRunResult[]> {
  return Promise.all(
    agents.map(({ agentSlug, task }) => spawnAndAwait(agentSlug, task, runner, options))
  );
}
