/** Unit tests for init's edit-preserving writes (init/file-guard.ts). */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileGuard, pruneBackups } from '../init/file-guard.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mm-file-guard-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const block = (body: string) => `<!-- monomind-block:m -->\n${body}\n<!-- /monomind-block:m -->\n`;

describe('FileGuard.write', () => {
  it('records what it wrote, refreshes an untouched file and keeps an edited one', () => {
    const file = join(dir, 'a.md');
    const first = new FileGuard(dir, { replaceUnrecorded: false });
    expect(first.write(file, 'v1\n')).toBe('written');
    first.finalize();

    expect(new FileGuard(dir, { replaceUnrecorded: false }).write(file, 'v2\n')).toBe('written');
    writeFileSync(file, 'mine\n');
    const guard = new FileGuard(dir, { replaceUnrecorded: true });
    expect(guard.write(file, 'v3\n')).toBe('kept');
    expect(readFileSync(file, 'utf8')).toBe('mine\n');
    expect(readFileSync(`${file}.monomind-new`, 'utf8')).toBe('v3\n');
    expect(guard.kept).toEqual(['a.md']);
  });

  it('adopts an unrecorded file that differs only by ownership markers', () => {
    const file = join(dir, 'SKILL.md');
    writeFileSync(
      file,
      '---\nname: x\n---\n# monomind:start skills:claude:x\nbody\n# monomind:end skills:claude:x\n',
    );
    const guard = new FileGuard(dir, { replaceUnrecorded: false });
    expect(guard.write(file, '---\nname: x\n---\n\nbody\n')).toBe('written');
  });

  it('adopts the 2.16.0 shared-root form: the same body once per platform block', () => {
    const file = join(dir, 'SKILL.md');
    const copy = (p: string) =>
      `<!-- monomind:start skills:${p}:x -->\nbody\n<!-- monomind:end skills:${p}:x -->\n`;
    writeFileSync(file, `---\nname: x\n---\n\n${copy('codex')}${copy('kimi')}`);
    const guard = new FileGuard(dir, { replaceUnrecorded: false });
    expect(guard.write(file, '---\nname: x\n---\n\nbody\n')).toBe('written');
    expect(readFileSync(file, 'utf8')).toBe('---\nname: x\n---\n\nbody\n');
  });

  it('keeps an unrecorded marked file with text outside the markers', () => {
    const file = join(dir, 'SKILL.md');
    const marked = `---\nname: x\n---\n\n<!-- monomind:start skills:claude:x -->\nbody\n<!-- monomind:end skills:claude:x -->\nmine\n`;
    writeFileSync(file, marked);
    const guard = new FileGuard(dir, { replaceUnrecorded: false });
    expect(guard.write(file, '---\nname: x\n---\n\nbody\n')).toBe('kept');
    expect(readFileSync(file, 'utf8')).toBe(marked);
  });
});

describe('FileGuard.mergeBlock', () => {
  it('under --force, says so when it replaces an unrecorded block that differs', () => {
    const file = join(dir, 'CLAUDE.md');
    writeFileSync(file, `intro\n\n${block('someone edited this')}`);
    const guard = new FileGuard(dir, { replaceUnrecorded: true, force: true });
    const merged = guard.mergeBlock(file, readFileSync(file, 'utf8'), 'm', 'generated');
    expect(merged).toBe(`intro\n\n${block('generated')}`);
    expect(guard.warnings.join('\n')).toMatch(/CLAUDE\.md.*backups/);
  });

  it('keeps an edited recorded block without --force', () => {
    const file = join(dir, 'CLAUDE.md');
    const first = new FileGuard(dir, { replaceUnrecorded: false });
    writeFileSync(file, first.mergeBlock(file, '', 'm', 'generated') as string);
    writeFileSync(file, block('generated\nMY EDIT'));

    const guard = new FileGuard(dir, { replaceUnrecorded: false });
    expect(guard.mergeBlock(file, readFileSync(file, 'utf8'), 'm', 'generated v2')).toBeNull();
    expect(guard.warnings).toHaveLength(1);
  });
});

describe('pruneBackups', () => {
  it('keeps the newest five and never a directory with retired entries', () => {
    const root = join(dir, '.monomind', 'backups');
    for (let i = 1; i <= 7; i++) mkdirSync(join(root, `${100 + i}-1`), { recursive: true });
    mkdirSync(join(root, '1-1', 'retired'), { recursive: true });

    pruneBackups(dir);

    expect(readdirSync(root).sort()).toEqual(['1-1', '103-1', '104-1', '105-1', '106-1', '107-1']);
    expect(existsSync(join(root, '1-1', 'retired'))).toBe(true);
  });
});
