// packages/@monomind/cli/__tests__/orgrt/prompt-vars.test.ts
// S3: tracked org configs must not publish the owner's machine layout, so role
// responsibilities reference {{org_root}} / {{home}} and the runtime expands
// them when the role prompt is built.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import {
  expandPromptVars,
  expandRolePromptVars,
  promptVarsFor,
  unknownPromptVarErrors,
} from '../../src/orgrt/prompt-vars.js';
import { buildRolePrompt, runAgentSession } from '../../src/orgrt/session.js';
import type { OrgDef, OrgRole } from '../../src/orgrt/types.js';

const vars = { org_root: '/home/alice/src/repo', home: '/home/alice' };

describe('expandPromptVars', () => {
  it('replaces every occurrence of each known placeholder', () => {
    expect(expandPromptVars('REPO={{org_root}}; cd {{org_root}}/x; HOME={{home}}', vars)).toBe(
      'REPO=/home/alice/src/repo; cd /home/alice/src/repo/x; HOME=/home/alice',
    );
  });

  it('leaves unknown placeholders and non-placeholder braces untouched', () => {
    const text = 'a {{repo_rot}} b {{ home }} c {{HOME}} d ${home} e {home}';
    expect(expandPromptVars(text, vars)).toBe(text);
  });

  it('returns the identical string when there is nothing to expand', () => {
    const text = 'no placeholders here, /home/bob stays literal';
    expect(expandPromptVars(text, vars)).toBe(text);
  });
});

describe('promptVarsFor', () => {
  it('maps org_root to the org root and home to the given home dir', () => {
    expect(promptVarsFor('/r', '/h')).toEqual({ org_root: '/r', home: '/h' });
  });
});

const role = (responsibilities?: string[]): OrgRole =>
  ({
    id: 'dev',
    title: 'Dev',
    type: 'specialist',
    reports_to: 'lead',
    responsibilities,
  }) as OrgRole;
const def = { name: 'o', goal: 'g' } as Pick<OrgDef, 'name' | 'goal'>;

describe('expandRolePromptVars', () => {
  it('returns the same role object when no responsibility has a placeholder', () => {
    const r = role(['plain duty', 'TMPDIR=/home/alice/tmp literal']);
    expect(expandRolePromptVars(r, vars)).toBe(r);
    const none = role(undefined);
    expect(expandRolePromptVars(none, vars)).toBe(none);
  });

  it('does not mutate the input role', () => {
    const r = role(['cd {{org_root}}']);
    const out = expandRolePromptVars(r, vars);
    expect(out.responsibilities).toEqual(['cd /home/alice/src/repo']);
    expect(r.responsibilities).toEqual(['cd {{org_root}}']);
  });

  it('keeps buildRolePrompt byte-identical for a config without placeholders', () => {
    const r = role(['plain duty', 'second duty with /abs/path']);
    expect(buildRolePrompt(expandRolePromptVars(r, vars), def, ['lead', 'dev'])).toBe(
      buildRolePrompt(r, def, ['lead', 'dev']),
    );
  });

  it('yields the old literal prompt when org_root/home equal the old paths', () => {
    // Excerpt of monomind-dev's rewritten COMMON RULES / SETUP lines.
    const oldRoot = '/home/monoes/projects/monoes/monomind';
    const oldHome = '/home/monoes';
    const literal = role([
      `REPO=${oldRoot} (the main checkout). TMPDIR=${oldHome}/mdev-tmp; fake HOMEs go in ${oldHome}/mdev-tmp/<item-id>-<check>.`,
      `git -C ${oldRoot} worktree add -b sync/main-VERSION ${oldRoot}-sync-VERSION main; live trials use the real HOME=${oldHome} (logins live there).`,
    ]);
    const templated = role([
      'REPO={{org_root}} (the main checkout). TMPDIR={{home}}/mdev-tmp; fake HOMEs go in {{home}}/mdev-tmp/<item-id>-<check>.',
      'git -C {{org_root}} worktree add -b sync/main-VERSION {{org_root}}-sync-VERSION main; live trials use the real HOME={{home}} (logins live there).',
    ]);
    expect(
      buildRolePrompt(
        expandRolePromptVars(templated, promptVarsFor(oldRoot, oldHome)),
        def,
        ['lead', 'dev'],
      ),
    ).toBe(buildRolePrompt(literal, def, ['lead', 'dev']));
  });
});

describe('unknownPromptVarErrors', () => {
  it('reports each unknown placeholder with its role', () => {
    const d = {
      roles: [role(['ok {{org_root}} {{home}}']), { ...role(['bad {{repo_rot}}']), id: 'qa' }],
    } as unknown as OrgDef;
    expect(unknownPromptVarErrors(d)).toEqual([
      'role "qa": unknown placeholder {{repo_rot}} in responsibilities (known: {{org_root}}, {{home}})',
    ]);
  });

  it('is empty for a config without placeholders', () => {
    expect(unknownPromptVarErrors({ roles: [role(['x']), role(undefined)] } as unknown as OrgDef)).toEqual([]);
  });
});

describe('runAgentSession system prompt', () => {
  const runWith = async (responsibilities: string[], orgRoot?: string): Promise<string> => {
    const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'pvars-')));
    const mailbox = new Mailbox();
    mailbox.push('go');
    mailbox.close();
    let systemPrompt = '';
    const fakeQuery = ({ prompt, options }: any) =>
      (async function* () {
        systemPrompt = options.systemPrompt;
        for await (const _ of prompt) break;
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    await runAgentSession({
      org: 'o',
      role: role(responsibilities),
      bus,
      policy: new PolicyEngine('dev', {}, bus, '/work'),
      mailbox,
      cwd: '/work/wt',
      orgRoot,
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    });
    return systemPrompt;
  };

  it('expands {{org_root}} from the org root, not the role cwd', async () => {
    const prompt = await runWith(['REPO={{org_root}}'], '/srv/proj');
    expect(prompt).toContain('REPO=/srv/proj');
    expect(prompt).not.toContain('{{org_root}}');
  });

  it('matches buildRolePrompt exactly for a role without placeholders', async () => {
    const duties = ['plain duty /home/x literal'];
    const prompt = await runWith(duties, '/srv/proj');
    expect(prompt).toBe(buildRolePrompt(role(duties), { name: 'o', goal: '' }, ['dev']));
  });
});
