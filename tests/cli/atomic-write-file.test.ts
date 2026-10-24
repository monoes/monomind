import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { atomicWriteFile } from '../../packages/@monomind/cli/src/init/fs-helpers.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join('/var/tmp', 'awf-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('atomicWriteFile', () => {
  it('writes the content and leaves no tmp file', () => {
    const d = tmp();
    atomicWriteFile(join(d, 'registry.json'), '{"a":1}');
    expect(readFileSync(join(d, 'registry.json'), 'utf-8')).toBe('{"a":1}');
    expect(readdirSync(d)).toEqual(['registry.json']);
  });

  it('removes its tmp file when the rename fails', () => {
    const d = tmp();
    const target = join(d, 'registry.json');
    mkdirSync(target);
    writeFileSync(join(target, 'occupied'), 'x'); // non-empty dir: rename onto it throws
    expect(() => atomicWriteFile(target, 'data')).toThrow();
    expect(readdirSync(d)).toEqual(['registry.json']);
  });
});
