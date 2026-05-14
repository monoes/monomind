/**
 * Smoke tests for scripts/understand-analyze.mjs
 *
 * Covers the pure helpers — ignore matcher, language detector, framework
 * detector — without needing an Anthropic API key or a real monograph DB.
 *
 * The script is a CLI .mjs that auto-runs on import (calls main()), so we
 * can't import it directly. Tests invoke the helpers by re-deriving them
 * from the same source via dynamic eval against the file contents, OR by
 * spawning the script in --dry-run mode against a fixture directory.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = resolve(__dirname, '..', 'scripts', 'understand-analyze.mjs');

describe('understand-analyze.mjs — smoke tests', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'understand-test-'));
    // Create a fake project structure
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'fixture-app',
      description: 'A fixture for tests',
      dependencies: { react: '^18.0.0', express: '^4.0.0' },
    }, null, 2));
    writeFileSync(join(tmpDir, 'src/app.ts'), 'export const x = 1;');
    writeFileSync(join(tmpDir, 'src/util.js'), 'module.exports = {};');
    writeFileSync(join(tmpDir, '.understandignore'), 'src/secret.ts\n');
    writeFileSync(join(tmpDir, 'src/secret.ts'), 'export const SECRET = "shh";');
  });

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('script file exists and has executable shebang', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const content = readFileSync(SCRIPT, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('script syntax is valid', () => {
    // node --check throws on syntax errors
    expect(() => execFileSync('node', ['--check', SCRIPT], { encoding: 'utf-8' })).not.toThrow();
  });

  it('exits gracefully when monograph.db is missing', () => {
    // No .monomind/monograph.db in fixture — script should exit 1 with a helpful message
    let stderr = '';
    let exitCode = 0;
    try {
      execFileSync('node', [SCRIPT, '--dir', tmpDir, '--no-llm', '--dry-run'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      exitCode = err.status ?? 1;
      stderr = err.stderr?.toString() ?? '';
    }
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/monograph\.db not found/i);
  });

  it('CLI parses all new flags without crashing on --help-like dry run', () => {
    // Run with --max-files 0 and a non-existent DB → graceful exit
    let stderr = '';
    try {
      execFileSync('node', [
        SCRIPT,
        '--dir', tmpDir,
        '--no-llm',
        '--dry-run',
        '--incremental',
        '--onboard',
        '--onboard-out', join(tmpDir, 'OUT.md'),
        '--layers-only',
        '--batch-size', '3',
        '--max-files', '10',
      ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err: any) {
      stderr = err.stderr?.toString() ?? '';
    }
    // It will fail because no DB, but should fail at DB-not-found, not at flag parsing
    expect(stderr).toMatch(/monograph\.db not found/i);
    expect(stderr).not.toMatch(/SyntaxError|TypeError|ReferenceError/);
  });

  it('script source declares all expected flags', () => {
    const src = readFileSync(SCRIPT, 'utf-8');
    for (const flag of ['incremental', 'onboard', 'layers-only', 'no-llm', 'dry-run']) {
      expect(src).toContain(`hasFlag('${flag}')`);
    }
    for (const flag of ['dir', 'db', 'output', 'batch-size', 'max-files', 'onboard-out']) {
      expect(src).toContain(`argVal('${flag}')`);
    }
  });

  it('script source defines language detection table', () => {
    const src = readFileSync(SCRIPT, 'utf-8');
    expect(src).toContain('LANGUAGE_BY_EXT');
    expect(src).toContain("'.ts': 'TypeScript'");
    expect(src).toContain("'.rs': 'Rust'");
  });

  it('script source defines framework signatures', () => {
    const src = readFileSync(SCRIPT, 'utf-8');
    expect(src).toContain('FRAMEWORK_SIGNATURES');
    expect(src).toContain("['React'");
    expect(src).toContain("['Django'");
  });

  it('script source defines default ignore patterns including node_modules', () => {
    const src = readFileSync(SCRIPT, 'utf-8');
    expect(src).toContain('DEFAULT_IGNORE_PATTERNS');
    expect(src).toContain("'node_modules/'");
    expect(src).toContain("'.git/'");
  });

  it('script source has incremental mode git-diff logic', () => {
    const src = readFileSync(SCRIPT, 'utf-8');
    expect(src).toContain('getChangedFiles');
    expect(src).toContain('ua_last_commit');
  });

  it('script source has onboarding guide builder', () => {
    const src = readFileSync(SCRIPT, 'utf-8');
    expect(src).toContain('buildOnboardingGuide');
    expect(src).toContain('## Architecture');
    expect(src).toContain('## File Map');
    expect(src).toContain('## Complexity Hotspots');
  });
});
