import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OrgDefSchema } from '../../src/orgrt/types.js';
import { migrateOrgConfig } from '../../src/orgrt/migrate.js';
import {
  effectiveToolProviders,
  expandSkillPool,
  getSkill,
  listSkills,
  loadSkillText,
  parseFrontmatter,
  roleSkillGuidance,
  searchSkills,
  skillToolProvider,
  validateRoleSkills,
} from '../../src/orgrt/skill-library.js';
import { buildOrgTools } from '../../src/orgrt/session.js';

function project(skills: Record<string, { fm: string; body?: string; refs?: Record<string, string> }>): string {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  for (const [name, s] of Object.entries(skills)) {
    const dir = join(root, '.monomind', 'org-skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n${s.fm}\n---\n${s.body ?? `Body of ${name}.`}\n`);
    for (const [f, t] of Object.entries(s.refs ?? {})) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), t);
    }
  }
  return root;
}

describe('parseFrontmatter', () => {
  it('reads quoted, flow-list, block-list and folded values', () => {
    const { data, body } = parseFrontmatter(
      '---\nname: x\ndescription: >\n  folded\n  text\ntags: ["a", b]\ntools:\n  - t1\n  - t2\nlicense: \'MIT\'\nmetadata:\n  origin: ECC\n---\nhello',
    );
    expect(data).toMatchObject({ name: 'x', description: 'folded text', tags: ['a', 'b'], tools: ['t1', 't2'], license: 'MIT' });
    expect(body).toBe('hello');
  });
});

describe('skill library', () => {
  it('ships the bundled library with frontmatter on every skill', () => {
    const all = listSkills();
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((s) => !s.description || !s.license)).toEqual([]);
  });

  it('a project skill overrides a bundled one of the same name', () => {
    const root = project({ coder: { fm: 'description: ours' } });
    expect(getSkill('coder', root)).toMatchObject({ origin: 'project', description: 'ours' });
    expect(getSkill('coder')?.origin).toBe('bundled');
  });

  it('rejects names that could escape the library', () => {
    expect(getSkill('../etc')).toBeNull();
  });

  it('searches by name, tag and description', () => {
    const root = project({
      'zz-kafka-ops': { fm: 'description: "Run Kafka clusters"\ntags: [devops]' },
      'zz-copy': { fm: 'description: "Write landing page copy"\ntags: [marketing]' },
    });
    expect(searchSkills('kafka cluster operations', root)[0].name).toBe('zz-kafka-ops');
    expect(searchSkills('copy', root, { tag: 'devops' }).map((s) => s.name)).not.toContain('zz-copy');
  });

  it('expands tag selectors in a skill pool', () => {
    const root = project({ 'zz-a': { fm: 'tags: [zztag]' }, 'zz-b': { fm: 'tags: [zztag]' } });
    expect(expandSkillPool(['tag:zztag', 'coder'], root).sort()).toEqual(['coder', 'zz-a', 'zz-b']);
  });

  it('validates role skill references', () => {
    expect(validateRoleSkills({ id: 'r', skills: ['coder'], skill_pool: ['tag:engineering'] })).toEqual([]);
    expect(validateRoleSkills({ id: 'r', skills: ['nope'], skill_pool: ['tag:nope'] })).toHaveLength(2);
  });
});

