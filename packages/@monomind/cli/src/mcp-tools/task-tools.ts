/**
 * Task MCP Tools for CLI
 *
 * Tool definitions for task management with file persistence.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { type MCPTool, getProjectCwd } from './types.js';

// Storage paths
const STORAGE_DIR = '.monomind';
const TASK_DIR = 'tasks';
const TASK_FILE = 'store.json';

interface TaskRecord {
  taskId: string;
  type: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  assignedTo: string[];
  tags: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result?: Record<string, unknown>;
}

interface TaskStore {
  tasks: Record<string, TaskRecord>;
  version: string;
}

function getTaskDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, TASK_DIR);
}

function getTaskPath(): string {
  return join(getTaskDir(), TASK_FILE);
}

function ensureTaskDir(): void {
  const dir = getTaskDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const MAX_TASK_STORE_BYTES = 50 * 1024 * 1024;

function loadTaskStore(): TaskStore {
  try {
    const path = getTaskPath();
    if (existsSync(path)) {
      if (statSync(path).size > MAX_TASK_STORE_BYTES) return { tasks: {}, version: '3.0.0' };
      const data = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(data) as TaskStore;
      if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, '__proto__')) return { tasks: {}, version: '3.0.0' };
      return parsed;
    }
  } catch {
    // Return empty store on error
  }
  return { tasks: {}, version: '3.0.0' };
}

function saveTaskStore(store: TaskStore): void {
  ensureTaskDir();
  const taskPath = getTaskPath();
  // Unique tmp filename — concurrent task_assign/complete calls would
  // otherwise race on the same .tmp file.
  const tmpPath = `${taskPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmpPath, taskPath);
}

const FORBIDDEN_TASK_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export const taskTools: MCPTool[] = [
  {
    name: 'task_create',
    description: 'Create a new task',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Task type (feature, bugfix, research, refactor)' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'string', description: 'Task priority (low, normal, high, critical)' },
        assignTo: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to assign' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Task tags' },
      },
      required: ['type', 'description'],
    },
    handler: async (input) => {
      const store = loadTaskStore();
      const taskId = `task-${Date.now()}-${randomBytes(4).toString('hex')}`;

      const task: TaskRecord = {
        taskId,
        type: input.type as string,
        description: input.description as string,
        priority: (input.priority as TaskRecord['priority']) || 'normal',
        status: 'pending',
        progress: 0,
        assignedTo: (input.assignTo as string[]) || [],
        tags: (input.tags as string[]) || [],
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      };

      store.tasks[taskId] = task;
      saveTaskStore(store);

      return {
        taskId,
        type: task.type,
        description: task.description,
        priority: task.priority,
        status: task.status,
        createdAt: task.createdAt,
        assignedTo: task.assignedTo,
        tags: task.tags,
      };
    },
  },
  {
    name: 'task_status',
    description: 'Get task status',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      const store = loadTaskStore();
      const taskId = input.taskId as string;
      if (FORBIDDEN_TASK_IDS.has(taskId)) return { taskId, status: 'not_found', error: 'Task not found' };
      const task = store.tasks[taskId];

      if (task) {
        return {
          taskId: task.taskId,
          type: task.type,
          description: task.description,
          status: task.status,
          progress: task.progress,
          priority: task.priority,
          assignedTo: task.assignedTo,
          tags: task.tags,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          result: task.result || null,
        };
      }

      return {
        taskId,
        status: 'not_found',
        error: 'Task not found',
      };
    },
  },
  {
    name: 'task_list',
    description: 'List all tasks',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        type: { type: 'string', description: 'Filter by type' },
        assignedTo: { type: 'string', description: 'Filter by assigned agent' },
        priority: { type: 'string', description: 'Filter by priority' },
        limit: { type: 'number', description: 'Max tasks to return' },
      },
    },
    handler: async (input) => {
      const store = loadTaskStore();
      let tasks = Object.values(store.tasks);

      // Apply filters
      if (input.status) {
        // Support comma-separated status values
        const statuses = (input.status as string).split(',').map(s => s.trim());
        tasks = tasks.filter(t => statuses.includes(t.status));
      }
      if (input.type) {
        tasks = tasks.filter(t => t.type === input.type);
      }
      if (input.assignedTo) {
        tasks = tasks.filter(t => t.assignedTo.includes(input.assignedTo as string));
      }
      if (input.priority) {
        tasks = tasks.filter(t => t.priority === input.priority);
      }

      // Sort by creation date (newest first)
      tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Apply limit
      const limit = (input.limit as number) || 50;
      tasks = tasks.slice(0, limit);

      return {
        tasks: tasks.map(t => ({
          taskId: t.taskId,
          type: t.type,
          description: t.description,
          status: t.status,
          progress: t.progress,
          priority: t.priority,
          assignedTo: t.assignedTo,
          createdAt: t.createdAt,
        })),
        total: tasks.length,
        filters: {
          status: input.status,
          type: input.type,
          assignedTo: input.assignedTo,
          priority: input.priority,
        },
      };
    },
  },
  {
    name: 'task_complete',
    description: 'Mark task as complete',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        result: { type: 'object', description: 'Task result data' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      const store = loadTaskStore();
      const taskId = input.taskId as string;
      if (FORBIDDEN_TASK_IDS.has(taskId)) return { taskId, status: 'not_found', error: 'Task not found' };
      const task = store.tasks[taskId];

      if (task) {
        task.status = 'completed';
        task.progress = 100;
        task.completedAt = new Date().toISOString();
        task.result = (input.result as Record<string, unknown>) || {};
        saveTaskStore(store);

        // Sync assigned agents back to idle and increment taskCount
        if (task.assignedTo.length > 0) {
          const agentStorePath = join(getProjectCwd(), STORAGE_DIR, 'agents', 'store.json');
          try {
            let agentStore: { agents: Record<string, Record<string, unknown>> } = { agents: {} };
            if (existsSync(agentStorePath)) {
              const agentRaw = JSON.parse(readFileSync(agentStorePath, 'utf-8'));
              if (agentRaw && typeof agentRaw === 'object' && !Object.prototype.hasOwnProperty.call(agentRaw, '__proto__')) {
                agentStore = agentRaw;
              }
            }
            for (const agentId of task.assignedTo) {
              const FORBIDDEN_AGENT_IDS_TC = new Set(['__proto__', 'constructor', 'prototype']);
              if (typeof agentId === 'string' && agentId.length > 0 && agentId.length <= 128 &&
                  !FORBIDDEN_AGENT_IDS_TC.has(agentId) && Object.hasOwn(agentStore.agents, agentId)) {
                agentStore.agents[agentId].status = 'idle';
                agentStore.agents[agentId].currentTask = null;
                agentStore.agents[agentId].taskCount =
                  ((agentStore.agents[agentId].taskCount as number) || 0) + 1;
              }
            }
            const agentDir = join(getProjectCwd(), STORAGE_DIR, 'agents');
            if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });
            const tmpAgent1 = `${agentStorePath}.${process.pid}.${Date.now()}.tmp`;
            writeFileSync(tmpAgent1, JSON.stringify(agentStore, null, 2), 'utf-8');
            renameSync(tmpAgent1, agentStorePath);
          } catch {
            // Best-effort agent sync
          }
        }

        return {
          taskId: task.taskId,
          status: task.status,
          completedAt: task.completedAt,
          result: task.result,
        };
      }

      return {
        taskId,
        status: 'not_found',
        error: 'Task not found',
      };
    },
  },
  {
    name: 'task_update',
    description: 'Update task status or progress',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        status: { type: 'string', description: 'New status' },
        progress: { type: 'number', description: 'Progress percentage (0-100)' },
        assignTo: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to assign' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      const store = loadTaskStore();
      const taskId = input.taskId as string;
      if (FORBIDDEN_TASK_IDS.has(taskId)) return { success: false, taskId, error: 'Task not found' };
      const task = store.tasks[taskId];

      if (task) {
        if (input.status) {
          const newStatus = input.status as TaskRecord['status'];
          task.status = newStatus;
          if (newStatus === 'in_progress' && !task.startedAt) {
            task.startedAt = new Date().toISOString();
          }
        }
        if (typeof input.progress === 'number') {
          task.progress = Math.min(100, Math.max(0, input.progress as number));
        }
        if (input.assignTo) {
          task.assignedTo = input.assignTo as string[];
        }
        saveTaskStore(store);

        return {
          success: true,
          taskId: task.taskId,
          status: task.status,
          progress: task.progress,
          assignedTo: task.assignedTo,
        };
      }

      return {
        success: false,
        taskId,
        error: 'Task not found',
      };
    },
  },
  {
    name: 'task_assign',
    description: 'Assign a task to one or more agents',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to assign' },
        agentIds: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to assign' },
        unassign: { type: 'boolean', description: 'Unassign all agents from task' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      const store = loadTaskStore();
      const taskId = input.taskId as string;
      if (FORBIDDEN_TASK_IDS.has(taskId)) return { taskId, error: 'Task not found' };
      const task = store.tasks[taskId];

      if (!task) {
        return { taskId, error: 'Task not found' };
      }

      const previouslyAssigned = [...task.assignedTo];

      // Load agent store to sync worker state
      const agentStorePath = join(getProjectCwd(), STORAGE_DIR, 'agents', 'store.json');
      let agentStore: { agents: Record<string, Record<string, unknown>> } = { agents: {} };
      try {
        if (existsSync(agentStorePath)) {
          agentStore = JSON.parse(readFileSync(agentStorePath, 'utf-8'));
        }
      } catch { /* ignore */ }

      // Reject IDs that would mutate Object.prototype when used as a key in
      // the JSON-loaded plain object `agentStore.agents`.
      const FORBIDDEN_AGENT_IDS = new Set(['__proto__', 'constructor', 'prototype']);
      const isValidAgentId = (id: unknown): id is string =>
        typeof id === 'string' && id.length > 0 && id.length <= 128 && !FORBIDDEN_AGENT_IDS.has(id);

      if (input.unassign) {
        // Revert previously assigned agents to idle
        for (const agentId of previouslyAssigned) {
          if (isValidAgentId(agentId) && Object.hasOwn(agentStore.agents, agentId)) {
            agentStore.agents[agentId].status = 'idle';
            agentStore.agents[agentId].currentTask = null;
          }
        }
        task.assignedTo = [];
      } else {
        const rawIds = (input.agentIds as string[]) || [];
        const agentIds = rawIds.filter(isValidAgentId);
        // Revert old agents to idle
        for (const agentId of previouslyAssigned) {
          if (isValidAgentId(agentId) && !agentIds.includes(agentId) && Object.hasOwn(agentStore.agents, agentId)) {
            agentStore.agents[agentId].status = 'idle';
            agentStore.agents[agentId].currentTask = null;
          }
        }
        // Set new agents to active
        for (const agentId of agentIds) {
          if (Object.hasOwn(agentStore.agents, agentId)) {
            agentStore.agents[agentId].status = 'busy';
            agentStore.agents[agentId].currentTask = taskId;
          }
        }
        task.assignedTo = agentIds;
        // Auto-transition task to in_progress if pending
        if (task.status === 'pending' && agentIds.length > 0) {
          task.status = 'in_progress';
          if (!task.startedAt) {
            task.startedAt = new Date().toISOString();
          }
        }
      }

      saveTaskStore(store);
      // Save agent store
      const agentDir = join(getProjectCwd(), STORAGE_DIR, 'agents');
      if (!existsSync(agentDir)) {
        mkdirSync(agentDir, { recursive: true });
      }
      const tmpAgent2 = `${agentStorePath}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmpAgent2, JSON.stringify(agentStore, null, 2), 'utf-8');
      renameSync(tmpAgent2, agentStorePath);

      return {
        taskId: task.taskId,
        assignedTo: task.assignedTo,
        previouslyAssigned,
        status: task.status,
      };
    },
  },
  {
    name: 'task_cancel',
    description: 'Cancel a task',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        reason: { type: 'string', description: 'Cancellation reason' },
      },
      required: ['taskId'],
    },
    handler: async (input) => {
      const store = loadTaskStore();
      const taskId = input.taskId as string;
      if (FORBIDDEN_TASK_IDS.has(taskId)) return { success: false, taskId, error: 'Task not found' };
      const task = store.tasks[taskId];

      if (task) {
        task.status = 'cancelled';
        task.completedAt = new Date().toISOString();
        task.result = { cancelReason: input.reason || 'Cancelled by user' };
        saveTaskStore(store);

        return {
          success: true,
          taskId: task.taskId,
          status: task.status,
          cancelledAt: task.completedAt,
        };
      }

      return {
        success: false,
        taskId,
        error: 'Task not found',
      };
    },
  },
];
