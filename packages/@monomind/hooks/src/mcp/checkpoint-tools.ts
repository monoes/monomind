/**
 * Interrupt Checkpoint MCP Tools (GAP-008)
 *
 * MCP tools to expose InterruptCheckpointer so Claude can list pending
 * human-in-the-loop checkpoints and approve or reject agent spawns.
 */

import { resolve } from 'node:path';
import { cwd } from 'node:process';

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

const DEFAULT_CHECKPOINT_FILE = '.monomind/checkpoints/interrupts.jsonl';

// ── Security helpers ──────────────────────────────────────────────────────────

/**
 * Validate that the caller-supplied checkpoint file path resolves within the
 * project working directory.  Without this check an attacker can pass
 * `checkpointFile: "../../../../etc/cron.d/payload"` and InterruptCheckpointer
 * will happily append JSON lines to that path.
 *
 * Only .jsonl files directly under the project tree are permitted.
 */
function validateCheckpointFilePath(raw: string | undefined): string {
  const projectRoot = resolve(cwd());
  const candidate = resolve(projectRoot, raw ?? DEFAULT_CHECKPOINT_FILE);

  // Must stay inside the project root.
  if (!candidate.startsWith(projectRoot + '/') && candidate !== projectRoot) {
    throw new Error('checkpointFile must be within the project directory');
  }

  // Only allow .jsonl files — the underlying checkpointer appends JSON lines.
  if (!candidate.endsWith('.jsonl')) {
    throw new Error('checkpointFile must have a .jsonl extension');
  }

  // Cap absolute path length to prevent DoS via very long filenames.
  if (candidate.length > 4096) {
    throw new Error('checkpointFile path too long (max 4096 characters)');
  }

  return candidate;
}

/**
 * Validate a checkpoint ID: only safe alphanumeric + hyphen characters,
 * max 128 characters.  The ID ends up in a JSONL append (JSON.stringify
 * escapes special chars) and also used in `.find()` comparisons — the
 * length cap prevents pathological O(n) linear scans.
 */
function validateCheckpointId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('checkpointId must be a non-empty string');
  }
  if (raw.length > 128) {
    throw new Error('checkpointId too long (max 128 characters)');
  }
  // Allow the generated pattern (chk-<base36>-<hex>) plus any user-supplied
  // reasonable identifier (letters, digits, hyphen, underscore, dot).
  if (!/^[\w.:-]+$/.test(raw)) {
    throw new Error('checkpointId contains invalid characters');
  }
  return raw;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const listPendingCheckpointsTool: MCPTool = {
  name: 'hooks/interrupt/list-pending',
  description: 'List all pending human-in-the-loop interrupt checkpoints that require approval before agent spawning.',
  inputSchema: {
    type: 'object',
    properties: {
      checkpointFile: {
        type: 'string',
        description: 'Custom checkpoint file path (default: .monomind/checkpoints/interrupts.jsonl)',
      },
    },
  },
  handler: async (input) => {
    let filePath: string;
    try {
      filePath = validateCheckpointFilePath(input.checkpointFile as string | undefined);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const { InterruptCheckpointer } = await import('../interrupt/index.js');
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
    let filePath: string;
    let checkpointId: string;
    try {
      filePath = validateCheckpointFilePath(input.checkpointFile as string | undefined);
      checkpointId = validateCheckpointId(input.checkpointId);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const { InterruptCheckpointer } = await import('../interrupt/index.js');
    const checkpointer = new InterruptCheckpointer(filePath);
    checkpointer.approve(checkpointId);
    return { approved: true, checkpointId };
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
    let filePath: string;
    let checkpointId: string;
    try {
      filePath = validateCheckpointFilePath(input.checkpointFile as string | undefined);
      checkpointId = validateCheckpointId(input.checkpointId);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const { InterruptCheckpointer } = await import('../interrupt/index.js');
    const checkpointer = new InterruptCheckpointer(filePath);
    checkpointer.reject(checkpointId);
    return { rejected: true, checkpointId };
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
    let filePath: string;
    let checkpointId: string;
    try {
      filePath = validateCheckpointFilePath(input.checkpointFile as string | undefined);
      checkpointId = validateCheckpointId(input.checkpointId);
    } catch (e) {
      return { error: (e as Error).message };
    }
    const { InterruptCheckpointer } = await import('../interrupt/index.js');
    const checkpointer = new InterruptCheckpointer(filePath);
    const checkpoint = checkpointer.get(checkpointId);
    if (!checkpoint) return { error: `Checkpoint not found: ${checkpointId}` };
    return { checkpoint };
  },
};

export const checkpointMCPTools: MCPTool[] = [
  listPendingCheckpointsTool,
  approveCheckpointTool,
  rejectCheckpointTool,
  getCheckpointTool,
];
