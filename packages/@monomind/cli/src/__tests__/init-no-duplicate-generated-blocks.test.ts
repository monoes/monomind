import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_MD_SIGNATURE, generateClaudeMd } from '../init/claudemd-generator.js';
import {
  SHARED_INSTRUCTIONS_SIGNATURE,
  writeSharedInstructions,
} from '../init/shared-instructions-generator.js';
import { DEFAULT_INIT_OPTIONS, detectPlatform, type InitResult } from '../init/types.js';
import { writeClaudeMd } from '../init/write-claude.js';

// writeSharedInstructions best-effort-seeds memory via a subprocess; stub it
// out so these stay hermetic (same convention as
// write-shared-instructions-force-preserves-content.test.ts).
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

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

describe('init does not append a generated block beside an existing one (GH #278)', () => {
  let tmp: string;
  let projectDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-no-duplicate-blocks-'));
    projectDir = join(tmp, 'project');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'go.mod'), 'module example.com/mono-agent\n\ngo 1.22\n');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('leaves an unmarked, monomind-generated CLAUDE.md body alone instead of duplicating it', async () => {
    const options = { ...DEFAULT_INIT_OPTIONS, targetDir: projectDir, force: true };
    const claudeMdPath = join(projectDir, 'CLAUDE.md');
    // What a pre-marker release wrote: the generated body, unwrapped.
    const legacy = `${generateClaudeMd(options)}`;
    writeFileSync(claudeMdPath, legacy);
    const result = freshResult();

    await writeClaudeMd(projectDir, options, result);

    const after = readFileSync(claudeMdPath, 'utf-8');
    expect(after.split(CLAUDE_MD_SIGNATURE).length - 1).toBe(1);
    expect(after).toBe(legacy);
    expect(result.skipped.some((entry) => entry.startsWith('CLAUDE.md ('))).toBe(true);
  });

  it('leaves an unmarked, monomind-generated shared_instructions.md alone', () => {
    // Generate the file once the normal way, then unwrap it — that is exactly
    // the shape a pre-marker release left on disk.
    writeSharedInstructions(projectDir, false, freshResult());
    const siPath = join(projectDir, '.agents', 'shared_instructions.md');
    const legacy = readFileSync(siPath, 'utf-8')
      .replace('<!-- monomind-block:shared-instructions -->\n', '')
      .replace('<!-- /monomind-block:shared-instructions -->\n', '');
    writeFileSync(siPath, legacy);
    const result = freshResult();

    writeSharedInstructions(projectDir, true, result);

    const after = readFileSync(siPath, 'utf-8');
    expect(after.split(SHARED_INSTRUCTIONS_SIGNATURE).length - 1).toBe(1);
    expect(after).toBe(legacy);
    expect(
      result.skipped.some((entry) => entry.startsWith('.agents/shared_instructions.md (')),
    ).toBe(true);
  });

  it('still appends the block beside a file the user rewrote the banner out of', () => {
    // A hand-edited descendant of monomind's output is the user's file, not
    // monomind's — GH #241's additive behavior must survive this fix.
    const siDir = join(projectDir, '.agents');
    mkdirSync(siDir, { recursive: true });
    const siPath = join(siDir, 'shared_instructions.md');
    const handEdited = `# mono-agent — Shared Agent Instructions\n\n> Prepended to every agent prompt in this repo. Stack: **Go**.\n\n- Errors are values — always handle them.\n`;
    writeFileSync(siPath, handEdited);

    writeSharedInstructions(projectDir, true, freshResult());

    const after = readFileSync(siPath, 'utf-8');
    expect(after).toContain('Errors are values — always handle them.');
    expect(after).toContain('<!-- monomind-block:shared-instructions -->');
    expect(after).toContain(SHARED_INSTRUCTIONS_SIGNATURE);
  });
});

describe('generated CLAUDE.md matches the detected stack (GH #278)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-claude-md-stack-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function projectWith(files: Record<string, string>, dirs: string[] = []): string {
    const dir = join(tmp, `p${Object.keys(files).length}-${dirs.length}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
    for (const d of dirs) mkdirSync(join(dir, d), { recursive: true });
    for (const [name, content] of Object.entries(files))
      writeFileSync(join(dir, name), content, 'utf-8');
    return dir;
  }

  it('prescribes go commands, not npm, in a Go repo', () => {
    const dir = projectWith({ 'go.mod': 'module example.com/svc\n\ngo 1.22\n' });

    const md = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: dir });

    expect(md).toContain('go build ./...');
    expect(md).toContain('go test ./...');
    expect(md).toContain('go vet ./...');
    expect(md).not.toContain('npm run build');
    expect(md).not.toContain('npm run lint');
  });

  it('does not tell a Go repo without a src/ directory to use /src', () => {
    const dir = projectWith({ 'go.mod': 'module example.com/svc\n\ngo 1.22\n' }, [
      'cmd',
      'internal',
    ]);

    const md = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: dir });

    expect(md).not.toContain('Use `/src` for source code files');
    expect(md).toContain('NEVER save to root folder');
  });

  it('prescribes cargo commands in a Rust repo', () => {
    const dir = projectWith({ 'Cargo.toml': '[package]\nname = "svc"\nversion = "0.1.0"\n' });

    const md = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: dir });

    expect(md).toContain('cargo build');
    expect(md).toContain('cargo test');
    expect(md).not.toContain('npm test');
  });

  it('keeps npm commands and /src for a plain Node repo', () => {
    const dir = projectWith({ 'package.json': '{"name":"svc","version":"1.0.0"}' }, ['src']);

    const md = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: dir });

    expect(md).toContain('npm run build');
    expect(md).toContain('npm test');
    expect(md).toContain('Use `/src` for source code files');
  });

  it('uses pnpm when the repo has a pnpm lockfile', () => {
    const dir = projectWith({
      'package.json': '{"name":"svc","version":"1.0.0"}',
      'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    });

    const md = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: dir });

    expect(md).toContain('pnpm run build');
    expect(md).toContain('pnpm test');
  });
});
