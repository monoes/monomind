// packages/@monomind/cli/__tests__/orgrt/prompt-vars.test.ts
// S3: tracked org configs must not publish the owner's machine layout, so role
// responsibilities reference {{org_root}} / {{home}} and the runtime expands
// them when the role prompt is built.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { fileToolRoots } from '../../src/orgrt/file-roots.js';
import { prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import {
  expandOrgPolicyPathVars,
  expandPromptVars,
  expandRolePolicyPathVars,
  expandRolePromptVars,
  promptVarsFor,
  unknownPromptVarErrors,
} from '../../src/orgrt/prompt-vars.js';
import { buildClaudeRestrictions, sandboxAvailability } from '../../src/orgrt/role-sandbox.js';
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
    const oldRoot = '/home/owner/projects/monomind';
    const oldHome = '/home/owner';
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

// #6: policy paths take the same placeholders, so tracked config can grant
// {{home}}/scratch without hard-coding the owner's home directory.
describe('policy path placeholders', () => {
  const withPolicy = (policy: Record<string, unknown>) => ({ ...role(['x']), policy }) as OrgRole;

  it('expands fileRead/fileWrite and sandbox.allowWrite/denyWrite, leaving everything else alone', () => {
    const r = withPolicy({
      git: 'read',
      fileRead: ['{{org_root}}/**', 'src/**'],
      fileWrite: ['{{home}}/scratch/**'],
      sandbox: { mode: 'auto', allowWrite: ['{{home}}/monomind-release'], denyWrite: ['{{org_root}}/docs', '.'] },
    });
    const out = expandRolePolicyPathVars(r, vars);
    expect(out.policy).toEqual({
      git: 'read',
      fileRead: ['/home/alice/src/repo/**', 'src/**'],
      fileWrite: ['/home/alice/scratch/**'],
      sandbox: { mode: 'auto', allowWrite: ['/home/alice/monomind-release'], denyWrite: ['/home/alice/src/repo/docs', '.'] },
    });
    expect((r.policy as any).sandbox.allowWrite).toEqual(['{{home}}/monomind-release']);
  });

  it('returns the same role, and the same org, when no policy path has a placeholder', () => {
    const r = withPolicy({ fileRead: ['**'], sandbox: { allowWrite: ['/abs'] } });
    expect(expandRolePolicyPathVars(r, vars)).toBe(r);
    expect(expandRolePolicyPathVars(role(['{{home}} in a duty only']), vars).policy).toBeUndefined();
    const d = { roles: [r] } as unknown as OrgDef;
    expect(expandOrgPolicyPathVars(d, vars)).toBe(d);
  });

  it('keeps an unknown placeholder verbatim and org validate names the field', () => {
    const r = withPolicy({ sandbox: { allowWrite: ['{{hom}}/x'] }, fileWrite: ['{{tmp}}/**'] });
    expect((expandRolePolicyPathVars(r, vars).policy as any).sandbox.allowWrite).toEqual(['{{hom}}/x']);
    expect(unknownPromptVarErrors({ roles: [r] } as unknown as OrgDef)).toEqual([
      'role "dev": unknown placeholder {{tmp}} in policy.fileWrite (known: {{org_root}}, {{home}})',
      'role "dev": unknown placeholder {{hom}} in policy.sandbox.allowWrite (known: {{org_root}}, {{home}})',
    ]);
  });

  it('the expanded paths reach fileToolRoots and the OS sandbox', () => {
    const root = mkdtempSync(join(tmpdir(), 'pvars-root-'));
    const home = mkdtempSync(join(tmpdir(), 'pvars-home-'));
    mkdirSync(join(root, 'docs'));
    const r = expandRolePolicyPathVars(
      withPolicy({ sandbox: { allowWrite: ['{{home}}/mrg-tmp'], denyWrite: ['{{org_root}}/docs'] } }),
      promptVarsFor(root, home),
    );
    const sandboxCfg = (r.policy as any).sandbox;
    expect(fileToolRoots({ cwd: root, orgRoot: root }, sandboxCfg)).toContain(join(home, 'mrg-tmp'));
    const guard = prepareGitGuard({ level: 'read', stateDir: join(root, 'guard'), protectedGitDirs: [] })!;
    const fs = (buildClaudeRestrictions(guard, sandboxCfg, { cwd: root, orgRoot: root, home }, true).sandbox as any)
      .filesystem;
    expect(fs.allowWrite).toContain(join(home, 'mrg-tmp'));
    expect(fs.denyWrite).toContain(join(root, 'docs'));
    expect(JSON.stringify(fs)).not.toContain('{{');
  });

  it('the daemon expands them when it loads the org: the file tools and the SDK sandbox get absolute paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pvars-daemon-'));
    mkdirSync(join(root, '.monomind', 'orgs'), { recursive: true });
    mkdirSync(join(root, 'docs'));
    writeFileSync(
      join(root, '.monomind', 'orgs', 'p.json'),
      JSON.stringify({
        name: 'p',
        goal: 'g',
        roles: [
          {
            id: 'boss',
            type: 'boss',
            reports_to: null,
            policy: { sandbox: { allowWrite: ['{{home}}/pvars-grant'], denyWrite: ['{{org_root}}/docs'] } },
          },
        ],
      }),
    );
    let options: any;
    const queryFn = ({ prompt, options: o }: any) =>
      (async function* () {
        options = o;
        for await (const _m of prompt)
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      })();
    const daemon = new OrgDaemon(root, { queryFn: queryFn as any, forward: false });
    try {
      await daemon.startOrg('p');
      for (let i = 0; i < 100 && !options; i++) await new Promise((r) => setTimeout(r, 20));
      const grant = join(realpathSync(homedir()), 'pvars-grant');
      // A denial names every root the file tools may use — the grant is one of them, expanded.
      const denied = await options.canUseTool('Read', { file_path: '/definitely/not/a/root/x' }, {});
      expect(denied.behavior).toBe('deny');
      expect(denied.message).toContain(grant);
      expect(denied.message).not.toContain('{{');
      if (sandboxAvailability().available) {
        expect(options.sandbox.filesystem.allowWrite).toContain(join(homedir(), 'pvars-grant'));
        expect(options.sandbox.filesystem.denyWrite).toContain(join(root, 'docs'));
      }
    } finally {
      await daemon.stopAll();
    }
  }, 15_000);
});
