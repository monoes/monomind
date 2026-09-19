// i-035 (b): CAPABILITIES.md gets the same managed-block mechanism CLAUDE.md
// already has (write-claude.ts:490's mergeGeneratedBlock), marker
// 'capabilities'. Before this, write-capabilities.ts:20 just skipped the file
// forever once it existed — a --force write blew away any hand-authored text
// (there is no test proving that today because nothing tested --force on
// this file at all). Also pins trap 1 (no `> Generated:` timestamp line
// inside the block — would make every refresh a spurious diff) and trap 2
// (a pre-fix, unmarked CAPABILITIES.md must still be recognised as a legacy
// generated body and replaced in place, not left as a second stale copy
// below a freshly appended block — GH #276's failure shape, for this file).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeCapabilitiesDoc } from '../init/write-capabilities.js';

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// A pre-fix CAPABILITIES.md as write-capabilities.ts actually wrote it before
// this item: no delimiters at all (writeCapabilitiesDoc never merged, only
// skip-or-clobber), a `> Generated:` timestamp, and the monoswarm-init
// mandate wording. Enough `## ` headings shared with the current generator's
// output (Table of Contents, Overview, Monoswarm Orchestration, Available
// Agents, CLI Commands) for findLegacyUnmarkedRange's MIN_GENERATED_HEADINGS
// (3) to recognise it as a body this tool generated, not user prose.
const PRE_FIX_CAPABILITIES_BODY = `# Monomind - Complete Capabilities Reference
> Generated: 2025-01-01T00:00:00.000Z
> Full documentation: https://github.com/monoes/monomind

## 📋 Table of Contents

1. [Overview](#overview)
2. [Monoswarm Orchestration](#monoswarm-orchestration)

---

## Overview

Monomind is a domain-driven design architecture for multi-agent AI coordination with:

- **15-Agent Monoswarm Coordination** with hierarchical and mesh topologies

---

## Monoswarm Orchestration

### Topologies
| Topology | Description | Best For |
|----------|-------------|----------|
| \`hierarchical\` | Coordinator controls workers directly | Anti-drift, tight control |

---

## Available Agents

### Core Development (5)
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

---

## CLI Commands

### Core Commands
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`monoswarm\` | 6 | Multi-agent coordination |
`;

describe('writeCapabilitiesDoc managed block (i-035)', () => {
  let tmp: string;
  let targetDir: string;
  let capabilitiesPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-capabilities-block-'));
    targetDir = join(tmp, 'project');
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    capabilitiesPath = join(targetDir, '.monomind', 'CAPABILITIES.md');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('does not touch the file at all without --force (regression guard)', async () => {
    writeFileSync(capabilitiesPath, PRE_FIX_CAPABILITIES_BODY);
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir, force: false };

    await writeCapabilitiesDoc(targetDir, options, freshResult());

    expect(readFileSync(capabilitiesPath, 'utf-8')).toBe(PRE_FIX_CAPABILITIES_BODY);
  });

  it('replaces a pre-fix unmarked body in place on --force, preserving hand-authored text on both sides (trap 2)', async () => {
    const before = '# House rules\n\nRead docs/ARCH.md first.\n\n';
    const after = '\n# Deployment\n\nDeploys run from the release branch only.\n';
    writeFileSync(capabilitiesPath, `${before}${PRE_FIX_CAPABILITIES_BODY}${after}`);

    const options = { ...DEFAULT_INIT_OPTIONS, targetDir, force: true };
    await writeCapabilitiesDoc(targetDir, options, freshResult());
    const result = readFileSync(capabilitiesPath, 'utf-8');

    expect(result).toContain('Read docs/ARCH.md first.');
    expect(result).toContain('Deploys run from the release branch only.');
    // AC-4: exactly one copy of the managed block — the legacy unmarked body
    // was replaced in place, not left as a stale second copy below a fresh one.
    expect(count(result, '<!-- monomind-block:capabilities -->')).toBe(1);
    expect(count(result, '# Monomind - Complete Capabilities Reference')).toBe(1);
    expect(result).not.toMatch(/MUST initialize the monoswarm/i);
  });

  it('never writes a `> Generated:` line inside the managed block (trap 1)', async () => {
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir, force: false };
    await writeCapabilitiesDoc(targetDir, options, freshResult());
    const result = readFileSync(capabilitiesPath, 'utf-8');

    expect(result).not.toMatch(/^> Generated:/m);
  });

  it('is byte-identical across repeated --force runs (idempotence)', async () => {
    writeFileSync(capabilitiesPath, PRE_FIX_CAPABILITIES_BODY);
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir, force: true };

    await writeCapabilitiesDoc(targetDir, options, freshResult());
    const first = readFileSync(capabilitiesPath, 'utf-8');
    await writeCapabilitiesDoc(targetDir, options, freshResult());
    const second = readFileSync(capabilitiesPath, 'utf-8');
    await writeCapabilitiesDoc(targetDir, options, freshResult());
    const third = readFileSync(capabilitiesPath, 'utf-8');

    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});
