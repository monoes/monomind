// i-035 — owner decision A (honest-down): the generators used to tell every
// user's CLAUDE.md / CAPABILITIES.md that they "MUST initialize the
// monoswarm" before complex work. monoswarm_init only writes a JSON state
// record and starts no process — nothing links its state to Claude Code's
// Task agents. This asserts the false mandate is gone from every template
// and from CAPABILITIES.md, and that an honest sentence about what
// monoswarm actually does replaces it.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateClaudeMd, HONEST_MONOSWARM_SENTENCE } from '../init/claudemd-generator.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type ClaudeMdTemplate } from '../init/types.js';
import { writeCapabilitiesDoc } from '../init/write-capabilities.js';
import type { InitResult } from '../init/types.js';

const TEMPLATES: ClaudeMdTemplate[] = [
  'minimal',
  'standard',
  'full',
  'security',
  'performance',
  'solo',
];

// Matches the removed bare `antiDriftConfig()` fence: a ```bash block whose
// only non-empty line is the monoswarm init invocation. A block that also
// lists `monoswarm status` / `monoswarm monitor` etc. (write-capabilities.ts
// Quick Commands — accurate, kept) does NOT match.
function hasSoleMonoswarmInitFence(text: string): boolean {
  const fenceRe = /```(?:bash|javascript)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-loop idiom
  while ((m = fenceRe.exec(text))) {
    const lines = m[1].split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 1 && /^npx monomind@latest monoswarm init\b/.test(lines[0].trim())) {
      return true;
    }
  }
  return false;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

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

describe('monoswarm "MUST initialize" claim removed from generators (i-035)', () => {
  it.each(TEMPLATES)('generateClaudeMd(%s) makes no monoswarm-init mandate', (tmpl) => {
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd(), claudeMdTemplate: tmpl };
    const generated = generateClaudeMd(options, tmpl);

    expect(generated).not.toMatch(/MUST initialize the monoswarm/i);
    expect(generated).not.toMatch(/AUTO-INVOKE MONOSWARM/);
    expect(hasSoleMonoswarmInitFence(generated)).toBe(false);
  });

  it('the honest sentence appears exactly once in the default (standard) CLAUDE.md', () => {
    const generated = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() });
    expect(count(generated, HONEST_MONOSWARM_SENTENCE)).toBe(1);
  });

  describe('writeCapabilitiesDoc', () => {
    let tmp: string;
    let targetDir: string;

    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it('makes no monoswarm-init mandate and states the honest sentence exactly once', async () => {
      tmp = mkdtempSync(join(tmpdir(), 'monomind-capabilities-claim-'));
      targetDir = join(tmp, 'project');
      mkdirSync(join(targetDir, '.monomind'), { recursive: true });

      const options = { ...DEFAULT_INIT_OPTIONS, targetDir };
      await writeCapabilitiesDoc(targetDir, options, freshResult());
      const generated = readFileSync(join(targetDir, '.monomind', 'CAPABILITIES.md'), 'utf-8');

      expect(generated).not.toMatch(/MUST initialize the monoswarm/i);
      expect(generated).not.toMatch(/AUTO-INVOKE MONOSWARM/);
      expect(hasSoleMonoswarmInitFence(generated)).toBe(false);
      expect(count(generated, HONEST_MONOSWARM_SENTENCE)).toBe(1);
    });

    it('never emits a `> Generated:` timestamp line (would break managed-block idempotence)', async () => {
      tmp = mkdtempSync(join(tmpdir(), 'monomind-capabilities-notimestamp-'));
      targetDir = join(tmp, 'project');
      mkdirSync(join(targetDir, '.monomind'), { recursive: true });

      const options = { ...DEFAULT_INIT_OPTIONS, targetDir };
      await writeCapabilitiesDoc(targetDir, options, freshResult());
      const generated = readFileSync(join(targetDir, '.monomind', 'CAPABILITIES.md'), 'utf-8');

      expect(generated).not.toMatch(/^> Generated:/m);
    });
  });
});
