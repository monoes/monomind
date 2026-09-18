import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateClaudeMd } from '../init/claudemd-generator.js';
import { DEFAULT_INIT_OPTIONS } from '../init/types.js';

// GH #278: the generated CLAUDE.md prescribed `npm run build` and `/src` in
// every repo, including the Go project in the report — even though init's own
// detection already labelled that project "Stack: Go" in
// .agents/shared_instructions.md. detectProjectProfile's own behavior is
// covered by detect-project-profile-stack.test.ts; this file covers what the
// CLAUDE.md generator does with it.
describe('generated CLAUDE.md matches the detected stack (GH #278)', () => {
  let tmp: string;
  let counter = 0;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-claude-md-stack-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function projectWith(files: Record<string, string>, dirs: readonly string[] = []): string {
    counter += 1;
    const dir = join(tmp, `project-${counter}`);
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

  it('prescribes pytest in a Python repo and omits a build step it has none of', () => {
    const dir = projectWith({ 'pyproject.toml': '[project]\nname = "svc"\n' });

    const md = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: dir });

    expect(md).toContain('pytest');
    expect(md).toContain('ruff check .');
    expect(md).not.toContain('npm test');
  });

  it('keeps npm commands and /src for a plain Node repo (regression guard)', () => {
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
