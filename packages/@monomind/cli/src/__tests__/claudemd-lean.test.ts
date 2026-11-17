import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateClaudeMd } from '../init/claudemd-generator.js';
import {
  DEFAULT_INIT_OPTIONS,
  detectPlatform,
  type InitOptions,
  type InitResult,
  MINIMAL_INIT_OPTIONS,
} from '../init/types.js';
import { findAncestorManagedClaudeMd, writeClaudeMd } from '../init/write-claude.js';

// GH #412: the generated CLAUDE.md was ~10.7 KB of mostly monomind reference
// material sent with every request and every subagent, listed npm scripts the
// project did not have, and was duplicated by initialising a nested directory.

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

describe('lean generated CLAUDE.md (GH #412)', () => {
  let tmp: string;
  let counter = 0;

  beforeEach(() => {
    // Under the test HOME, where the ancestor CLAUDE.md walk stops: a temp dir under a
    // real home (the release gate's) would otherwise pick up that home's CLAUDE.md (#798).
    tmp = mkdtempSync(join(homedir(), 'monomind-claudemd-lean-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function project(files: Record<string, string>, dirs: readonly string[] = []): string {
    counter += 1;
    const dir = join(tmp, `project-${counter}`);
    mkdirSync(dir, { recursive: true });
    for (const d of dirs) mkdirSync(join(dir, d), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), content, 'utf-8');
    }
    return dir;
  }

  const pkg = (scripts?: Record<string, string>) =>
    JSON.stringify({ name: 'svc', version: '1.0.0', ...(scripts ? { scripts } : {}) });

  const opts = (targetDir: string, extra: Partial<InitOptions> = {}): InitOptions => ({
    ...DEFAULT_INIT_OPTIONS,
    targetDir,
    ...extra,
  });

  describe('size budget', () => {
    it('a typical Node project gets a CLAUDE.md of at most 4 KB', () => {
      const dir = project(
        { 'package.json': pkg({ build: 'tsc', test: 'vitest run', lint: 'eslint .' }) },
        ['src', 'tests'],
      );
      const md = generateClaudeMd(opts(dir));
      expect(Buffer.byteLength(md, 'utf-8')).toBeLessThanOrEqual(4096);
    });

    it('stays under budget even with the documents capability active', () => {
      const dir = project({
        'package.json': pkg({ build: 'tsc', test: 'vitest run', lint: 'eslint .' }),
        '.monomind/capabilities.json': JSON.stringify({ active: ['code', 'documents'] }),
      });
      const md = generateClaudeMd(opts(dir));
      expect(md).toContain('## Second Brain');
      expect(Buffer.byteLength(md, 'utf-8')).toBeLessThanOrEqual(5120);
    });

    it.each([
      '## CLI Commands',
      '## Monoswarm Rules',
      '### Project Config',
      '## Available Agents',
      '## Memory Commands',
      '## Quick Setup',
      '## Claude Code vs CLI Tools',
      '## Support',
      'London School',
      'event sourcing',
      'Domain-Driven Design',
      'TodoWrite',
      '**Topology**',
      '**Max Agents**',
    ])('the default template no longer carries %s', (needle) => {
      const dir = project({ 'package.json': pkg({ test: 'vitest run' }) });
      expect(generateClaudeMd(opts(dir))).not.toContain(needle);
    });

    it('keeps the rules that change behaviour', () => {
      const dir = project({ 'package.json': pkg({ test: 'vitest run' }) });
      const md = generateClaudeMd(opts(dir));
      expect(md).toContain('## Behavioral Rules (Always Enforced)');
      expect(md).toContain('## File Organization');
      expect(md).toContain('## Security Rules');
      expect(md).toContain('mcp__monomind__monograph_query');
    });
  });

  describe('build/test/lint only for scripts that exist', () => {
    it('package.json without scripts: no npm command lines and no Build & Test block', () => {
      const dir = project({ 'package.json': pkg() });
      const md = generateClaudeMd(opts(dir));
      expect(md).not.toMatch(/npm (run|test)/);
      expect(md).not.toContain('## Build & Test');
    });

    it('the `npm init` placeholder test script is not a test command', () => {
      const dir = project({
        'package.json': pkg({ test: 'echo "Error: no test specified" && exit 1' }),
      });
      expect(generateClaudeMd(opts(dir))).not.toContain('npm test');
    });

    it('emits exactly the scripts that exist, with the detected package manager', () => {
      const dir = project({
        'package.json': pkg({ build: 'tsc', test: 'vitest run' }),
        'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
      });
      const md = generateClaudeMd(opts(dir));
      const block = md.match(/## Build & Test\n\n```bash\n([\s\S]*?)```/)?.[1] ?? '';
      expect(block.split('\n').filter((l) => l && !l.startsWith('#'))).toEqual([
        'pnpm run build',
        'pnpm test',
      ]);
      expect(md).not.toContain('run lint');
    });

    it('a directory with no recognised stack gets no Build & Test block', () => {
      const dir = project({});
      expect(generateClaudeMd(opts(dir))).not.toContain('## Build & Test');
    });
  });

  describe('conditional sections', () => {
    it('Second Brain appears only when the documents capability is active', () => {
      const plain = project({ '.monomind/capabilities.json': '{"active":["code"]}' });
      expect(generateClaudeMd(opts(plain))).not.toContain('Second Brain');
      const docs = project({ '.monomind/capabilities.json': '{"active":["documents"]}' });
      expect(generateClaudeMd(opts(docs))).toContain('mcp__monomind__knowledge_search');
    });

    it('agent picking rules appear only when the [PICK] prompt hook is installed', () => {
      const dir = project({});
      expect(generateClaudeMd(opts(dir))).toContain('[PICK]');
      const noHook = { ...MINIMAL_INIT_OPTIONS, targetDir: dir };
      expect(generateClaudeMd(noHook)).not.toContain('[PICK]');
    });
  });

  describe('ancestor managed block', () => {
    const BLOCK =
      '<!-- monomind-block:claude-md -->\n# Claude Code Configuration - Monomind\n<!-- /monomind-block:claude-md -->\n';

    it('finds an ancestor CLAUDE.md carrying the managed block', () => {
      const root = project({ 'CLAUDE.md': BLOCK });
      const child = join(root, 'packages', 'app');
      mkdirSync(child, { recursive: true });
      expect(findAncestorManagedClaudeMd(child, tmp)).toBe(join(root, 'CLAUDE.md'));
    });

    it('ignores an ancestor CLAUDE.md without the block, and stops at home', () => {
      const root = project({ 'CLAUDE.md': '# Hand-written\n' });
      const child = join(root, 'app');
      mkdirSync(child, { recursive: true });
      expect(findAncestorManagedClaudeMd(child, tmp)).toBeNull();
      writeFileSync(join(tmp, 'CLAUDE.md'), BLOCK);
      expect(findAncestorManagedClaudeMd(child, root)).toBeNull();
      expect(findAncestorManagedClaudeMd(child, tmp)).toBe(join(tmp, 'CLAUDE.md'));
    });

    it('does not write a duplicate block in a nested directory, and says why', async () => {
      const root = project({ 'CLAUDE.md': BLOCK });
      const child = join(root, 'packages', 'app');
      mkdirSync(child, { recursive: true });
      const result = freshResult();
      await writeClaudeMd(child, { ...opts(child), force: true }, result);
      expect(existsSync(join(child, 'CLAUDE.md'))).toBe(false);
      expect(result.created.files).not.toContain('CLAUDE.md');
      expect(result.warnings?.join('\n')).toContain(join(root, 'CLAUDE.md'));
    });

    it('--force replaces a pre-delimiter body whole, including retired sections', async () => {
      const dir = project({
        'CLAUDE.md': [
          '# Claude Code Configuration - Monomind',
          '',
          '## Behavioral Rules (Always Enforced)',
          '',
          '- old rule',
          '',
          '## Monoswarm Rules',
          '',
          '- STALE MONOSWARM RULE',
          '',
          '## Security Rules',
          '',
          '- old security rule',
          '',
          '## CLI Commands',
          '',
          '| STALE TABLE |',
          '',
          '## Support',
          '',
          '- STALE SUPPORT LINK',
          '',
        ].join('\n'),
      });
      await writeClaudeMd(dir, { ...opts(dir), force: true }, freshResult());
      const after = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
      expect(after).toContain('<!-- monomind-block:claude-md -->');
      expect(after).not.toMatch(/STALE|## Support|## CLI Commands|## Monoswarm Rules/);
    });

    it('still writes the block when no ancestor carries it', async () => {
      const dir = project({});
      await writeClaudeMd(dir, opts(dir), freshResult());
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toContain(
        '<!-- monomind-block:claude-md -->',
      );
    });
  });
});
