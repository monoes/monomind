/** Adapter instruction blocks keep user edits, like init's other managed blocks. */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileGuard } from '../../src/init/file-guard.js';
import { applyIntents } from '../../src/platform-adapters/operations.js';
import { PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';
import type { ArtifactIntent, InstallRequest } from '../../src/platform-adapters/types.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mm-instruction-guard-'));
  file = join(dir, 'CLAUDE.md');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const intent = (content: string): ArtifactIntent => ({
  kind: 'instruction',
  locationKey: 'instruction',
  content,
  marker: 'instructions:claude',
  scope: 'project',
  replace: 'managed_block',
  format: 'md',
});

const block = (body: string) =>
  `<!-- monomind:start instructions:claude -->\n${body}\n<!-- monomind:end instructions:claude -->\n`;

function install(content: string, guard?: FileGuard) {
  const request: InstallRequest = { platform: 'claude', path: dir, scope: 'project', yes: true };
  if (guard) request.fileGuard = guard;
  return applyIntents(PLATFORM_REGISTRY.claude, [intent(content)], request);
}

/** First install through a guard, so the block's hash is recorded. */
function installRecorded(content: string): void {
  install(content, new FileGuard(dir, { replaceUnrecorded: false }));
  writeFileSync(file, `# Project\n\nmine\n\n${readFileSync(file, 'utf8')}`);
}

describe('adapter instruction blocks under the file guard', () => {
  it('refreshes an unedited block and makes no write on a second run', () => {
    installRecorded('v1');

    const guard = new FileGuard(dir, { replaceUnrecorded: false });
    expect(install('v2', guard).changed).toEqual(['CLAUDE.md']);
    expect(readFileSync(file, 'utf8')).toBe(`# Project\n\nmine\n\n${block('v2')}`);
    expect(guard.warnings).toEqual([]);

    const before = statSync(file).mtimeMs;
    const again = install('v2', new FileGuard(dir, { replaceUnrecorded: false }));
    expect(again.changed).toEqual([]);
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it('keeps an edited block and warns without --force', () => {
    installRecorded('v1');
    const edited = `# Project\n\nmine\n\n${block('v1\nMY EDIT')}`;
    writeFileSync(file, edited);

    const guard = new FileGuard(dir, { replaceUnrecorded: false });
    const result = install('v2', guard);
    expect(result.changed).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(edited);
    expect(guard.warnings).toHaveLength(1);
    expect(guard.warnings[0]).toMatch(/CLAUDE\.md: .*instructions:claude.*edited/);
  });

  it('under --force, backs up an edited block, replaces it and warns', () => {
    installRecorded('v1');
    const edited = `# Project\n\nmine\n\n${block('v1\nMY EDIT')}`;
    writeFileSync(file, edited);

    const guard = new FileGuard(dir, { replaceUnrecorded: true, force: true });
    expect(install('v2', guard).changed).toEqual(['CLAUDE.md']);
    expect(readFileSync(file, 'utf8')).toBe(`# Project\n\nmine\n\n${block('v2')}`);
    expect(readFileSync(join(guard.backupDir, 'CLAUDE.md'), 'utf8')).toBe(edited);
    expect(guard.warnings).toHaveLength(1);
    expect(guard.warnings[0]).toMatch(/instructions:claude.*--force.*backups/);
  });

  it('adopts an unrecorded block that matches the generated text ignoring whitespace', () => {
    writeFileSync(file, `mine\n\n${block('line one\n\n  line two  ')}`);
    const guard = new FileGuard(dir, { replaceUnrecorded: true, force: true });
    install('line one\nline two', guard);
    // No guard warning means no guarded backup. (Checking that backupDir is
    // absent was flaky: applyIntents' own pre-write backup, taken without a
    // run dir, is named `${Date.now()}-${pid}` too and can land on the same name.)
    expect(guard.warnings).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(`mine\n\n${block('line one\nline two')}`);

    // Adopted: its hash is recorded, so a later edit is protected.
    writeFileSync(file, `mine\n\n${block('line one\nline two\nMY EDIT')}`);
    const next = new FileGuard(dir, { replaceUnrecorded: false });
    install('line one\nline two', next);
    expect(readFileSync(file, 'utf8')).toContain('MY EDIT');
    expect(next.warnings).toHaveLength(1);
  });

  it('outside init, keeps an edited block and reports it as a diagnostic', () => {
    installRecorded('v1');
    const edited = `# Project\n\nmine\n\n${block('v1\nMY EDIT')}`;
    writeFileSync(file, edited);

    const result = install('v2');
    expect(readFileSync(file, 'utf8')).toBe(edited);
    expect(result.diagnostics.join('\n')).toMatch(/instructions:claude.*edited/);
  });
});
