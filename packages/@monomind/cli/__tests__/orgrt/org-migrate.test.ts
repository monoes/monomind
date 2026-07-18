import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateOrgConfig, checkOrgStructure } from '../../src/orgrt/migrate.js';
import { orgCommand } from '../../src/commands/org.js';
import { ORG_DIR } from '../../src/orgrt/types.js';

const V1 = {
  name: 'growth', goal: 'grow', version: 1, topology: 'hierarchical',
  consensus: 'raft', strategy: 'specialized', maxAgents: 8,
  communication: { channels: ['all'] }, board_id: 'b-1', todo_col_id: 'c-1',
  loop: { poll_interval_minutes: 30, last_run: 'x', next_run: 'y', run_prompt_file: 'p.md' },
  roles: [
    { id: 'boss', title: 'Boss', type: 'boss', reports_to: null, agent_type: 'coordinator', delegates_to: ['dev'], responsibilities: ['lead'] },
    { id: 'dev', title: 'Dev', reports_to: 'boss', agent_type: 'coder', responsibilities: ['build'] },
  ],
};

describe('migrateOrgConfig', () => {
  it('drops v1-only keys, maps loop interval to schedule, keeps roles', () => {
    const { def, dropped } = migrateOrgConfig(structuredClone(V1));
    expect(def.schedule).toBe('30m');
    expect(def.status).toBe('stopped');
    for (const k of ['topology', 'consensus', 'strategy', 'maxAgents', 'communication', 'board_id', 'todo_col_id', 'loop', 'version']) {
      expect(def).not.toHaveProperty(k);
      expect(dropped).toContain(k);
    }
    const roles = def.roles as Record<string, unknown>[];
    expect(roles).toHaveLength(2);
    expect(roles[0]).not.toHaveProperty('agent_type');
    expect(roles[0]).not.toHaveProperty('delegates_to');
    expect(roles[1].reports_to).toBe('boss');
  });

  it('leaves an already-v2 config unchanged except normalization', () => {
    const v2 = { name: 'clean', goal: 'g', schedule: null, roles: [{ id: 'boss', reports_to: null }] };
    const { def, dropped } = migrateOrgConfig(structuredClone(v2));
    expect(dropped).toEqual([]);
    expect(def.name).toBe('clean');
  });

  it('maps agent_type onto type when type is missing', () => {
    const raw = { name: 'x', roles: [{ id: 'boss', reports_to: null, agent_type: 'coordinator' }] };
    const { def } = migrateOrgConfig(structuredClone(raw));
    expect((def.roles as Record<string, unknown>[])[0].type).toBe('coordinator');
  });

  it('promotes agent_type to type when type is specialist', () => {
    const raw = { name: 'x', roles: [{ id: 'boss', reports_to: null, type: 'specialist', agent_type: 'coordinator' }] };
    const { def, notes } = migrateOrgConfig(structuredClone(raw));
    expect((def.roles as Record<string, unknown>[])[0].type).toBe('coordinator');
    expect(notes.some(n => n.includes('agent_type → type'))).toBe(true);
  });

  it('keeps explicit type when it is not specialist or missing', () => {
    const raw = { name: 'x', roles: [{ id: 'boss', reports_to: null, type: 'reviewer', agent_type: 'coder' }] };
    const { def, notes } = migrateOrgConfig(structuredClone(raw));
    expect((def.roles as Record<string, unknown>[])[0].type).toBe('reviewer');
    expect(notes.some(n => n.includes('agent_type → type'))).toBe(false);
  });

  it('records role-level-only migrations in dropped (F5) instead of reporting already-v2', () => {
    const raw = {
      name: 'x', goal: 'g', roles: [
        { id: 'boss', reports_to: null, delegates_to: ['dev'] },
        { id: 'dev', reports_to: 'boss' },
      ],
    };
    const { def, dropped, notes } = migrateOrgConfig(structuredClone(raw));
    expect(dropped).toContain('roles[].delegates_to');
    expect(notes).toEqual([]); // no top-level keys, no loop, no agent_type notes
    expect((def.roles as Record<string, unknown>[])[0]).not.toHaveProperty('delegates_to');
  });
});

describe('checkOrgStructure', () => {
  it('reports no errors for a well-formed single-root role tree', () => {
    const errors = checkOrgStructure({
      schedule: null,
      roles: [{ id: 'boss', reports_to: null }, { id: 'dev', reports_to: 'boss' }] as any,
    });
    expect(errors).toEqual([]);
  });

  it('reports every role having reports_to: null as "no root" ambiguity — actually multiple roots', () => {
    const errors = checkOrgStructure({
      schedule: null,
      roles: [{ id: 'a', reports_to: null }, { id: 'b', reports_to: null }] as any,
    });
    expect(errors.some(e => /multiple root roles/.test(e))).toBe(true);
  });

  it('reports zero roots when no role has reports_to: null', () => {
    const errors = checkOrgStructure({
      schedule: null,
      roles: [{ id: 'a', reports_to: 'b' }, { id: 'b', reports_to: 'a' }] as any,
    });
    expect(errors.some(e => /no root role/.test(e))).toBe(true);
  });
});

