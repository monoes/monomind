import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectProjectProfile,
  generateSharedInstructions,
} from '../init/shared-instructions-generator.js';

describe('detectProjectProfile — an incidental root package.json does not win stack detection (GH #241)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'monomind-detect-stack-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects Go, not JavaScript, when a Go repo has an incidental root package.json', () => {
    writeFileSync(join(tmp, 'go.mod'), 'module github.com/monoes/mono-agent\n\ngo 1.22\n');
    mkdirSync(join(tmp, 'cmd', 'monoagentcli'), { recursive: true });
    writeFileSync(join(tmp, 'cmd', 'monoagentcli', 'main.go'), 'package main\n\nfunc main() {}\n');
    // package.json exists only to declare a tooling dependency, per the
    // issue's repro — no tsconfig, no JS source, nothing that makes this a
    // JS project other than the file's mere presence.
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify(
        { name: 'tooling', private: true, devDependencies: { '@monoes/monograph': '^1.0.0' } },
        null,
        2,
      ),
    );

    const profile = detectProjectProfile(tmp);

    expect(profile.language).toBe('go');
    // packageManager (not language) is what actually drives the "Install
    // dependencies" command in the rendered file — this is the field
    // responsible for the misleading "npm install" text the issue
    // complains about, so it must also be reset by the go.mod block.
    expect(profile.packageManager).not.toBe('npm');

    const rendered = generateSharedInstructions(profile);
    expect(rendered).toContain('**Language:** Go');
    expect(rendered).not.toContain('npm install');
    expect(rendered).not.toContain('npm test');
    // "unknown" is technically accurate (Go has no separate package
    // manager) but reads as a detection failure to an agent; render
    // something informative instead.
    expect(rendered).not.toContain('**Package manager:** unknown');
  });

  it('still detects Rust when a Cargo.toml repo has an incidental root package.json', () => {
    writeFileSync(join(tmp, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n');
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'tooling' }, null, 2));

    const profile = detectProjectProfile(tmp);
    expect(profile.language).toBe('rust');
    expect(profile.packageManager).toBe('cargo');
  });

  it('still detects Python when a pyproject.toml repo has an incidental root package.json', () => {
    writeFileSync(join(tmp, 'pyproject.toml'), '[project]\nname = "demo"\n');
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'tooling' }, null, 2));

    const profile = detectProjectProfile(tmp);
    expect(profile.language).toBe('python');
  });

  it('still detects JavaScript for a plain JS project with no other-stack marker (regression guard)', () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0' } }, null, 2),
    );

    const profile = detectProjectProfile(tmp);
    expect(profile.language).toBe('javascript');
    expect(profile.packageManager).toBe('npm');
  });

  it('still detects TypeScript when tsconfig.json is present (regression guard)', () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'demo' }, null, 2));
    writeFileSync(join(tmp, 'tsconfig.json'), '{}');

    const profile = detectProjectProfile(tmp);
    expect(profile.language).toBe('typescript');
  });

  it('prefers the stronger single-stack manifest when both go.mod and package.json exist', () => {
    writeFileSync(join(tmp, 'go.mod'), 'module example.com/demo\n\ngo 1.22\n');
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'demo', dependencies: { typescript: '^5.0.0' } }, null, 2),
    );

    const profile = detectProjectProfile(tmp);
    // go.mod — a deliberate, single-purpose manifest — wins over package.json,
    // which any repo can carry for an unrelated reason. See the code comment
    // on the language assignment in detectProjectProfile for the rationale.
    expect(profile.language).toBe('go');
  });

  it('still detects Python from a bare requirements.txt with no package.json at all (existing behavior, unchanged)', () => {
    writeFileSync(join(tmp, 'requirements.txt'), 'flask==3.0.0\n');

    const profile = detectProjectProfile(tmp);
    expect(profile.language).toBe('python');
  });
});
