// packages/@monomind/cli/__tests__/orgrt/unification-passthrough.test.ts
/**
 * Org × Workflow unification — "All M-series" passthrough contract (C-13):
 * an org JSON carrying every key mono-agent writes (`automations`,
 * `tool_providers`, `kind`, `endpoint`, `children`, `federation`, `autonomy`)
 * survives OrgDefSchema.parse and `org validate` unchanged.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateAction } from '../../src/commands/org-observe.js';
import { checkOrgStructure } from '../../src/orgrt/migrate.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';
import type { CommandContext } from '../../src/types.js';

const ORG = {
  name: 'hq',
  goal: 'run the group',
  status: 'stopped',
  schedule: null,
  federation: { allow_from: ['sales'], allow_to: ['*'] },
  children: [
    { org: 'sales', start: 'on_demand', budget_share: 0.4, initiator: 'ceo' },
    { org: 'growth', start: 'with_parent', budget_share: 0.3 },
  ],
  autonomy: {
    level: 'mid',
    decider: { kind: 'model', model: 'claude-haiku', fallback: 'model', timeout_seconds: 120 },
    tiers: { 'grant:*': 'consequential', org_start: 'consequential' },
    policy: 'Approve routine publishing.',
    on_decider_failure: 'deny',
    limits: { max_decisions_per_run: 50, max_decider_usd_per_run: 2 },
  },
  roles: [
    {
      id: 'ceo',
      title: 'CEO',
      type: 'boss',
      reports_to: null,
      responsibilities: ['[managed:report-up] report to hq'],
      policy: {
        denyTools: ['Bash'],
        approvalTools: ['monoagent__automation_publish_post', 'monoagent__org_start'],
        autoApproveTools: [],
      },
      automations: [
        {
          alias: 'publish_post',
          mode: 'run',
          wait: true,
          timeout_seconds: 600,
          approval: 'required',
          input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          max_calls_per_run: 20,
          max_calls_per_day: 200,
          max_output_bytes: 16384,
        },
      ],
      tool_providers: [
        {
          kind: 'mcp-stdio',
          name: 'monoagent',
          prefix: 'monoagent',
          command: '/usr/local/bin/monoagentcli',
          args: ['mcp', '--grant', 'grt_01', '--profile', 'default'],
          env: {},
          allow: ['automation_publish_post', 'automation_status', 'automation_output', 'org_start'],
          timeout_ms: 630000,
          idle_ms: 300000,
        },
      ],
    },
    {
      id: 'publisher-bot',
      title: 'Publisher',
      kind: 'endpoint',
      type: 'automation',
      reports_to: 'ceo',
      endpoint: {
        url: 'http://127.0.0.1:9322/org-endpoint/ep_abcdefghijklmnopqrstuvwxyz',
        input_hint: 'Body: the post text.',
      },
      automation: { workflow_id: 'wf_123', reply: 'last_node', alias: 'publisher' },
    },
  ],
};

describe('unification keys survive parse and org validate (passthrough)', () => {
  it('OrgDefSchema.parse keeps every mono-agent key and value', () => {
    const def = OrgDefSchema.parse(structuredClone(ORG)) as Record<string, unknown>;
    expect(def).toMatchObject(ORG);
    for (const key of ['federation', 'children', 'autonomy']) expect(def[key]).toEqual((ORG as any)[key]);
    const [ceo, bot] = def.roles as Array<Record<string, unknown>>;
    expect(ceo.automations).toEqual(ORG.roles[0].automations);
    expect(ceo.tool_providers).toEqual(ORG.roles[0].tool_providers);
    expect(ceo.policy).toMatchObject(ORG.roles[0].policy!);
    expect(bot.kind).toBe('endpoint');
    expect(bot.endpoint).toEqual(ORG.roles[1].endpoint);
    expect(bot.automation).toEqual(ORG.roles[1].automation);
    // a parse → serialize → parse round trip is stable
    expect(OrgDefSchema.parse(JSON.parse(JSON.stringify(def)))).toEqual(def);
    expect(checkOrgStructure(def as any)).toEqual([]);
  });

  it('`org validate` accepts it and leaves the file byte-for-byte unchanged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'unify-pass-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    const file = join(root, '.monomind/orgs/hq.json');
    const raw = `${JSON.stringify(ORG, null, 2)}\n`;
    writeFileSync(file, raw);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await validateAction({ args: ['hq'], flags: { _: [] }, cwd: root, interactive: false } as CommandContext);
      expect(res).toMatchObject({ success: true });
      expect(readFileSync(file, 'utf8')).toBe(raw);
    } finally {
      spy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
