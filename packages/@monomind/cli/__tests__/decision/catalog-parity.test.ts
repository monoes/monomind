/**
 * The prompt hook (jev-picker.cjs reading .claude/helpers/skill-registry.json)
 * and `monomind pick` (taskSkillCatalog) must rank the SAME skill set.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentCatalog,
  agentNames,
  orgSkillCatalog,
  skillIndex,
  taskSkillCatalog,
} from '../../src/decision/catalogs.js';
import { newRoot, tamper, writeEntry } from '../catalog/fixtures.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jp: any = require('../../.claude/helpers/jev-picker.cjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const builder: any = require('../../.claude/helpers/build-skill-registry.cjs');

const md = (name: string, description: string, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nBody\n`;

function put(file: string, text: string): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

let root = '';
let home = '';
beforeEach(() => {
  home = newRoot('parity-home-');
  vi.stubEnv('HOME', home);
  vi.stubEnv('MONOMIND_HOME', join(home, '.monomind'));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function fixture(): string {
  root = newRoot('parity-root-');
  mkdirSync(join(root, '.git'));
  const skills = join(root, '.claude', 'skills');
  put(join(skills, 'mastermind-plan', 'SKILL.md'), md('mastermind-plan', 'Write implementation plans'));
  put(join(skills, 'mastermind-protocol', 'SKILL.md'), md('mastermind-protocol', 'Shared protocol'));
  put(join(skills, 'my-helper', 'SKILL.md'), md('my-helper', 'Included by others', 'type: helper\n'));
  put(join(root, '.claude', 'commands', 'mastermind', 'adr.md'), md('adr', 'Architecture decision record'));
  put(join(root, '.claude', 'commands', 'hooks', 'README.md'), '# Hooks commands\n');
  put(join(root, '.claude', 'commands', 'hooks', 'overview.md'), '# Overview\n');
  put(join(root, '.claude', 'commands', 'mastermind', 'references', 'tools.md'), '# Tools\n');
  put(join(home, '.claude', 'skills', 'my-user-skill', 'SKILL.md'), md('my-user-skill', 'Personal skill'));
  put(join(home, '.claude', 'skills', 'mastermind-plan', 'SKILL.md'), md('mastermind-plan', 'shadowed'));
  const org = join(root, '.monomind', 'org-skills');
  put(join(org, 'zorbling-tuning', 'SKILL.md'), md('zorbling-tuning', 'Tune zorbling flux', 'tags: [ops, flux]\n'));
  put(join(org, 'writing-plans', 'SKILL.md'), md('writing-plans', 'Plans (alias of mastermind-plan)'));
  put(join(org, 'architecture-decision-records', 'SKILL.md'), md('architecture-decision-records', 'ADRs'));
  put(join(org, 'zk-steward', 'SKILL.md'), md('zk-steward', 'Same as the agent'));
  put(
    join(root, '.claude', 'agents', 'core', 'zk-steward.md'),
    '---\nname: ZK Steward\nslug: zk-steward\ndescription: Zero-knowledge\n---\n',
  );
  writeEntry(root, { name: 'cat-org-jev', targets: ['org', 'jev'], description: 'catalog jev skill' });
  writeEntry(root, { name: 'cat-org-only', targets: ['org'], description: 'catalog org skill' });
  tamper(writeEntry(root, { name: 'cat-tampered', targets: ['org', 'jev'] }));
  return root;
}

describe('one skill set for the hook and monomind pick', () => {
  it('the hook catalog equals the pick catalog for a fixture project', () => {
    fixture();
    const pick = taskSkillCatalog(root); // refreshes .claude/helpers/skill-registry.json
    const hook = jp.loadSkillCatalog(root); // what the prompt hook reads
    expect(hook).toEqual(pick);

    const ids = pick.map((s) => s.id);
    // platform: project skills + commands, the user's skill (project wins a clash)
    expect(ids).toEqual(expect.arrayContaining(['mastermind-plan', 'mastermind:adr', 'my-user-skill']));
    expect(pick.find((s) => s.id === 'mastermind-plan')?.description).toBe('Write implementation plans');
    // docs, helper-only and type: helper entries are not candidates
    for (const gone of ['mastermind-protocol', 'my-helper', 'hooks:README', 'hooks:overview', 'mastermind:references:tools'])
      expect(ids).not.toContain(gone);
    // org: project skill and jev-approved verified catalog skill, as org entries
    expect(pick.find((s) => s.id === 'zorbling-tuning')).toMatchObject({
      source: 'org',
      invoke: 'monomind org skills show zorbling-tuning',
      text: 'ops flux',
    });
    expect(ids).toContain('cat-org-jev');
    // not approved for jev / tampered package / alias of a platform skill / an agent
    for (const gone of ['cat-org-only', 'cat-tampered', 'writing-plans', 'architecture-decision-records', 'zk-steward'])
      expect(ids).not.toContain(gone);
  });

  it('org entries match the Org library (listSkills + jevVisible) apart from dedupe', () => {
    fixture();
    const unified = taskSkillCatalog(root).filter((s) => s.source === 'org');
    const dropped = new Set(['writing-plans', 'architecture-decision-records', 'zk-steward', 'mastermind-plan']);
    const library = orgSkillCatalog(root)
      .filter((s) => !dropped.has(s.id))
      .map((s) => ({ id: s.id, description: s.description, text: s.text }));
    // Bundled skills sharing a name with a platform skill or agent drop on both sides.
    const unifiedIds = new Set(unified.map((s) => s.id));
    expect(unified.map((s) => ({ id: s.id, description: s.description, text: s.text }))).toEqual(
      library.filter((s) => unifiedIds.has(s.id)),
    );
    // everything the library lists but the unified set drops duplicates a
    // platform skill (by name or alias) or an agent
    const cat = require('../../.claude/helpers/jev-catalog.cjs');
    const taken = new Set<string>(
      taskSkillCatalog(root)
        .filter((s) => s.source === 'platform')
        .map((s) => cat.norm(s.id)),
    );
    for (const a of jp.loadAgentCatalog(root)) taken.add(cat.norm(a.id)).add(cat.norm(a.name));
    for (const s of library.filter((l) => !unifiedIds.has(l.id))) {
      const key = cat.norm(s.id);
      expect(taken.has(key) || taken.has(cat.ORG_ALIASES[key]), s.id).toBe(true);
    }
  });
});

describe('pick: low frontmatter', () => {
  it('reaches the index and the skill catalog; other entries carry no pick', () => {
    fixture();
    put(
      join(root, '.claude', 'skills', 'org-admin-page', 'SKILL.md'),
      md('org-admin-page', 'Review and edit org settings', 'pick: low\n'),
    );
    put(join(root, '.claude', 'commands', 'pair', 'examples.md'), md('pair:examples', 'Examples', 'pick: low\n'));
    const reg = builder.build(root, { user: false });
    const entry = (id: string) => reg.skills.find((s: { skill: string }) => s.skill === id);
    expect(entry('org-admin-page').pick).toBe('low');
    expect(entry('pair:examples').pick).toBe('low');
    expect(entry('mastermind-plan').pick).toBeUndefined();
    const items = taskSkillCatalog(root);
    expect(items.find((s) => s.id === 'org-admin-page')?.pick).toBe('low');
    expect(items.find((s) => s.id === 'pair:examples')?.pick).toBe('low');
    expect(items.find((s) => s.id === 'mastermind-plan')).not.toHaveProperty('pick');
  });
});

describe('skill index freshness', () => {
  it('rebuilds when a skill is added after the index was written', () => {
    fixture();
    builder.write(root);
    const past = new Date(Date.now() - 60_000);
    require('node:fs').utimesSync(builder.indexPath(root), past, past);
    put(join(root, '.claude', 'skills', 'fresh-skill', 'SKILL.md'), md('fresh-skill', 'Just added'));
    expect(builder.isStale(root)).toBe(true);
    expect(builder.ensure(root).skills.map((s: { skill: string }) => s.skill)).toContain('fresh-skill');
  });

  it('records user skills with origin user and skips them with user: false', () => {
    fixture();
    const reg = builder.build(root);
    expect(reg.skills.find((s: { skill: string }) => s.skill === 'my-user-skill')).toMatchObject({
      origin: 'user',
      source: '~/.claude/skills/my-user-skill/SKILL.md',
    });
    expect(builder.build(root, { user: false }).skills.map((s: { skill: string }) => s.skill)).not.toContain(
      'my-user-skill',
    );
  });
});

describe('catalogs outside a project write nothing', () => {
  const agent = (name: string) => `---\nname: ${name}\ndescription: ${name} agent\n---\n`;

  it('from the home directory: builds in memory, never creates ~/.monomind or a skill index', () => {
    put(join(home, '.claude', 'agents', 'core', 'home-coder.md'), agent('home-coder'));
    put(join(home, '.claude', 'skills', 'home-skill', 'SKILL.md'), md('home-skill', 'A personal skill'));
    expect(agentCatalog(home).map((a) => a.id)).toEqual(['home-coder']);
    expect(agentNames(home)).toEqual(new Set(['home-coder']));
    expect(taskSkillCatalog(home).map((s) => s.id)).toContain('home-skill');
    skillIndex(home);
    expect(existsSync(join(home, '.monomind'))).toBe(false);
    expect(existsSync(join(home, '.claude', 'helpers'))).toBe(false);
  });

  it('from a folder of a repository that is not a project: no .monomind anywhere', () => {
    const repo = newRoot('parity-repo-');
    mkdirSync(join(repo, '.git'));
    mkdirSync(join(repo, 'sub'));
    expect(agentCatalog(join(repo, 'sub'))).toEqual([]);
    agentNames(join(repo, 'sub'));
    taskSkillCatalog(join(repo, 'sub'));
    expect(existsSync(join(repo, 'sub', '.monomind'))).toBe(false);
    expect(existsSync(join(repo, '.monomind'))).toBe(false);
  });
});

describe('skill index writes', () => {
  it('never replaces a non-empty index with an empty one', () => {
    fixture();
    builder.write(root);
    const before = require('node:fs').readFileSync(builder.indexPath(root), 'utf8');
    const empty = newRoot('parity-empty-');
    mkdirSync(join(empty, '.claude', 'helpers'), { recursive: true });
    writeFileSync(builder.indexPath(empty), before);
    builder.write(empty, { user: false });
    expect(require('node:fs').readFileSync(builder.indexPath(empty), 'utf8')).toBe(before);
  });

  it('the command line indexes the project that owns the working directory', () => {
    fixture();
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [require.resolve('../../.claude/helpers/build-skill-registry.cjs')], {
      cwd: join(root, 'src', 'deep'),
      env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
    });
    expect(existsSync(builder.indexPath(root))).toBe(true);
    expect(existsSync(join(root, 'src', 'deep', '.claude'))).toBe(false);
  });

  it('the command line writes nothing outside a project', () => {
    const repo = newRoot('parity-repo-');
    mkdirSync(join(repo, '.git'));
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [require.resolve('../../.claude/helpers/build-skill-registry.cjs')], {
      cwd: repo,
      env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
    });
    expect(existsSync(join(repo, '.claude'))).toBe(false);
  });
});
