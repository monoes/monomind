/**
 * Graph engineering playbook improvement #7 — org templates.
 */

import { describe, expect, it } from 'vitest';
import { roleRunSpec } from '../../packages/@monomind/cli/src/orgrt/role-run-spec.js';
import {
  buildFromTemplate,
  ORG_TEMPLATES,
} from '../../packages/@monomind/cli/src/orgrt/templates.js';
import { checklistFindings } from '../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
import { defaultClaudeModel } from '../../packages/@monomind/cli/src/orgrt/vercel-providers.js';

describe('kg-extraction template — multi-agent KG pipeline', () => {
  it('is registered in ORG_TEMPLATES', () => {
    expect(ORG_TEMPLATES['kg-extraction']).toBeTruthy();
  });

  it('builds a valid OrgDef with four roles', () => {
    const def = buildFromTemplate('kg-extraction', 'my-kg');
    expect(def).not.toBeNull();
    expect(def?.name).toBe('my-kg');
    expect(def?.roles).toHaveLength(4);
    expect(def?.goal).toContain('knowledge graph');
  });

  it('has exactly one boss (kg-lead) and three specialists reporting to it', () => {
    const def = buildFromTemplate('kg-extraction', 'my-kg')!;
    const boss = def.roles.find((r) => r.type === 'boss');
    expect(boss?.id).toBe('kg-lead');
    const specialists = def.roles.filter((r) => r.reports_to === 'kg-lead');
    expect(specialists.map((r) => r.id).sort()).toEqual([
      'entity-extractor',
      'ontology-validator',
      'relationship-resolver',
    ]);
  });

  it('honors a user-supplied goal', () => {
    const def = buildFromTemplate('kg-extraction', 'my-kg', 'Custom extraction goal');
    expect(def?.goal).toBe('Custom extraction goal');
  });
});

describe('advisor-orchestrator template — cost-efficient planner + workers', () => {
  it('is registered in ORG_TEMPLATES', () => {
    expect(ORG_TEMPLATES['advisor-orchestrator']).toBeTruthy();
  });

  it('builds a valid OrgDef with one advisor and two workers', () => {
    const def = buildFromTemplate('advisor-orchestrator', 'my-advisor');
    expect(def).not.toBeNull();
    expect(def?.roles).toHaveLength(3);
    const advisor = def?.roles.find((r) => r.id === 'advisor');
    expect(advisor?.type).toBe('boss');
    expect(advisor?.reports_to).toBeNull();
  });

  it('the advisor runs on the newest default model (unpinned); workers are pinned to the fast model', () => {
    const def = buildFromTemplate('advisor-orchestrator', 'my-advisor')!;
    const advisor = def?.roles.find((r) => r.id === 'advisor')!;
    const worker = def?.roles.find((r) => r.id === 'worker-1')!;
    expect(advisor.adapter_config?.model).toBeUndefined();
    expect(roleRunSpec(def, advisor).model).toBe(defaultClaudeModel());
    expect(worker.adapter_config?.model).toBeTruthy();
    expect(worker.adapter_config?.model).not.toBe(roleRunSpec(def, advisor).model);
  });
});

describe('All templates — schema validity', () => {
  it('every registered template produces a schema-valid OrgDef', () => {
    for (const name of Object.keys(ORG_TEMPLATES)) {
      const def = buildFromTemplate(name, `test-${name}`);
      expect(def, `template "${name}" should build`).not.toBeNull();
      expect(def?.roles.length, `template "${name}" needs at least one role`).toBeGreaterThan(0);
    }
  });

  it('a role pins a model only when its template hints one; every other role resolves the newest default', () => {
    for (const [name, template] of Object.entries(ORG_TEMPLATES)) {
      const def = buildFromTemplate(name, `test-${name}`)!;
      for (const role of def.roles) {
        const hint = template.roles.find((r) => r.id === role.id)?.model;
        expect(role.adapter_config?.model, `${name}/${role.id}`).toBe(hint);
        expect(roleRunSpec(def, role).model, `${name}/${role.id}`).toBe(
          hint ?? defaultClaudeModel(),
        );
      }
    }
  });

  it('run_config fits the roster: every role can run at once, with a real token share each', () => {
    for (const name of Object.keys(ORG_TEMPLATES)) {
      const def = buildFromTemplate(name, `test-${name}`)!;
      expect(def.run_config.max_concurrent_agents, name).toBe(def.roles.length);
      expect(def.run_config.budget_tokens, name).toBe(def.roles.length * 1_000_000);
      const { errors, warnings } = checklistFindings(def);
      expect(errors, name).toEqual([]);
      expect(
        warnings.filter((w) => /#3 |#23/.test(w)),
        name,
      ).toEqual([]);
    }
  });
});
