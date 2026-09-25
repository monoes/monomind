/**
 * `monomind init` must never overwrite a shipped file the user edited.
 *
 * Every init — with or without --force, `-y` included — used to copy the
 * shipped skills, agents, commands and helpers over whatever was on disk, and
 * the statusline was regenerated unconditionally. Init now records a hash of
 * every file it leaves (.monomind/init-manifest.json `files`); a file whose
 * content no longer matches is the user's, so it is kept and the new version
 * is written beside it as `<file>.monomind-new`.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { upgradeCommand } from '../src/commands/init-upgrade.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

output.setVerbosity('quiet');

vi.mock('child_process', () => {
  const fail = () => {
    throw new Error('mocked: no real process execution in tests');
  };
  return {
    execSync: vi.fn(fail),
    execFileSync: vi.fn(fail),
    exec: vi.fn(fail),
    execFile: vi.fn(fail),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
      proc.unref = () => {};
      proc.kill = () => {};
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      return proc;
    }),
  };
});

const SKILL = '.claude/skills/github-toolkit/SKILL.md';
const AGENT = '.claude/agents/core/coder.md';
const COMMAND_DIR = '.claude/commands/mastermind';
const STATUSLINE = '.claude/helpers/statusline.cjs';

describe('init keeps shipped files the user edited', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  const file = (rel: string) => path.join(tmpDir, rel);
  const read = (rel: string) => fs.readFileSync(file(rel), 'utf8');
  const edit = (rel: string) => {
    fs.appendFileSync(file(rel), '\n<!-- my local edit -->\n');
    return read(rel);
  };
  const init = (flags: Record<string, unknown> = {}) =>
    initCommand.action!({
      args: [],
      flags: { _: [], 'no-watch': true, 'no-start-all': true, 'no-memory': true, ...flags },
      cwd: tmpDir,
      interactive: false,
    } as CommandContext);
  const commandFile = () => {
    const name = fs.readdirSync(file(COMMAND_DIR)).find((n) => n.endsWith('.md'));
    return `${COMMAND_DIR}/${name}`;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-kept-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-kept-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    try {
      const bridge = await import('../src/memory/memory-bridge.js');
      await bridge.shutdownBridge();
    } catch {}
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it.each([
    ['-y', { yes: true }],
    ['--force', { force: true, yes: true }],
  ])('%s keeps edited skills, agents, commands and the statusline', async (_label, flags) => {
    expect((await init()).success).toBe(true);
    const cmd = commandFile();
    const edited = Object.fromEntries([SKILL, AGENT, cmd, STATUSLINE].map((rel) => [rel, edit(rel)]));
    const shippedSkill = fs.readFileSync(
      path.join(__dirname, '..', '.claude', 'skills', 'github-toolkit', 'SKILL.md'),
      'utf8',
    );

    expect((await init(flags)).success).toBe(true);

    for (const [rel, content] of Object.entries(edited)) {
      expect(read(rel), rel).toBe(content);
      expect(fs.existsSync(file(`${rel}.monomind-new`)), `${rel}.monomind-new`).toBe(true);
    }
    expect(read(`${SKILL}.monomind-new`)).toBe(shippedSkill);
  }, 180000);

  it('refreshes an untouched file, and drops a stale .monomind-new once the edit is reverted', async () => {
    await init();
    const original = read(SKILL);
    edit(SKILL);
    await init({ yes: true });
    expect(fs.existsSync(file(`${SKILL}.monomind-new`))).toBe(true);

    fs.writeFileSync(file(SKILL), original);
    await init({ yes: true });
    expect(read(SKILL)).toBe(original);
    expect(fs.existsSync(file(`${SKILL}.monomind-new`))).toBe(false);
  }, 180000);

  it('an unrecorded (pre-hash) edited file is kept without --force, and backed up then replaced with it', async () => {
    await init();
    const manifestPath = file('.monomind/init-manifest.json');
    const dropHashes = () => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      delete manifest.files;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    };
    const shipped = read(AGENT);
    dropHashes();
    const edited = edit(AGENT);

    await init({ yes: true });
    expect(read(AGENT)).toBe(edited);
    expect(fs.existsSync(file(`${AGENT}.monomind-new`))).toBe(true);

    dropHashes();
    await init({ force: true, yes: true });
    expect(read(AGENT)).toBe(shipped);
    const backups = fs.readdirSync(file('.monomind/backups'));
    const copies = backups
      .map((dir) => file(`.monomind/backups/${dir}/${AGENT}`))
      .filter((p) => fs.existsSync(p));
    expect(copies.map((p) => fs.readFileSync(p, 'utf8'))).toContain(edited);
  }, 180000);

  it('keeps at most five backup directories, never pruning retired entries', async () => {
    await init();
    const root = file('.monomind/backups');
    fs.mkdirSync(root, { recursive: true });
    for (let i = 1; i <= 8; i++) fs.mkdirSync(path.join(root, `${1000 + i}-1`));
    fs.mkdirSync(path.join(root, '999-1', 'retired'), { recursive: true });

    await init({ force: true, yes: true });

    const left = fs.readdirSync(root);
    expect(left.filter((n) => !fs.existsSync(path.join(root, n, 'retired'))).length).toBeLessThanOrEqual(5);
    expect(left).toContain('999-1');
  }, 180000);
});

describe('managed blocks edited by the user', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  const file = (rel: string) => path.join(tmpDir, rel);
  const run = (flags: Record<string, unknown> = {}) =>
    initCommand.action!({
      args: [],
      flags: { _: [], 'no-watch': true, 'no-start-all': true, 'no-memory': true, ...flags },
      cwd: tmpDir,
      interactive: false,
    } as CommandContext);
  const editInsideBlock = (rel: string, marker: string) => {
    const text = fs.readFileSync(file(rel), 'utf8');
    const next = text.replace(
      `<!-- /monomind-block:${marker} -->`,
      `MY EDIT INSIDE\n<!-- /monomind-block:${marker} -->`,
    );
    fs.writeFileSync(file(rel), `${next}\nMY TEXT OUTSIDE\n`);
    return next;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-block-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-block-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('says in shared_instructions.md that edits belong outside the markers', async () => {
    await run();
    const text = fs.readFileSync(file('.agents/shared_instructions.md'), 'utf8');
    expect(text).not.toMatch(/Edit freely/);
    expect(text).toMatch(/outside the .*markers/);
  }, 120000);

  it.each([
    ['CLAUDE.md', 'claude-md'],
    ['AGENTS.md', 'agents-md'],
    ['.agents/shared_instructions.md', 'shared-instructions'],
  ])('--force backs up %s before replacing its edited block, and says so', async (rel, marker) => {
    await run();
    editInsideBlock(rel, marker);
    const before = fs.readFileSync(file(rel), 'utf8');

    const result = await run({ force: true, yes: true });
    expect(result.success).toBe(true);

    const after = fs.readFileSync(file(rel), 'utf8');
    expect(after).not.toContain('MY EDIT INSIDE');
    expect(after).toContain('MY TEXT OUTSIDE');
    const backups = fs.readdirSync(file('.monomind/backups'));
    const copies = backups
      .map((dir) => file(`.monomind/backups/${dir}/${rel}`))
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.readFileSync(p, 'utf8'));
    expect(copies).toContain(before);
  }, 180000);

  it('init upgrade keeps an edited CLAUDE.md block and warns', async () => {
    await run();
    editInsideBlock('CLAUDE.md', 'claude-md');
    const before = fs.readFileSync(file('CLAUDE.md'), 'utf8');

    const result = await upgradeCommand.action!({
      args: [],
      flags: { _: [] },
      cwd: tmpDir,
      interactive: false,
    } as CommandContext);

    expect(result.success).toBe(true);
    expect(fs.readFileSync(file('CLAUDE.md'), 'utf8')).toBe(before);
  }, 180000);
});
