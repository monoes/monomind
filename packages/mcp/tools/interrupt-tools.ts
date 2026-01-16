/**
 * MCP Interrupt Tools (Task 16 — HumanInTheLoop)
 *
 * Exposes interrupt/list, interrupt/approve, interrupt/reject as MCP tools,
 * backed by InterruptCheckpointer from @monobrain/hooks when available.
 */

import type { MCPTool } from '../types.js';

const DEFAULT_CHECKPOINT_FILE = '.monobrain/checkpoints/interrupts.jsonl';

// ============================================================================
// Tool definitions
// ============================================================================

export const listInterruptsTool: MCPTool = {
  name: 'interrupt/list',
  description: 'List all pending human-in-the-loop interrupt checkpoints requiring approval.',
  category: 'agent',
  tags: ['interrupt', 'human-in-the-loop'],
  inputSchema: {
    type: 'object',
    properties: {
      checkpointFile: {
        type: 'string',
        description: `Checkpoint file path (default: ${DEFAULT_CHECKPOINT_FILE})`,
      },
    },
  },
  handler: async (input) => {
    const filePath = (input.checkpointFile as string) || DEFAULT_CHECKPOINT_FILE;
    try {
      const { InterruptCheckpointer } = await import('@monobrain/hooks');
      const checkpointer = new InterruptCheckpointer(filePath);
      const pending = checkpointer.listPending();
      return { pending, count: pending.length };
    } catch {
      return { pending: [], count: 0 };
    }
  },
};

export const approveInterruptTool: MCPTool = {
  name: 'interrupt/approve',
  description: 'Approve a pending interrupt checkpoint, allowing the queued agent spawn to proceed.',
  category: 'agent',
  tags: ['interrupt', 'human-in-the-loop'],
  inputSchema: {
    type: 'object',
    properties: {
      checkpointId: { type: 'string', description: 'Checkpoint ID to approve' },
      checkpointFile: { type: 'string', description: 'Checkpoint file path' },
    },
    required: ['checkpointId'],
  },
  handler: async (input) => {
    const filePath = (input.checkpointFile as string) || DEFAULT_CHECKPOINT_FILE;
    const checkpointId = input.checkpointId as string;
    try {
      const { InterruptCheckpointer } = await import('@monobrain/hooks');
      const checkpointer = new InterruptCheckpointer(filePath);
      checkpointer.approve(checkpointId);
      return { success: true, checkpointId, action: 'approved' };
    } catch {
      return { success: false, checkpointId, error: '@monobrain/hooks not available' };
    }
  },
};

export const rejectInterruptTool: MCPTool = {
  name: 'interrupt/reject',
  description: 'Reject a pending interrupt checkpoint, preventing the queued agent spawn.',
  category: 'agent',
  tags: ['interrupt', 'human-in-the-loop'],
  inputSchema: {
    type: 'object',
    properties: {
      checkpointId: { type: 'string', description: 'Checkpoint ID to reject' },
      reason: { type: 'string', description: 'Rejection reason' },
      checkpointFile: { type: 'string', description: 'Checkpoint file path' },
    },
    required: ['checkpointId'],
  },
  handler: async (input) => {
    const filePath = (input.checkpointFile as string) || DEFAULT_CHECKPOINT_FILE;
    const checkpointId = input.checkpointId as string;
    try {
      const { InterruptCheckpointer } = await import('@monobrain/hooks');
      const checkpointer = new InterruptCheckpointer(filePath);
      checkpointer.reject(checkpointId);
      return { success: true, checkpointId, action: 'rejected', reason: input.reason };
    } catch {
      return { success: false, checkpointId, error: '@monobrain/hooks not available' };
    }
  },
};

export const interruptTools: MCPTool[] = [
  listInterruptsTool,
  approveInterruptTool,
  rejectInterruptTool,
];
