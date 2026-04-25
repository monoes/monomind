/**
 * Interrupt Checkpoint MCP Tools (GAP-008)
 *
 * MCP tools to expose InterruptCheckpointer so Claude can list pending
 * human-in-the-loop checkpoints and approve or reject agent spawns.
 */

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

const DEFAULT_CHECKPOINT_FILE = '.monobrain/checkpoints/interrupts.jsonl';

export const listPendingCheckpointsTool: MCPTool = {
  name: 'hooks/interrupt/list-pending',
  description: 'List all pending human-in-the-loop interrupt checkpoints that require approval before agent spawning.',
  inputSchema: {
    type: 'object',
    properties: {
      checkpointFile: {
        type: 'string',
        description: 'Custom checkpoint file path (default: .monobrain/checkpoints/interrupts.jsonl)',
      },
    },
  },
  handler: async (input) => {
    const { InterruptCheckpointer } = await import('../interrupt/index.js');
    const filePath = (input.checkpointFile as string) || DEFAULT_CHECKPOINT_FILE;
    const checkpointer = new InterruptCheckpointer(filePath);
    const pending = checkpointer.listPending();
    return { pending, count: pending.length };
  },
};

export const approveCheckpointTool: MCPTool = {
  name: 'hooks/interrupt/approve',
  description: 'Approve a pending interrupt checkpoint, allowing the queued agent spawn to proceed.',
  inputSchema: {
    type: 'object',
    properties: {
      checkpointId: {
        type: 'string',
        description: 'The checkpoint ID to approve',
      },
      checkpointFile: {
        type: 'string',
        description: 'Custom checkpoint file path',
      },
    },
    required: ['checkpointId'],
  },
  handler: async (input) => {
    const { InterruptCheckpointer } = await import('../interrupt/index.js');
    const filePath = (input.checkpointFile as string) || DEFAULT_CHECKPOINT_FILE;
    const checkpointer = new InterruptCheckpointer(filePath);
    checkpointer.approve(input.checkpointId as string);
    return { approved: true, checkpointId: input.checkpointId };
  },
};

export const rejectCheckpointTool: MCPTool = {
  name: 'hooks/interrupt/reject',
  description: 'Reject a pending interrupt checkpoint, preventing the queued agent spawn.',
  inputSchema: {
    type: 'object',
    properties: {
      checkpointId: {
        type: 'string',
        description: 'The checkpoint ID to reject',
      },
      checkpointFile: {
        type: 'string',
        description: 'Custom checkpoint file path',
      },
    },
    required: ['checkpointId'],
  },
  handler: async (input) => {
    const { InterruptCheckpointer } = await import('../interrupt/index.js');
    const filePath = (input.checkpointFile as string) || DEFAULT_CHECKPOINT_FILE;
    const checkpointer = new InterruptCheckpointer(filePath);
    checkpointer.reject(input.checkpointId as string);
    return { rejected: true, checkpointId: input.checkpointId };
  },
};

export const getCheckpointTool: MCPTool = {
  name: 'hooks/interrupt/get',
  description: 'Get a specific interrupt checkpoint by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      checkpointId: {
        type: 'string',
        description: 'The checkpoint ID to retrieve',
      },
      checkpointFile: {
        type: 'string',
        description: 'Custom checkpoint file path',
      },
    },
    required: ['checkpointId'],
  },
  handler: async (input) => {
    const { InterruptCheckpointer } = await import('../interrupt/index.js');
    const filePath = (input.checkpointFile as string) || DEFAULT_CHECKPOINT_FILE;
    const checkpointer = new InterruptCheckpointer(filePath);
    const checkpoint = checkpointer.get(input.checkpointId as string);
    if (!checkpoint) return { error: `Checkpoint not found: ${input.checkpointId}` };
    return { checkpoint };
  },
};

export const checkpointMCPTools: MCPTool[] = [
  listPendingCheckpointsTool,
  approveCheckpointTool,
  rejectCheckpointTool,
  getCheckpointTool,
];
