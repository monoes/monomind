/**
 * `init upgrade` adds the allow rules the current settings generator writes
 * (e.g. the pinned `npx -y --package=@monoes/monomindcli@* monomind *` form)
 * to an existing `.claude/settings.json`, so a project no longer needs
 * `init --force` to stop prompting. User rules keep their order, deny/ask
 * entries are untouched, the file is backed up first, and a second run is a
 * no-op.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MONOMIND_ALLOW_RULES } from '../src/init/settings-generator.js';
import { executeUpgrade } from '../src/init/upgrade.js';

const PINNED = 'Bash(npx -y --package=@monoes/monomindcli@* monomind *)';

let home: string;
let dir: string;
let savedHome: string | undefined;
const settingsPath = () => join(dir, '.claude', 'settings.json');
const read = () => JSON.parse(readFileSync(settingsPath(), 'utf-8'));
const write = (s: unknown) => {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
};
const settingsBackups = () => {
  const root = join(dir, '.monomind', 'backups');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((run) => join(root, run, '.claude', 'settings.json'))
    .filter(existsSync);
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'upgrade-perms-home-'));
  dir = mkdtempSync(join(tmpdir(), 'upgrade-perms-proj-'));
  savedHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('the generator allow list', () => {
  it('includes the pinned form generated hooks and guidance run', () => {
    expect(MONOMIND_ALLOW_RULES).toContain(PINNED);
  });
});

describe('executeUpgrade merges monomind allow rules into settings.json', () => {
  const user = {
    myKey: 'keep-me',
    permissions: {
      allow: ['Bash(make test)', 'Bash(npx monomind *)', 'Read(./docs/**)'],
      deny: ['Read(./secrets/**)'],
      ask: ['Bash(git push *)'],
      defaultMode: 'acceptEdits',
    },
  };

  it('appends the missing rules after the user rules, keeping deny/ask', async () => {
    write(user);
    const result = await executeUpgrade(dir);
    expect(result.errors).toEqual([]);
    const s = read();
    const missing = MONOMIND_ALLOW_RULES.filter((r) => !user.permissions.allow.includes(r));
    expect(s.permissions.allow).toEqual([...user.permissions.allow, ...missing]);
    expect(s.permissions.allow).toContain(PINNED);
    expect(s.permissions.deny).toEqual(user.permissions.deny);
    expect(s.permissions.ask).toEqual(user.permissions.ask);
    expect(s.permissions.defaultMode).toBe('acceptEdits');
    expect(s.myKey).toBe('keep-me');
    expect(result.updated).toContain('.claude/settings.json');
    expect(result.settingsUpdated).toContain(`permissions.allow: ${PINNED}`);
  });

  it('backs the file up before writing', async () => {
    write(user);
    const before = readFileSync(settingsPath(), 'utf-8');
    await executeUpgrade(dir);
    const backups = settingsBackups();
    expect(backups).toHaveLength(1);
    expect(readFileSync(backups[0], 'utf-8')).toBe(before);
  });

  it('is idempotent: a second run changes nothing and takes no backup', async () => {
    write(user);
    await executeUpgrade(dir);
    const once = readFileSync(settingsPath(), 'utf-8');
    const again = await executeUpgrade(dir);
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(once);
    expect(again.settingsUpdated ?? []).toEqual([]);
    expect(settingsBackups()).toHaveLength(1);
  });

  it('adds an allow list to settings that have no permissions', async () => {
    write({ env: { FOO: '1' } });
    await executeUpgrade(dir);
    const s = read();
    expect(s.permissions).toEqual({ allow: [...MONOMIND_ALLOW_RULES] });
    expect(s.env).toEqual({ FOO: '1' });
  });

  it('also merges them with --settings', async () => {
    write(user);
    await executeUpgrade(dir, true);
    expect(read().permissions.allow).toEqual(
      expect.arrayContaining([...MONOMIND_ALLOW_RULES, 'Bash(make test)']),
    );
  });

  it('creates no settings.json when the project has none', async () => {
    await executeUpgrade(dir);
    expect(existsSync(settingsPath())).toBe(false);
  });

  it('leaves an unparseable settings.json alone and says so', async () => {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(settingsPath(), '{ not json');
    const result = await executeUpgrade(dir);
    expect(readFileSync(settingsPath(), 'utf-8')).toBe('{ not json');
    expect(result.warnings?.some((w) => w.includes('.claude/settings.json'))).toBe(true);
  });

  it('does not rewrite a non-array allow value', async () => {
    write({ permissions: { allow: 'Bash(*)' } });
    const before = readFileSync(settingsPath(), 'utf-8');
    await executeUpgrade(dir);
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(before);
  });
});