describe('role guidance and org_skill_load', () => {
  const root = project({
    'zz-pinned': { fm: 'description: pinned one', body: 'PINNED BODY' },
    'zz-lazy': { fm: 'description: lazy one', body: 'LAZY BODY', refs: { 'references/deep.md': 'DEEP' } },
  });
  const role = { id: 'dev', skills: ['zz-pinned'], skill_pool: ['zz-lazy'] };

  it('inlines pinned skills and lists pool skills by description only', () => {
    const g = roleSkillGuidance(role, root) ?? '';
    expect(g).toContain('PINNED BODY');
    expect(g).toContain('- zz-lazy: lazy one');
    expect(g).not.toContain('LAZY BODY');
  });

  it('loads a pool skill and its reference files, refuses paths outside it', () => {
    expect(loadSkillText('zz-lazy', undefined, root)).toContain('references/deep.md');
    expect(loadSkillText('zz-lazy', 'references/deep.md', root)).toBe('DEEP');
    expect(loadSkillText('zz-lazy', '../zz-pinned/SKILL.md', root)).toMatch(/^ERROR/);
  });

  it('org_skill_load only serves the role its own skills', async () => {
    const tools = buildOrgTools({ role, cwd: root, orgRoot: root, deliver: () => {} } as any);
    const load = tools.find((t) => t.name === 'org_skill_load');
    expect((await load!.handler({ name: 'zz-lazy' })).text).toContain('LAZY BODY');
    expect((await load!.handler({ name: 'coder' })).text).toMatch(/^ERROR/);
  });

  it('roles without skills get no org_skill_load tool', () => {
    const tools = buildOrgTools({ role: { id: 'x' }, cwd: root, deliver: () => {} } as any);
    expect(tools.some((t) => t.name === 'org_skill_load')).toBe(false);
  });
});

describe('skill-derived tools', () => {
  const root = project({
    'zz-code': { fm: 'tools: [monograph_query, monograph_impact]' },
    'zz-ui': { fm: 'tools: [monodesign_detect]' },
    'zz-sales': { fm: 'tags: [sales]' },
  });

  it('attaches the monomind MCP allow-listed to exactly what the skills need', () => {
    const [p] = effectiveToolProviders({ skills: ['zz-code'], skill_pool: ['zz-ui'] }, root);
    expect(p).toMatchObject({ name: 'monomind', kind: 'mcp-stdio', allow: ['monodesign_detect', 'monograph_impact', 'monograph_query'] });
    expect(p.args.slice(-2)).toEqual(['mcp', 'start']);
  });

  it('gives a role whose skills need no tools nothing extra', () => {
    expect(effectiveToolProviders({ skills: ['zz-sales'] }, root)).toEqual([]);
  });

  it('keeps a role-configured provider of the same name instead of adding one', () => {
    const own = { kind: 'mcp-stdio', name: 'monomind', command: 'x', args: [], env: {}, timeout_ms: 1, idle_ms: 1 } as const;
    expect(effectiveToolProviders({ skills: ['zz-code'], tool_providers: [own] }, root)).toEqual([own]);
  });
});

describe('migration off ui.icon', () => {
  it('turns an archetype icon into an explicit skill', () => {
    const raw = { name: 'o', roles: [{ id: 'a', ui: { icon: 'coder' } }, { id: 'b', ui: { icon: 'custom' }, reports_to: 'a' }] };
    const { def, notes } = migrateOrgConfig(raw);
    const roles = OrgDefSchema.parse(def).roles;
    expect(roles[0].skills).toEqual(['coder']);
    expect(roles[1].skills).toBeUndefined();
    expect(notes.some((n) => n.includes('ui.icon "coder"'))).toBe(true);
  });
});

describe('without catalog state', () => {
  it('returns exactly what the library returned with the catalog stubbed out', async () => {
    const root = project({
      'zz-api': { fm: 'description: "Backend API reviewer"\ntags: [backend]\ntools: [monograph_query]' },
    });
    const role = { skills: ['zz-api'], skill_pool: ['tag:backend', 'coder'] };
    const capture = (lib: typeof import('../../src/orgrt/skill-library.js')) => ({
      list: lib.listSkills(root),
      search: lib.searchSkills('backend api reviewer', root),
      guidance: lib.roleSkillGuidance(role, root),
      provider: lib.skillToolProvider(role, root),
    });
    const actual = capture({ listSkills, searchSkills, roleSkillGuidance, skillToolProvider } as never);
    vi.resetModules();
    vi.doMock('../../src/catalog/snapshot.js', () => ({
      buildSnapshot: () => ({ assets: [], diagnostics: [], stateVersion: null }),
      eligible: () => [],
    }));
    try {
      const stubbed = capture(await import('../../src/orgrt/skill-library.js'));
      expect(actual).toEqual(stubbed);
      expect(existsSync(join(root, '.monomind', 'catalog'))).toBe(false);
    } finally {
      vi.doUnmock('../../src/catalog/snapshot.js');
      vi.resetModules();
    }
  });
});
