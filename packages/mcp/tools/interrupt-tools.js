/**
 * MCP Interrupt Tools (Task 16 — HumanInTheLoop)
 * Compiled from interrupt-tools.ts
 */

const DEFAULT_CHECKPOINT_FILE = '.monobrain/checkpoints/interrupts.jsonl';

export const listInterruptsTool = {
    name: 'interrupt/list',
    description: 'List all pending human-in-the-loop interrupt checkpoints requiring approval.',
    category: 'agent',
    tags: ['interrupt', 'human-in-the-loop'],
    inputSchema: {
        type: 'object',
        properties: {
            checkpointFile: { type: 'string', description: `Checkpoint file path (default: ${DEFAULT_CHECKPOINT_FILE})` },
        },
    },
    handler: async (input) => {
        const filePath = input.checkpointFile || DEFAULT_CHECKPOINT_FILE;
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

export const approveInterruptTool = {
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
        const filePath = input.checkpointFile || DEFAULT_CHECKPOINT_FILE;
        const checkpointId = input.checkpointId;
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

export const rejectInterruptTool = {
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
        const filePath = input.checkpointFile || DEFAULT_CHECKPOINT_FILE;
        const checkpointId = input.checkpointId;
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

export const interruptTools = [
    listInterruptsTool,
    approveInterruptTool,
    rejectInterruptTool,
];
//# sourceMappingURL=interrupt-tools.js.map
