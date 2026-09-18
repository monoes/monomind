import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platformsCommand } from '../../src/commands/platforms.js';
import { installPlatform } from '../../src/platform-adapters/operations.js';
import { PLATFORM_IDS } from '../../src/platform-adapters/registry.js';
import type { CommandContext } from '../../src/types.js';

const directories: string[] = [];
function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'platforms-doctor-output-'));
  directories.push(directory);
  return directory;
}

let captured: string[];

function context(cwd: string, flags: Record<string, unknown> = {}): CommandContext {
  return {
    args: [],
    flags: { _: [], ...flags } as CommandContext['flags'],
    cwd,
    interactive: false,
  };
}

const doctor = platformsCommand.subcommands?.find((sub) => sub.name === 'doctor');

function printed(): string {
  return captured.join('');
}

beforeEach(() => {
  captured = [];
  const capture = ((chunk: string | Uint8Array) => {
    captured.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture as typeof process.stderr.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('platforms doctor output (#277)', () => {
  it('prints an informative single-platform report and exits 0', async () => {
    const dir = fixture();
    await installPlatform({ platform: 'claude', path: dir, scope: 'project' });

    const result = await doctor?.action?.(context(dir, { platform: 'claude' }));

    expect(result?.success).toBe(true);
    expect(result?.exitCode ?? 0).toBe(0);
    const text = printed();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('claude');
    // The per-artifact state, not just the platform name, is what the doctor
    // warning sends the user here for.
    expect(text).toContain('CLAUDE.md');
    expect(text).toContain('managed');
    // And a concrete next command.
    expect(text).toMatch(/monomind platforms (install|upgrade) --platform claude/);
  });

  it('reports every platform when no --platform is given', async () => {
    const dir = fixture();

    const result = await doctor?.action?.(context(dir));

    expect(result?.success).toBe(true);
    const text = printed();
    for (const id of PLATFORM_IDS) expect(text).toContain(id);
  });

  it('explains a detected legacy surface and still exits 0 (warnings do not fail)', async () => {
    const dir = fixture();
    writeFileSync(
      join(dir, 'CLAUDE.md'),
      '# user notes\n<!-- monomind:start -->\nlegacy\n<!-- monomind:end -->\n',
    );

    const result = await doctor?.action?.(context(dir, { platform: 'claude' }));

    expect(result?.success).toBe(true);
    expect(result?.exitCode ?? 0).toBe(0);
    const text = printed();
    expect(text).toContain('claude-bare-instruction-markers');
    expect(text).toMatch(/monomind platforms upgrade --platform claude/);
  });

  it('prints the failure reason for an unknown platform and exits non-zero', async () => {
    const result = await doctor?.action?.(context(fixture(), { platform: 'not-a-platform' }));

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
    expect(printed()).toContain('not-a-platform');
  });

  it('keeps --json machine readable (no human text mixed in)', async () => {
    const dir = fixture();

    await doctor?.action?.(context(dir, { platform: 'claude', json: true }));

    const parsed = JSON.parse(printed()) as { platform: string }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.platform).toBe('claude');
  });
});

describe('legacy detection accuracy (#277)', () => {
  it('does not call a freshly installed project legacy', async () => {
    const dir = fixture();
    await installPlatform({ platform: 'claude', path: dir, scope: 'project' });
    await installPlatform({ platform: 'gemini', path: dir, scope: 'project' });

    const { runPlatformsDoctor } = await import('../../src/platform-adapters/operations.js');
    const reports = await runPlatformsDoctor({ path: dir, scope: 'project' });

    for (const report of reports) expect(report.legacy.findings).toEqual([]);
  });

  it('still detects a genuine pre-adapter bare marker', async () => {
    const dir = fixture();
    writeFileSync(join(dir, 'CLAUDE.md'), '<!-- monomind:start -->\nlegacy\n<!-- monomind:end -->\n');

    const { runPlatformsDoctor } = await import('../../src/platform-adapters/operations.js');
    const [report] = await runPlatformsDoctor({ platform: 'claude', path: dir, scope: 'project' });

    expect(report?.legacy.findings).toContain('claude-bare-instruction-markers');
  });

  it('still detects a pre-adapter shared skills root', async () => {
    const dir = fixture();
    const skill = join(dir, '.agents', 'skills', 'mastermind-plan');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: mastermind-plan\n---\n\nold body\n');

    const { runPlatformsDoctor } = await import('../../src/platform-adapters/operations.js');
    const [report] = await runPlatformsDoctor({ platform: 'codex', path: dir, scope: 'project' });

    expect(report?.legacy.findings).toContain('shared-agent-skills');
  });
});
