/**
 * Workflow MCP Tools for CLI
 *
 * Tool definitions for workflow automation and orchestration.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { type MCPTool, getProjectCwd } from './types.js';

const MAX_WORKFLOW_STORE_BYTES = 50 * 1024 * 1024; // 50 MB

// Storage paths
const STORAGE_DIR = '.monomind';
const WORKFLOW_DIR = 'workflows';
const WORKFLOW_FILE = 'store.json';

interface WorkflowStep {
  stepId: string;
  name: string;
  type: 'task' | 'condition' | 'parallel' | 'loop' | 'wait';
  config: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  startedAt?: string;
  completedAt?: string;
}

interface WorkflowRecord {
  workflowId: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  status: 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  variables: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface WorkflowStore {
  workflows: Record<string, WorkflowRecord>;
  templates: Record<string, WorkflowRecord>;
  version: string;
}

function getWorkflowDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, WORKFLOW_DIR);
}

function getWorkflowPath(): string {
  return join(getWorkflowDir(), WORKFLOW_FILE);
}

function ensureWorkflowDir(): void {
  const dir = getWorkflowDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadWorkflowStore(): WorkflowStore {
  try {
    const path = getWorkflowPath();
    if (existsSync(path)) {
      if (statSync(path).size > MAX_WORKFLOW_STORE_BYTES) {
        return { workflows: {}, templates: {}, version: '3.0.0' };
      }
      const data = readFileSync(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return default store on error
  }
  return { workflows: {}, templates: {}, version: '3.0.0' };
}

function saveWorkflowStore(store: WorkflowStore): void {
  // Cap completed/failed/cancelled workflows so the file doesn't grow without
  // bound. Each save serializes the entire store to disk; without eviction
  // a long-running daemon would blow up to GBs of JSON.
  const MAX_WORKFLOWS = 500;
  const MAX_TEMPLATES = 200;
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  const finished = Object.entries(store.workflows ?? {})
    .filter(([, w]) => TERMINAL.has((w as { status?: string }).status ?? ''))
    .sort(([, a], [, b]) => {
      const aw = a as { completedAt?: string; createdAt?: string };
      const bw = b as { completedAt?: string; createdAt?: string };
      return (aw.completedAt ?? aw.createdAt ?? '').localeCompare(bw.completedAt ?? bw.createdAt ?? '');
    });
  if (finished.length > MAX_WORKFLOWS) {
    for (const [id] of finished.slice(0, finished.length - MAX_WORKFLOWS)) {
      delete store.workflows[id];
    }
  }
  const templates = Object.keys(store.templates ?? {});
  if (templates.length > MAX_TEMPLATES) {
    for (const id of templates.slice(0, templates.length - MAX_TEMPLATES)) {
      delete store.templates[id];
    }
  }
  ensureWorkflowDir();
  const dest = getWorkflowPath();
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmp, dest);
}

const FORBIDDEN_WORKFLOW_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export const workflowTools: MCPTool[] = [
  {
    name: 'workflow_run',
    description: 'Run a workflow from a template or file',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template name to run' },
        file: { type: 'string', description: 'Workflow file path' },
        task: { type: 'string', description: 'Task description' },
        options: {
          type: 'object',
          description: 'Workflow options',
          properties: {
            parallel: { type: 'boolean', description: 'Run stages in parallel' },
            maxAgents: { type: 'number', description: 'Maximum agents to use' },
            timeout: { type: 'number', description: 'Timeout in seconds' },
            dryRun: { type: 'boolean', description: 'Validate without executing' },
          },
        },
      },
    },
    handler: async (input) => {
      const store = loadWorkflowStore();
      const template = input.template as string | undefined;
      const task = input.task as string | undefined;
      const options = (input.options as Record<string, unknown>) || {};
      const dryRun = options.dryRun as boolean | undefined;

      // Build workflow from template or inline
      const workflowId = `workflow-${Date.now()}-${randomBytes(6).toString('hex')}`;
      const stages: Array<{ name: string; status: string; agents: string[]; duration?: number }> = [];

      // Generate stages based on template
      const templateName = template || 'custom';
      const stageNames: string[] = (() => {
        switch (templateName) {
          case 'feature':
            return ['Research', 'Design', 'Implement', 'Test', 'Review'];
          case 'bugfix':
            return ['Investigate', 'Fix', 'Test', 'Review'];
          case 'refactor':
            return ['Analyze', 'Refactor', 'Test', 'Review'];
          case 'security':
            return ['Scan', 'Analyze', 'Report'];
          default:
            return ['Execute'];
        }
      })();

      for (const name of stageNames) {
        stages.push({
          name,
          status: dryRun ? 'validated' : 'pending',
          agents: [],
        });
      }

      if (!dryRun) {
        // Create and save the workflow
        const steps: WorkflowStep[] = stageNames.map((name, i) => ({
          stepId: `step-${i + 1}`,
          name,
          type: 'task' as const,
          config: { task: task || name },
          status: 'pending' as const,
        }));

        const workflow: WorkflowRecord = {
          workflowId,
          name: task || `${templateName} workflow`,
          description: task,
          steps,
          status: 'running',
          currentStep: 0,
          variables: { template: templateName, ...options },
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
        };

        store.workflows[workflowId] = workflow;
        saveWorkflowStore(store);
      }

      return {
        workflowId,
        template: templateName,
        status: dryRun ? 'validated' : 'running',
        stages,
        metrics: {
          totalStages: stages.length,
          completedStages: 0,
          agentsSpawned: 0,
          estimatedDuration: `${stages.length * 30}s`,
        },
      };
    },
  },
  {
    name: 'workflow_create',
    description: 'Create a new workflow',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        description: { type: 'string', description: 'Workflow description' },
        steps: {
          type: 'array',
          description: 'Workflow steps',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['task', 'condition', 'parallel', 'loop', 'wait'] },
              config: { type: 'object' },
            },
          },
        },
        variables: { type: 'object', description: 'Initial variables' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const store = loadWorkflowStore();
      const workflowId = `workflow-${Date.now()}-${randomBytes(6).toString('hex')}`;

      const steps: WorkflowStep[] = ((input.steps as Array<{name?: string; type?: string; config?: Record<string, unknown>}>) || []).map((s, i) => ({
        stepId: `step-${i + 1}`,
        name: s.name || `Step ${i + 1}`,
        type: (s.type as WorkflowStep['type']) || 'task',
        config: s.config || {} as Record<string, unknown>,
        status: 'pending' as const,
      }));

      const workflow: WorkflowRecord = {
        workflowId,
        name: input.name as string,
        description: input.description as string,
        steps,
        status: steps.length > 0 ? 'ready' : 'draft',
        currentStep: 0,
        variables: (input.variables as Record<string, unknown>) || {},
        createdAt: new Date().toISOString(),
      };

      store.workflows[workflowId] = workflow;
      saveWorkflowStore(store);

      return {
        workflowId,
        name: workflow.name,
        status: workflow.status,
        stepCount: steps.length,
        createdAt: workflow.createdAt,
      };
    },
  },
  {
    name: 'workflow_execute',
    description: 'Execute a workflow',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID to execute' },
        variables: { type: 'object', description: 'Runtime variables to inject' },
        startFromStep: { type: 'number', description: 'Step to start from (0-indexed)' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      const workflowId = input.workflowId as string;
      if (!workflowId || typeof workflowId !== 'string' || FORBIDDEN_WORKFLOW_IDS.has(workflowId)) {
        return { workflowId, error: 'Workflow not found' };
      }
      const store = loadWorkflowStore();
      // Object.hasOwn defends against bracket-access into Object.prototype
      // members (toString, hasOwnProperty, etc.) — the FORBIDDEN_WORKFLOW_IDS
      // blocklist alone misses these inherited names.
      const workflow = Object.hasOwn(store.workflows, workflowId)
        ? store.workflows[workflowId]
        : undefined;

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }

      if (workflow.status === 'running') {
        return { workflowId, error: 'Workflow already running' };
      }

      // Inject runtime variables
      if (input.variables) {
        workflow.variables = { ...workflow.variables, ...(input.variables as Record<string, unknown>) };
      }

      workflow.status = 'running';
      workflow.startedAt = new Date().toISOString();
      workflow.currentStep = (input.startFromStep as number) || 0;

      // Set steps to pending — actual execution requires agent assignment via task tools
      const results: Array<{ stepId: string; status: string; _note: string }> = [];
      for (let i = workflow.currentStep; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        step.status = 'pending';

        results.push({
          stepId: step.stepId,
          status: step.status,
          _note: 'Workflow execution tracks state. Actual step execution requires agent assignment via task tools.',
        });
      }

      saveWorkflowStore(store);

      return {
        workflowId,
        status: workflow.status,
        totalSteps: results.length,
        results,
        startedAt: workflow.startedAt,
        _note: 'Workflow is now running. Steps are in pending state and must be executed via task tools.',
      };
    },
  },
  {
    name: 'workflow_status',
    description: 'Get workflow status',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
        verbose: { type: 'boolean', description: 'Include step details' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      const workflowId = input.workflowId as string;
      if (!workflowId || typeof workflowId !== 'string' || FORBIDDEN_WORKFLOW_IDS.has(workflowId)) {
        return { workflowId, error: 'Workflow not found' };
      }
      const store = loadWorkflowStore();
      const workflow = Object.hasOwn(store.workflows, workflowId) ? store.workflows[workflowId] : undefined;

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }

      const completedSteps = workflow.steps.filter(s => s.status === 'completed').length;
      const progress = workflow.steps.length > 0 ? (completedSteps / workflow.steps.length) * 100 : 0;

      const status = {
        workflowId: workflow.workflowId,
        name: workflow.name,
        status: workflow.status,
        progress,
        currentStep: workflow.currentStep,
        totalSteps: workflow.steps.length,
        completedSteps,
        createdAt: workflow.createdAt,
        startedAt: workflow.startedAt,
        completedAt: workflow.completedAt,
      };

      if (input.verbose) {
        return {
          ...status,
          description: workflow.description,
          variables: workflow.variables,
          steps: workflow.steps.map(s => ({
            stepId: s.stepId,
            name: s.name,
            type: s.type,
            status: s.status,
            startedAt: s.startedAt,
            completedAt: s.completedAt,
          })),
          error: workflow.error,
        };
      }

      return status;
    },
  },
  {
    name: 'workflow_list',
    description: 'List all workflows',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status' },
        limit: { type: 'number', description: 'Max workflows to return' },
      },
    },
    handler: async (input) => {
      const store = loadWorkflowStore();
      let workflows = Object.values(store.workflows);

      // Apply filters
      if (input.status) {
        workflows = workflows.filter(w => w.status === input.status);
      }

      // Sort by creation date (newest first)
      workflows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Apply limit
      const limit = (input.limit as number) || 20;
      const totalCount = workflows.length;
      workflows = workflows.slice(0, limit);

      return {
        workflows: workflows.map(w => ({
          workflowId: w.workflowId,
          name: w.name,
          status: w.status,
          stepCount: w.steps.length,
          createdAt: w.createdAt,
          completedAt: w.completedAt,
        })),
        total: totalCount,
        filters: { status: input.status },
      };
    },
  },
  {
    name: 'workflow_pause',
    description: 'Pause a running workflow',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      const workflowId = input.workflowId as string;
      if (!workflowId || typeof workflowId !== 'string' || FORBIDDEN_WORKFLOW_IDS.has(workflowId)) {
        return { workflowId, error: 'Workflow not found' };
      }
      const store = loadWorkflowStore();
      const workflow = Object.hasOwn(store.workflows, workflowId) ? store.workflows[workflowId] : undefined;

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }

      if (workflow.status !== 'running') {
        return { workflowId, error: 'Workflow not running' };
      }

      workflow.status = 'paused';
      saveWorkflowStore(store);

      return {
        workflowId,
        status: workflow.status,
        pausedAt: new Date().toISOString(),
        currentStep: workflow.currentStep,
      };
    },
  },
  {
    name: 'workflow_resume',
    description: 'Resume a paused workflow',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      const workflowId = input.workflowId as string;
      if (!workflowId || typeof workflowId !== 'string' || FORBIDDEN_WORKFLOW_IDS.has(workflowId)) {
        return { workflowId, error: 'Workflow not found' };
      }
      const store = loadWorkflowStore();
      const workflow = Object.hasOwn(store.workflows, workflowId) ? store.workflows[workflowId] : undefined;

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }

      if (workflow.status !== 'paused') {
        return { workflowId, error: 'Workflow not paused' };
      }

      workflow.status = 'running';
      saveWorkflowStore(store);

      // Report current step states — do not auto-complete them
      const stepStates = workflow.steps.map(step => ({
        stepId: step.stepId,
        name: step.name,
        status: step.status,
      }));

      const remainingSteps = workflow.steps.length - workflow.currentStep;

      return {
        workflowId,
        status: workflow.status,
        resumed: true,
        currentStep: workflow.currentStep,
        remainingSteps,
        steps: stepStates,
        _note: 'Workflow resumed. Steps remain in their current state and must be executed via task tools.',
      };
    },
  },
  {
    name: 'workflow_cancel',
    description: 'Cancel a workflow',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
        reason: { type: 'string', description: 'Cancellation reason' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      const workflowId = input.workflowId as string;
      if (!workflowId || typeof workflowId !== 'string' || FORBIDDEN_WORKFLOW_IDS.has(workflowId)) {
        return { workflowId, error: 'Workflow not found' };
      }
      const store = loadWorkflowStore();
      const workflow = Object.hasOwn(store.workflows, workflowId)
        ? store.workflows[workflowId]
        : undefined;

      if (!workflow) {
        return { workflowId, error: 'Workflow not found' };
      }

      if (workflow.status === 'completed' || workflow.status === 'failed' || workflow.status === 'cancelled') {
        return { workflowId, error: 'Workflow already finished' };
      }

      workflow.status = 'cancelled';
      workflow.error = (input.reason as string) || 'Cancelled by user';
      workflow.completedAt = new Date().toISOString();

      // Mark remaining steps as skipped
      for (let i = workflow.currentStep; i < workflow.steps.length; i++) {
        workflow.steps[i].status = 'skipped';
      }

      saveWorkflowStore(store);

      return {
        workflowId,
        status: workflow.status,
        cancelledAt: workflow.completedAt,
        reason: workflow.error,
        skippedSteps: workflow.steps.length - workflow.currentStep,
      };
    },
  },
  {
    name: 'workflow_delete',
    description: 'Delete a workflow',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
      },
      required: ['workflowId'],
    },
    handler: async (input) => {
      const workflowId = input.workflowId as string;
      if (!workflowId || typeof workflowId !== 'string' || FORBIDDEN_WORKFLOW_IDS.has(workflowId)) {
        return { workflowId, error: 'Workflow not found' };
      }
      const store = loadWorkflowStore();
      if (!Object.hasOwn(store.workflows, workflowId)) {
        return { workflowId, error: 'Workflow not found' };
      }

      const workflow = store.workflows[workflowId];
      if (workflow.status === 'running') {
        return { workflowId, error: 'Cannot delete running workflow' };
      }

      delete store.workflows[workflowId];
      saveWorkflowStore(store);

      return {
        workflowId,
        deleted: true,
        deletedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: 'workflow_template',
    description: 'Save workflow as template or create from template',
    category: 'workflow',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'create', 'list'], description: 'Template action' },
        workflowId: { type: 'string', description: 'Workflow ID (for save)' },
        templateId: { type: 'string', description: 'Template ID (for create)' },
        templateName: { type: 'string', description: 'Template name (for save)' },
        newName: { type: 'string', description: 'New workflow name (for create)' },
      },
      required: ['action'],
    },
    handler: async (input) => {
      const store = loadWorkflowStore();
      const action = input.action as string;

      if (action === 'save') {
        const rawWorkflowId = input.workflowId as string;
        if (!rawWorkflowId || typeof rawWorkflowId !== 'string' || FORBIDDEN_WORKFLOW_IDS.has(rawWorkflowId) || !Object.hasOwn(store.workflows, rawWorkflowId)) {
          return { action, error: 'Workflow not found' };
        }
        const workflow = store.workflows[rawWorkflowId];
        if (!workflow) {
          return { action, error: 'Workflow not found' };
        }

        const templateId = `template-${Date.now()}-${randomBytes(6).toString('hex')}`;
        const template: WorkflowRecord = {
          ...workflow,
          workflowId: templateId,
          name: (input.templateName as string) || `${workflow.name} Template`,
          status: 'draft',
          currentStep: 0,
          createdAt: new Date().toISOString(),
          startedAt: undefined,
          completedAt: undefined,
        };

        // Reset step statuses
        template.steps = template.steps.map(s => ({
          ...s,
          status: 'pending',
          result: undefined,
          startedAt: undefined,
          completedAt: undefined,
        }));

        store.templates[templateId] = template;
        saveWorkflowStore(store);

        return {
          action,
          templateId,
          name: template.name,
          savedAt: new Date().toISOString(),
        };
      }

      if (action === 'create') {
        const rawTemplateId = input.templateId as string;
        if (!rawTemplateId || typeof rawTemplateId !== 'string' || FORBIDDEN_WORKFLOW_IDS.has(rawTemplateId) || !Object.hasOwn(store.templates, rawTemplateId)) {
          return { action, error: 'Template not found' };
        }
        const template = store.templates[rawTemplateId];
        if (!template) {
          return { action, error: 'Template not found' };
        }

        const workflowId = `workflow-${Date.now()}-${randomBytes(6).toString('hex')}`;
        const workflow: WorkflowRecord = {
          ...template,
          workflowId,
          name: (input.newName as string) || template.name.replace(' Template', ''),
          status: 'ready',
          createdAt: new Date().toISOString(),
          steps: template.steps.map(s => ({ ...s, status: 'pending' as const, result: undefined })),
          variables: { ...template.variables },
        };

        store.workflows[workflowId] = workflow;
        saveWorkflowStore(store);

        return {
          action,
          workflowId,
          name: workflow.name,
          fromTemplate: input.templateId,
          createdAt: workflow.createdAt,
        };
      }

      if (action === 'list') {
        return {
          action,
          templates: Object.values(store.templates).map(t => ({
            templateId: t.workflowId,
            name: t.name,
            stepCount: t.steps.length,
            createdAt: t.createdAt,
          })),
          total: Object.keys(store.templates).length,
        };
      }

      return { action, error: 'Unknown action' };
    },
  },
];
