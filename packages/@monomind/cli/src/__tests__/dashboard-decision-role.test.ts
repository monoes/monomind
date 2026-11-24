/**
 * #835 PR 9: the agent drawer shows a decision role's kind, provider, threshold and fallback
 * instead of the empty runtime/model/budget editor an agent gets.
 */
import { describe, expect, it } from 'vitest';
import { dashboardScript, loadPageFunctions } from './dashboard-script.js';

const role = {
  id: 'triage',
  kind: 'decision',
  reports_to: 'lead',
  decision: {
    provider: 'local',
    model: 'qwen2.5',
    question: 'choice',
    criteria: { approve: 'ok', deny: 'no' },
    threshold: 0.7,
    fallback_role: 'lead',
  },
};

describe('role drawer for a decision role', () => {
  const ctx = loadPageFunctions(dashboardScript, ['_v2RoleEditorHtml', 'esc']);

  it('shows kind, provider, model, question, options, threshold and fallback', () => {
    const html: string = ctx._v2RoleEditorHtml(role);
    for (const text of [
      'Decision settings',
      'decision',
      'local',
      'qwen2.5',
      'choice',
      'approve, deny',
      '0.7',
      'lead',
    ])
      expect(html).toContain(text);
  });

  it('has no runtime, model or budget editor fields', () => {
    const html: string = ctx._v2RoleEditorHtml(role);
    expect(html).not.toContain('id="re-runtime"');
    expect(html).not.toContain('id="re-model"');
  });

  it('escapes provider text', () => {
    const html: string = ctx._v2RoleEditorHtml({
      ...role,
      decision: { ...role.decision, provider: '<img onerror=x>' },
    });
    expect(html).not.toContain('<img');
  });
});