describe('org migrate subcommand', () => {
  const setup = (): string => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-migrate-'));
    mkdirSync(join(cwd, ORG_DIR), { recursive: true });
    writeFileSync(join(cwd, ORG_DIR, 'growth.json'), JSON.stringify(V1));
    return cwd;
  };
  const migrate = (cwd: string, ...args: string[]) =>
    orgCommand.subcommands!.find(c => c.name === 'migrate')!
      .action!({ args, flags: {}, cwd, interactive: false } as any);

  it('migrates a v1 config, backs up the original, and validates the result', async () => {
    const cwd = setup();
    try {
      const res = await migrate(cwd, 'growth');
      expect(res?.success).toBe(true);
      expect(existsSync(join(cwd, ORG_DIR, 'growth.v1.json'))).toBe(true);
      const out = JSON.parse(readFileSync(join(cwd, ORG_DIR, 'growth.json'), 'utf8'));
      expect(out.topology).toBeUndefined();
      expect(out.schedule).toBe('30m');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('refuses to migrate a running org', async () => {
    const cwd = setup();
    try {
      mkdirSync(join(cwd, ORG_DIR, 'growth'), { recursive: true });
      writeFileSync(join(cwd, ORG_DIR, 'growth', 'runtime.json'),
        JSON.stringify({ status: 'running', pid: process.pid }));
      const res = await migrate(cwd, 'growth');
      expect(res?.success).toBe(false);
      expect(existsSync(join(cwd, ORG_DIR, 'growth.v1.json'))).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('refuses to write a migrated config whose roles are all reports_to: null (F2) — live config untouched, errors surfaced', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-migrate-allnull-'));
    try {
      const orgsDir = join(cwd, ORG_DIR);
      mkdirSync(orgsDir, { recursive: true });
      const badV1 = {
        ...structuredClone(V1),
        roles: [
          { id: 'boss', title: 'Boss', reports_to: null, agent_type: 'coordinator', responsibilities: ['lead'] },
          { id: 'dev', title: 'Dev', reports_to: null, agent_type: 'coder', responsibilities: ['build'] },
        ],
      };
      const raw = JSON.stringify(badV1);
      writeFileSync(join(orgsDir, 'growth.json'), raw);
      const res = await migrate(cwd, 'growth');
      expect(res?.success).toBe(false);
      expect(res?.message).toMatch(/invalid/i);
      // live config untouched
      expect(readFileSync(join(orgsDir, 'growth.json'), 'utf8')).toBe(raw);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('migrates a config whose only v1-ness is a role delegates_to key (F5) — writes the file, dropped is non-empty', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-migrate-roleonly-'));
    try {
      const orgsDir = join(cwd, ORG_DIR);
      mkdirSync(orgsDir, { recursive: true });
      const roleOnlyV1 = {
        name: 'growth', goal: 'grow', schedule: null,
        roles: [
          { id: 'boss', title: 'Boss', reports_to: null, delegates_to: ['dev'], responsibilities: ['lead'] },
          { id: 'dev', title: 'Dev', reports_to: 'boss', responsibilities: ['build'] },
        ],
      };
      writeFileSync(join(orgsDir, 'growth.json'), JSON.stringify(roleOnlyV1));
      const res = await migrate(cwd, 'growth');
      expect(res?.success).toBe(true);
      expect(res?.message).not.toMatch(/already v2/);
      const out = JSON.parse(readFileSync(join(orgsDir, 'growth.json'), 'utf8'));
      expect(out.roles[0]).not.toHaveProperty('delegates_to');
      expect(existsSync(join(orgsDir, 'growth.v1.json'))).toBe(true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('reports a nonexistent org cleanly', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-migrate-none-'));
    try {
      const res = await migrate(cwd, 'ghost');
      expect(res?.success).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('preserves backup sentinel content and migrates live config', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'org-migrate-sentinel-'));
    try {
      const orgsDir = join(cwd, ORG_DIR);
      mkdirSync(orgsDir, { recursive: true });
      writeFileSync(join(orgsDir, 'growth.json'), JSON.stringify(V1));
      // Pre-create backup with sentinel
      writeFileSync(join(orgsDir, 'growth.v1.json'), JSON.stringify({ sentinel: true }));
      const res = await migrate(cwd, 'growth');
      expect(res?.success).toBe(true);
      const backup = JSON.parse(readFileSync(join(orgsDir, 'growth.v1.json'), 'utf8'));
      expect(backup.sentinel).toBe(true);
      const live = JSON.parse(readFileSync(join(orgsDir, 'growth.json'), 'utf8'));
      expect(live.schedule).toBe('30m');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});

describe('listOrgConfigFiles excludes v1 backups', () => {
  it('does not list a <name>.v1.json backup as an org', async () => {
    const { listOrgConfigFiles } = await import('../../src/commands/org.js');
    const cwd = mkdtempSync(join(tmpdir(), 'org-migrate-v1list-'));
    try {
      const orgsDir = join(cwd, ORG_DIR);
      mkdirSync(orgsDir, { recursive: true });
      writeFileSync(join(orgsDir, 'growth.json'), JSON.stringify({ name: 'growth' }));
      writeFileSync(join(orgsDir, 'growth.v1.json'), JSON.stringify(V1));
      const configs = listOrgConfigFiles(orgsDir);
      expect(configs).toContain('growth.json');
      expect(configs).not.toContain('growth.v1.json');
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
