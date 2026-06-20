import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readWorkflow, writeRunRecord, listRuns, readAction, clearRunStore } from '../browser/workflow/store.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WorkflowDef, RunRecord } from '../browser/workflow/types.js';
import type { ActionDef } from '../browser/action-builder/types.js';

const TMP = join(tmpdir(), 'browse-store-test-' + Date.now());

beforeEach(() => {
  clearRunStore();
  mkdirSync(join(TMP, 'workflows'), { recursive: true });
  mkdirSync(join(TMP, 'actions'), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('readWorkflow', () => {
  it('parses a valid workflow JSON file', async () => {
    const wf: WorkflowDef = {
      id: 'test-wf',
      name: 'Test Workflow',
      nodes: [{ id: 'trigger', type: 'trigger.manual', config: {} }],
      connections: [],
    };
    const p = join(TMP, 'workflows', 'test.json');
    writeFileSync(p, JSON.stringify(wf));
    const result = await readWorkflow(p);
    expect(result.id).toBe('test-wf');
    expect(result.nodes).toHaveLength(1);
  });

  it('throws on missing file', async () => {
    await expect(readWorkflow(join(TMP, 'nonexistent.json'))).rejects.toThrow();
  });

  it('throws on invalid JSON', async () => {
    const p = join(TMP, 'workflows', 'bad.json');
    writeFileSync(p, 'not json');
    await expect(readWorkflow(p)).rejects.toThrow();
  });

  it('throws if nodes array is missing', async () => {
    const p = join(TMP, 'workflows', 'no-nodes.json');
    writeFileSync(p, JSON.stringify({ id: 'x', name: 'y', connections: [] }));
    await expect(readWorkflow(p)).rejects.toThrow('nodes');
  });
});

describe('readAction', () => {
  it('parses a valid action JSON file', async () => {
    const action: ActionDef = {
      id: 'linkedin:comment_post',
      platform: 'linkedin',
      name: 'Comment on Post',
      params: ['post_url', 'text'],
      steps: [],
    };
    const p = join(TMP, 'actions', 'comment.json');
    writeFileSync(p, JSON.stringify(action));
    const result = await readAction(p);
    expect(result.id).toBe('linkedin:comment_post');
    expect(result.params).toContain('post_url');
  });

  it('throws on missing action file', async () => {
    await expect(readAction(join(TMP, 'actions', 'nonexistent.json'))).rejects.toThrow();
  });

  it('throws on invalid action JSON', async () => {
    const p = join(TMP, 'actions', 'bad.json');
    writeFileSync(p, 'not json');
    await expect(readAction(p)).rejects.toThrow();
  });

  it('throws if action steps array is missing', async () => {
    const p = join(TMP, 'actions', 'no-steps.json');
    writeFileSync(p, JSON.stringify({ id: 'x', platform: 'y', name: 'z', params: [] }));
    await expect(readAction(p)).rejects.toThrow('steps');
  });
});

describe('writeRunRecord + listRuns', () => {
  it('stores and retrieves run records', async () => {
    const record: RunRecord = {
      id: 'run-1',
      workflowId: 'wf-1',
      workflowName: 'Test WF',
      status: 'completed',
      startedAt: Date.now(),
      completedAt: Date.now() + 1000,
      itemsProcessed: 5,
      itemsTotal: 5,
    };
    await writeRunRecord(record);
    const runs = await listRuns();
    const found = runs.find(r => r.id === 'run-1');
    expect(found).toBeDefined();
    expect(found?.status).toBe('completed');
  });

  it('filters runs by workflowId', async () => {
    const r1: RunRecord = { id: 'r1', workflowId: 'wf-a', workflowName: 'A', status: 'completed', startedAt: 1, itemsProcessed: 1, itemsTotal: 1 };
    const r2: RunRecord = { id: 'r2', workflowId: 'wf-b', workflowName: 'B', status: 'failed', startedAt: 2, itemsProcessed: 0, itemsTotal: 1 };
    await writeRunRecord(r1);
    await writeRunRecord(r2);
    const runs = await listRuns('wf-a');
    expect(runs.every(r => r.workflowId === 'wf-a')).toBe(true);
  });
});
