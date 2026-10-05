import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ClaudeAgentRunner } from '../../src/orgrt/agent-runner.js';
import { buildOrgTools } from '../../src/orgrt/org-tools.js';
import { MAX_TASK_BRIEF } from '../../src/orgrt/task-dag.js';
import { allCallbacks, listServerTools, parseVariant, sessionOpts, VARIANTS } from './support/golden-variants.js';

/** A newer SDK must preserve the constraints in our public Zod tool schemas.
 * SDK 0.3.226 omitted these checks from tools/list; 0.3.289 emits them. */
describe('Claude SDK schema compatibility', () => {
  it('advertises the same bounds and integer rules that handlers validate', async () => {
    const def = parseVariant(VARIANTS[0]);
    const tools = buildOrgTools(sessionOpts(def, def.roles[0], { ...allCallbacks(), documents: { role: 'boss', list: () => ({ ok: true }), read: () => ({ ok: true }), publish: () => ({ ok: true }), decide: () => ({ ok: true }), check: () => ({ ok: true }) } as any }));
    let server: unknown;
    const query = ({ options }: any) => (async function* () {
      server = options.mcpServers.org;
      yield { type: 'result', subtype: 'success' };
    })();
    for await (const _ of new ClaudeAgentRunner(query as any).run({
      tools, prompt: (async function* () {})(), systemPrompt: '', cwd: '/work', env: {}, maxTurns: 5,
    })) { /* Capture the actual server hosted by the runner. */ }
    const schemas = Object.fromEntries((await listServerTools(server)).map((t) => [t.name, t.inputSchema])) as Record<string, any>;
    const source = (name: string) => z.object(tools.find((t) => t.name === name)!.schema);

    expect(schemas.org_task.properties.brief.maxLength).toBe(MAX_TASK_BRIEF);
    expect(source('org_task').safeParse({ title: 'task', assignee: 'dev', brief: 'x'.repeat(MAX_TASK_BRIEF + 1) }).success).toBe(false);
    expect(schemas.org_task_split.properties.children.minItems).toBe(1);
    expect(source('org_task_split').safeParse({ parentId: 'p', children: [] }).success).toBe(false);
    expect(schemas.org_plan_graph.properties.tasks.minItems).toBe(1);
    expect(source('org_plan_graph').safeParse({ tasks: [] }).success).toBe(false);
    expect(schemas.org_plan_graph.properties.tasks.items.properties.brief.maxLength).toBe(MAX_TASK_BRIEF);
    expect(schemas.org_task_block.properties.recheckAfterMinutes).toMatchObject({ type: 'number', exclusiveMinimum: 0, maximum: 60 });
    for (const recheckAfterMinutes of [0, 61]) expect(source('org_task_block').safeParse({ taskId: 't', untilIso: 'tomorrow', recheckAfterMinutes }).success).toBe(false);
    const check = schemas.org_task_done.properties.evidence.properties.checks.items;
    for (const key of ['exitCode', 'expectExit']) expect(check.properties[key]).toMatchObject({ type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER });
    expect(source('org_task_done').safeParse({ taskId: 't', evidence: { headSha: 'abc', checks: [{ command: 'test', exitCode: 0.5 }] } }).success).toBe(false);
    expect(schemas.org_review.properties.base.description).toBe("git ref to diff against (default 'main')");
    expect(schemas.org_task.required).toEqual(['title', 'assignee']);
    expect(schemas.org_task.properties.deps.default).toEqual([]);
    expect(check.additionalProperties).toBe(false);
    expect(schemas.org_doc_read.properties.id).toMatchObject({ minLength: 1, maxLength: 120 });
    expect(schemas.org_doc_read.properties.part).toMatchObject({ type: 'integer', exclusiveMinimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    expect(schemas.org_doc_publish.properties.evidence.maxItems).toBe(256);
    expect(schemas.org_doc_publish.properties.type).toMatchObject({ minLength: 1, maxLength: 80 });
    expect(schemas.org_doc_decide.properties.idempotency_key).toMatchObject({ minLength: 1, maxLength: 200 });
    expect(schemas.org_doc_decide.properties.expected_state_seq).toMatchObject({ type: 'integer', minimum: 0 });
    expect(source('org_doc_read').safeParse({ id: 'x'.repeat(121) }).success).toBe(false);
    expect(source('org_doc_read').safeParse({ id: 'doc', part: 0 }).success).toBe(false);
    expect(source('org_doc_check').safeParse({ id: 'doc', part: 1.5 }).success).toBe(false);
  });
});
