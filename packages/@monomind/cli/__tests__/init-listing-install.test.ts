/**
 * GH #411: what `monomind init` installs fills Claude Code's skill/command
 * listing, which has a fixed budget — past it, descriptions are dropped.
 *
 *   - README / `references/` / `_`-include pages under `.claude/commands/`
 *     were installed and registered as slash commands;
 *   - `--minimal` installed ~83 skills (SKILLS_MAP.core globbed `mastermind-*`);
 *   - agents marked `deprecated: true` were installed.
 *
 * The copy functions run against the real shipped package tree, except the
 * skill test, which uses a fixture of every shipped skill name (monodesign is
 * compiled into the package tree only at pack time).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyAgents, copyCommands, copySkills } from '../src/init/copy-assets.js';
import { CORE_PACK, OPTIONAL_PACKS } from '../src/init/packs.js';
import {
  DEFAULT_INIT_OPTIONS,
  detectPlatform,
  FULL_INIT_OPTIONS,
  type InitOptions,
  type InitResult,
  MINIMAL_INIT_OPTIONS,
} from '../src/init/types.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

let target: string;
beforeEach(() => {
  target = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-init-listing-'));
});
afterEach(() => fs.rmSync(target, { recursive: true, force: true }));

function options(base: InitOptions, sourceBaseDir: string): InitOptions {
  return { ...structuredClone(base), targetDir: target, sourceBaseDir };
}

describe('copyCommands', () => {
  it('installs no README, references/ or _-include page as a command', async () => {
    const result = freshResult();
    await copyCommands(target, options(FULL_INIT_OPTIONS, PKG_ROOT), result);
    const installed = walk(path.join(target, '.claude', 'commands'));
    expect(installed.length).toBeGreaterThan(50);
    const docs = installed.filter((rel) => {
      const segs = rel.split(path.sep);
      const base = segs[segs.length - 1];
      return base === 'README.md' || base.startsWith('_') || segs.includes('references');
    });
    expect(docs).toEqual([]);
    expect(result.summary.commandsCount).toBeGreaterThan(0);
  });

  it.each([
    ['default', DEFAULT_INIT_OPTIONS],
    ['full', FULL_INIT_OPTIONS],
  ])('every file a shipped command reads by path is installed somewhere (%s)', async (_, preset) => {
    await copyCommands(target, options(preset, PKG_ROOT), freshResult());
    await copySkills(target, options(preset, PKG_ROOT), freshResult());
    const commandsDir = path.join(target, '.claude', 'commands');
    const missing: string[] = [];
    for (const rel of walk(commandsDir)) {
      const text = fs.readFileSync(path.join(commandsDir, rel), 'utf-8');
      for (const [, ref] of text.matchAll(/`(\.claude\/[\w./-]+\.md)`/g)) {
        if (!fs.existsSync(path.join(target, ref))) missing.push(`${rel} -> ${ref}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('copyAgents', () => {
  it('does not install agents marked deprecated: true', async () => {
    const result = freshResult();
    await copyAgents(target, options(FULL_INIT_OPTIONS, PKG_ROOT), result);
    const agentsDir = path.join(target, '.claude', 'agents');
    const installed = walk(agentsDir).filter((rel) => rel.endsWith('.md'));
    expect(installed.length).toBeGreaterThan(20);
    const deprecated = installed.filter((rel) =>
      /^---\r?\n[\s\S]*?^deprecated:\s*true\s*$[\s\S]*?^---/m.test(
        fs.readFileSync(path.join(agentsDir, rel), 'utf-8'),
      ),
    );
    expect(deprecated).toEqual([]);
    expect(result.summary.agentsCount).toBe(installed.length);
  });
});

describe('copySkills', () => {
  let source: string;
  beforeEach(() => {
    // Every shipped skill name, plus monodesign (compiled in at pack time).
    source = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-init-listing-src-'));
    const pkgSkills = path.join(PKG_ROOT, '.claude', 'skills');
    const names = fs
      .readdirSync(pkgSkills)
      .filter((n) => fs.existsSync(path.join(pkgSkills, n, 'SKILL.md')));
    for (const name of [...names, 'monodesign']) {
      const dir = path.join(source, '.claude', 'skills', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }
  });
  afterEach(() => fs.rmSync(source, { recursive: true, force: true }));

  const installedSkills = () => fs.readdirSync(path.join(target, '.claude', 'skills')).sort();

  it('--minimal installs exactly the core pack skills', async () => {
    const result = freshResult();
    await copySkills(target, options(MINIMAL_INIT_OPTIONS, source), result);
    expect(result.errors).toEqual([]);
    expect(installedSkills()).toEqual([...CORE_PACK.skills].sort());
  });

  it('the default install is the core pack; --full ships every skill', async () => {
    await copySkills(target, options(DEFAULT_INIT_OPTIONS, source), freshResult());
    expect(installedSkills()).toEqual([...CORE_PACK.skills].sort());
    await copySkills(target, options(FULL_INIT_OPTIONS, source), freshResult());
    expect(installedSkills()).toEqual(
      fs.readdirSync(path.join(source, '.claude', 'skills')).sort(),
    );
    expect(installedSkills()).toEqual(
      [...CORE_PACK.skills, ...OPTIONAL_PACKS.flatMap((p) => p.skills)].sort(),
    );
  });
});
