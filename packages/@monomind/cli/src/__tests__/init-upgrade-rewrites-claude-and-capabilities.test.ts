// i-035 (b): `init upgrade` is the "upgrade path" owner decision A commits
// to, but executeUpgrade/executeUpgradeWithMissing never called writeClaudeMd
// or writeCapabilitiesDoc at all (grepped at 091d8e05c — zero hits). A
// generator-only fix to the "MUST initialize the monoswarm" claim therefore
// never reached a single existing project: CLAUDE.md and
// .monomind/CAPABILITIES.md were skip-if-exists and `init upgrade` never
// even attempted them. This pins the wiring, not just the generators.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeUpgrade, executeUpgradeWithMissing } from '../init/upgrade.js';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const USER_ABOVE = '# House rules\n\nRead docs/ARCH.md before touching the scheduler.\n\n';
const USER_BELOW = '\n# Deployment\n\nDeploys run from the release branch only.\n';

// Pre-fix CLAUDE.md: already marked (a prior `init` ran under today's
// generator), carrying the removed swarmRules() mandate verbatim.
const PRE_FIX_CLAUDE_MD = `<!-- monomind-block:claude-md -->
# Claude Code Configuration - Monomind

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less

## Monoswarm Rules

- MUST initialize the monoswarm for complex tasks: \`npx monomind@latest monoswarm init --topology hierarchical --max-agents 8 --strategy specialized\`
- ALWAYS spawn ALL agents in ONE message via the Task tool with \`run_in_background: true\` — CLI tools coordinate, Task agents do the work

## Support

- Documentation: https://github.com/monoes/monomind
<!-- /monomind-block:claude-md -->
`;

// Pre-fix CAPABILITIES.md: never had delimiters (writeCapabilitiesDoc only
// ever skipped-or-clobbered), enough shared `## ` headings for the
// legacy-unmarked sweep to recognise it as a generated body (trap 2).
const PRE_FIX_CAPABILITIES_MD = `# Monomind - Complete Capabilities Reference
> Generated: 2025-01-01T00:00:00.000Z
> Full documentation: https://github.com/monoes/monomind

## 📋 Table of Contents

1. [Overview](#overview)
2. [Monoswarm Orchestration](#monoswarm-orchestration)

## Overview

Monomind is a domain-driven design architecture for multi-agent AI coordination with:

- **15-Agent Monoswarm Coordination** with hierarchical and mesh topologies

## Monoswarm Orchestration

### Topologies
| Topology | Description | Best For |
|----------|-------------|----------|
| \`hierarchical\` | Coordinator controls workers directly | Anti-drift, tight control |

## Available Agents

### Core Development (5)
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

## CLI Commands

### Core Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`monoswarm\` | 6 | Multi-agent coordination |
`;

function seedProject(targetDir: string): void {
  mkdirSync(join(targetDir, '.monomind'), { recursive: true });
  writeFileSync(join(targetDir, 'CLAUDE.md'), PRE_FIX_CLAUDE_MD);
  writeFileSync(
    join(targetDir, '.monomind', 'CAPABILITIES.md'),
    `${USER_ABOVE}${PRE_FIX_CAPABILITIES_MD}${USER_BELOW}`,
  );
}

describe('init upgrade rewrites CLAUDE.md and CAPABILITIES.md (i-035)', () => {
  let tmp: string;
  let targetDir: string;
  let claudeMdPath: string;
  let capabilitiesPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-upgrade-docs-'));
    targetDir = join(tmp, 'project');
    seedProject(targetDir);
    claudeMdPath = join(targetDir, 'CLAUDE.md');
    capabilitiesPath = join(targetDir, '.monomind', 'CAPABILITIES.md');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('heals the monoswarm-init claim out of both files and preserves user text exactly', async () => {
    await executeUpgrade(targetDir);

    const claudeMd = readFileSync(claudeMdPath, 'utf-8');
    const capabilities = readFileSync(capabilitiesPath, 'utf-8');

    expect(claudeMd).not.toMatch(/MUST initialize the monoswarm/i);
    expect(capabilities).not.toMatch(/MUST initialize the monoswarm/i);
    expect(claudeMd).not.toMatch(/AUTO-INVOKE MONOSWARM/);
    expect(capabilities).not.toMatch(/AUTO-INVOKE MONOSWARM/);

    // String equality, not toContain: the exact hand-authored snippets must
    // survive byte-for-byte, at their original position in the file.
    expect(capabilities.startsWith(USER_ABOVE)).toBe(true);
    expect(capabilities.endsWith(USER_BELOW)).toBe(true);

    // AC-4: exactly one copy of each managed block.
    expect(count(claudeMd, '<!-- monomind-block:claude-md -->')).toBe(1);
    expect(count(capabilities, '<!-- monomind-block:capabilities -->')).toBe(1);
  });

  it('is byte-identical on the second and third upgrade run', async () => {
    await executeUpgrade(targetDir);
    const claudeMdFirst = readFileSync(claudeMdPath, 'utf-8');
    const capabilitiesFirst = readFileSync(capabilitiesPath, 'utf-8');

    await executeUpgrade(targetDir);
    expect(readFileSync(claudeMdPath, 'utf-8')).toBe(claudeMdFirst);
    expect(readFileSync(capabilitiesPath, 'utf-8')).toBe(capabilitiesFirst);

    await executeUpgrade(targetDir);
    expect(readFileSync(claudeMdPath, 'utf-8')).toBe(claudeMdFirst);
    expect(readFileSync(capabilitiesPath, 'utf-8')).toBe(capabilitiesFirst);
  }, 120_000);

  it('reports the refreshed files as updated, not created (the project already had them)', async () => {
    const result = await executeUpgrade(targetDir);

    expect(result.updated).toContain('CLAUDE.md');
    expect(result.updated).toContain('.monomind/CAPABILITIES.md');
  });

  it('executeUpgradeWithMissing inherits the same fix', async () => {
    await executeUpgradeWithMissing(targetDir);

    const claudeMd = readFileSync(claudeMdPath, 'utf-8');
    const capabilities = readFileSync(capabilitiesPath, 'utf-8');

    expect(claudeMd).not.toMatch(/MUST initialize the monoswarm/i);
    expect(count(claudeMd, '<!-- monomind-block:claude-md -->')).toBe(1);
    expect(count(capabilities, '<!-- monomind-block:capabilities -->')).toBe(1);
  }, 120_000);
});
