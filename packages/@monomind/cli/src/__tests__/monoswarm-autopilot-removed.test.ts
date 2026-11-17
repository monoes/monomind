/**
 * #418: `monoswarm` and `autopilot` were deprecated in 2.21.0 and removed in
 * 2.22.0. Neither started an agent — they recorded state files. This pins the
 * removal: no CLI command, no MCP tool, nothing in the generated CLAUDE.md or
 * CAPABILITIES.md that sends a model to them, and an old project's
 * pre-delimiter CLAUDE.md sheds the monoswarm sections on upgrade.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCommandNames, hasCommand } from '../commands/index.js';
import { generateClaudeMd } from '../init/claudemd-generator.js';
import {
  type ClaudeMdTemplate,
  DEFAULT_INIT_OPTIONS,
  detectPlatform,
  type InitResult,
} from '../init/types.js';
import { writeCapabilitiesDoc } from '../init/write-capabilities.js';
import { writeClaudeMd } from '../init/write-claude.js';
import { getAllMCPTools } from '../mcp-client.js';
import { suggestCommand } from '../suggest.js';

const TEMPLATES: ClaudeMdTemplate[] = [
  'minimal',
  'standard',
  'full',
  'security',
  'performance',
  'solo',
];

// Anything that would send a model to the removed commands or tools. Agent
// names such as `monoswarm-code-review` are still real agents, so a bare
// "monoswarm" substring is not the test.
const REMOVED_SURFACE =
  /## Monoswarm|monoswarm_|autopilot|monomind(?:@latest)? monoswarm|doc\/concepts\/monoswarm\.md/i;

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

describe('monoswarm and autopilot are removed (#418)', () => {
  let tmp: string;

  beforeEach(() => {
    // Under the test HOME, where the ancestor CLAUDE.md walk stops: a temp dir under a
    // real home (the release gate's) would otherwise pick up that home's CLAUDE.md (#798).
    tmp = mkdtempSync(join(homedir(), 'monomind-418-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('no longer registers either CLI command', () => {
    for (const name of ['monoswarm', 'autopilot']) {
      expect(hasCommand(name)).toBe(false);
      expect(getCommandNames()).not.toContain(name);
    }
  });

  it('points a removed command at its replacement instead of guessing a typo', () => {
    const names = getCommandNames();
    const swarm = suggestCommand('monoswarm', names);
    expect(swarm.message).toContain('removed in 2.22.0');
    expect(swarm.message).toContain('Task tool');
    expect(swarm.message).toContain('monomind org run');
    expect(suggestCommand('autopilot', names).message).toContain('monomind org run');
  });

  it('exposes no monoswarm_* or autopilot_* MCP tool', async () => {
    const names = (await getAllMCPTools()).map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => /^(monoswarm|autopilot)_/.test(n))).toEqual([]);
  });

  it.each(TEMPLATES)('generateClaudeMd(%s) carries no monoswarm or autopilot surface', (tmpl) => {
    const generated = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() }, tmpl);
    expect(generated).not.toMatch(REMOVED_SURFACE);
  });

  it('CAPABILITIES.md carries no monoswarm or autopilot surface', async () => {
    const targetDir = join(tmp, 'project');
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    await writeCapabilitiesDoc(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir }, freshResult());
    const generated = readFileSync(join(targetDir, '.monomind', 'CAPABILITIES.md'), 'utf-8');
    expect(generated).not.toMatch(REMOVED_SURFACE);
    expect(generated).not.toMatch(/Vote Strategies/);
  });

  it('never emits a `> Generated:` timestamp in CAPABILITIES.md (would break managed-block idempotence)', async () => {
    const targetDir = join(tmp, 'project');
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    await writeCapabilitiesDoc(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir }, freshResult());
    const generated = readFileSync(join(targetDir, '.monomind', 'CAPABILITIES.md'), 'utf-8');
    expect(generated).not.toMatch(/^> Generated:/m);
  });

  it('an old pre-delimiter full-template CLAUDE.md sheds every monoswarm section on upgrade', async () => {
    const dir = join(tmp, 'legacy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'CLAUDE.md'),
      [
        '# Claude Code Configuration - Monomind',
        '',
        '## Behavioral Rules (Always Enforced)',
        '',
        '- old rule',
        '',
        '## Monoswarm Orchestration',
        '',
        '- STALE: MUST initialize the monoswarm',
        '',
        '## Monoswarm Configuration & Anti-Drift',
        '',
        '- STALE: Use `majority` consensus for monoswarm',
        '',
        '## Monoswarm Protocols & Routing',
        '',
        '### Auto-Start Monoswarm Protocol',
        '',
        '- STALE: mcp__monomind__monoswarm_init',
        '',
        '## Monoswarm Execution Rules',
        '',
        '- STALE: check monoswarm status',
        '',
        '## Security Rules',
        '',
        '- old security rule',
        '',
        '# My Project Notes',
        '',
        'Hand-written text that must survive.',
        '',
      ].join('\n'),
    );

    await writeClaudeMd(
      dir,
      { ...DEFAULT_INIT_OPTIONS, targetDir: dir, force: true },
      freshResult(),
    );
    const after = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');

    expect(after).toContain('<!-- monomind-block:claude-md -->');
    expect(after).not.toMatch(/STALE|## Monoswarm|Auto-Start Monoswarm/);
    expect(after).toContain('# My Project Notes');
    expect(after).toContain('Hand-written text that must survive.');
    expect(after.match(/^# Claude Code Configuration - Monomind$/gm)).toHaveLength(1);
  });
});
